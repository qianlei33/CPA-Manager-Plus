package worker

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	collectorpkg "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/collector"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/config"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/model"
	collectorservice "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/collector"
	cpanodeservice "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/cpanode"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
)

func TestCollectorWorkerDoesNotStartWhenMonitoringDisabled(t *testing.T) {
	cfg := workerTestConfig(t)
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	enabled := false
	err = db.SaveManagerConfig(context.Background(), store.ManagerConfig{
		CPAConnection: store.ManagerCPAConnectionConfig{
			CPABaseURL:    "http://cpa.local:8317",
			ManagementKey: "management-key",
		},
		Collector: store.ManagerCollectorConfig{
			Enabled:        &enabled,
			CollectorMode:  "http",
			Queue:          "usage",
			PopSide:        "right",
			BatchSize:      100,
			PollIntervalMS: 500,
		},
	})
	if err != nil {
		t.Fatalf("save manager config: %v", err)
	}

	manager := collectorpkg.NewManager(cfg, db)
	collectorService := collectorservice.New(manager)
	NewCollectorWorker(cfg, db, collectorService).Start(context.Background())

	if status := collectorService.Status(); status.Collector != "stopped" {
		t.Fatalf("collector status = %#v", status)
	}
}

func TestCollectorWorkerStartsFromEnvironmentConfig(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v0/management/usage-queue" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[]`))
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(upstream.Close)

	cfg := workerTestConfig(t)
	cfg.CPAUpstreamURL = upstream.URL
	cfg.ManagementKey = "management-key"
	cfg.CollectorMode = "http"
	cfg.PollInterval = time.Hour
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	manager := collectorpkg.NewManager(cfg, db)
	collectorService := collectorservice.New(manager)
	t.Cleanup(func() {
		_ = collectorService.Stop(context.Background())
	})

	NewCollectorWorker(cfg, db, collectorService).Start(context.Background())
	status := collectorService.Status()
	if status.Collector != "starting" && status.Collector != "running" {
		t.Fatalf("collector status = %#v", status)
	}
	if status.Upstream != upstream.URL || status.Mode != "http" || status.Queue != "usage" {
		t.Fatalf("collector status = %#v", status)
	}
}

func TestCollectorWorkerReloadStartsNewNodeCollector(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v0/management/usage-queue" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[]`))
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(upstream.Close)

	cfg := workerTestConfig(t)
	cfg.CollectorMode = "http"
	cfg.PollInterval = time.Hour
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	manager := collectorpkg.NewManager(cfg, db)
	collectorService := collectorservice.New(manager)
	nodeService := cpanodeservice.New(db)
	collectorWorker := NewCollectorWorker(cfg, db, collectorService, nodeService)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	collectorWorker.Start(ctx)
	if len(collectorWorker.nodeManagers) != 0 {
		t.Fatalf("node managers before node create = %d", len(collectorWorker.nodeManagers))
	}

	_, err = db.CPANodes.Create(context.Background(), model.CPANode{
		ID:               "node-1",
		Name:             "Node 1",
		BaseURL:          upstream.URL,
		ManagementKey:    "management-key",
		Enabled:          true,
		CollectorEnabled: true,
		CollectorMode:    "http",
		Queue:            "usage",
		PopSide:          "right",
		BatchSize:        100,
		PollIntervalMS:   int(time.Hour / time.Millisecond),
	})
	if err != nil {
		t.Fatalf("create node: %v", err)
	}
	if err := collectorWorker.ReloadNodes(context.Background()); err != nil {
		t.Fatalf("reload nodes: %v", err)
	}
	if len(collectorWorker.nodeManagers) != 1 {
		t.Fatalf("node managers after reload = %d", len(collectorWorker.nodeManagers))
	}
	status := collectorWorker.nodeManagers[0].manager.Status()
	if status.Upstream != upstream.URL || status.Mode != "http" || status.Queue != "usage" {
		t.Fatalf("node collector status = %#v", status)
	}
}

func TestCollectorServiceRestartAndStop(t *testing.T) {
	cfg := workerTestConfig(t)
	db, err := store.Open(cfg.DBPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
	})

	manager := collectorpkg.NewManager(cfg, db)
	collectorService := collectorservice.New(manager)
	managerCfg := store.ManagerConfig{
		CPAConnection: store.ManagerCPAConnectionConfig{
			CPABaseURL:    "http://cpa.local:8317",
			ManagementKey: "management-key",
		},
		Collector: store.ManagerCollectorConfig{
			CollectorMode:  "http",
			Queue:          "usage",
			PopSide:        "right",
			BatchSize:      100,
			PollIntervalMS: int(time.Hour / time.Millisecond),
		},
	}

	if err := collectorService.Start(context.Background(), managerCfg); err != nil {
		t.Fatalf("start collector: %v", err)
	}
	if status := collectorService.Status(); status.Collector != "starting" && status.Collector != "running" {
		t.Fatalf("collector status after start = %#v", status)
	}
	managerCfg.Collector.PollIntervalMS = int((2 * time.Hour) / time.Millisecond)
	if err := collectorService.Restart(context.Background(), managerCfg); err != nil {
		t.Fatalf("restart collector: %v", err)
	}
	if status := collectorService.Status(); status.Collector != "starting" && status.Collector != "running" {
		t.Fatalf("collector status after restart = %#v", status)
	}
	if err := collectorService.Stop(context.Background()); err != nil {
		t.Fatalf("stop collector: %v", err)
	}
	if status := collectorService.Status(); status.Collector != "stopped" {
		t.Fatalf("collector status after stop = %#v", status)
	}
}

func workerTestConfig(t *testing.T) config.Config {
	t.Helper()
	return config.Config{
		DBPath:        filepath.Join(t.TempDir(), "usage.sqlite"),
		CollectorMode: "auto",
		Queue:         "usage",
		PopSide:       "right",
		BatchSize:     100,
		PollInterval:  time.Hour,
	}
}
