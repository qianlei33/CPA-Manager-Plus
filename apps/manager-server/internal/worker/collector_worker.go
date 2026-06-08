package worker

import (
	"context"
	"log"
	"sync"
	"time"

	collectorpkg "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/collector"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/config"
	collectorservice "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/collector"
	cpanodeservice "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/cpanode"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
)

type CollectorWorker struct {
	cfg              config.Config
	store            *store.Store
	collectorService *collectorservice.Service
	cpaNodeService   *cpanodeservice.Service
	mu               sync.Mutex
	nodeManagers     []*collectorpkg.Manager
	runtimeCtx       context.Context
}

func NewCollectorWorker(cfg config.Config, store *store.Store, collectorService *collectorservice.Service, cpaNodeService ...*cpanodeservice.Service) *CollectorWorker {
	var nodeService *cpanodeservice.Service
	if len(cpaNodeService) > 0 {
		nodeService = cpaNodeService[0]
	}
	return &CollectorWorker{
		cfg:              cfg,
		store:            store,
		collectorService: collectorService,
		cpaNodeService:   nodeService,
	}
}

func (w *CollectorWorker) Start(ctx context.Context) {
	w.runtimeCtx = ctx
	if w.startNodeCollectors(ctx) {
		return
	}

	if w.cfg.CPAUpstreamURL != "" && w.cfg.ManagementKey != "" {
		_ = w.collectorService.StartRuntime(ctx, collectorpkg.RuntimeConfig{
			CPAUpstreamURL: w.cfg.CPAUpstreamURL,
			ManagementKey:  w.cfg.ManagementKey,
			CollectorMode:  w.cfg.CollectorMode,
			Queue:          w.cfg.Queue,
			PopSide:        w.cfg.PopSide,
			BatchSize:      w.cfg.BatchSize,
			PollInterval:   w.cfg.PollInterval,
			TLSSkipVerify:  w.cfg.TLSSkipVerify,
		})
		return
	}

	if managerCfg, ok, err := w.store.LoadManagerConfig(ctx); err == nil && ok &&
		managerCfg.CPAConnection.CPABaseURL != "" && managerCfg.CPAConnection.ManagementKey != "" {
		if collectorservice.ManagerCollectorEnabled(managerCfg) {
			_ = w.collectorService.StartRuntime(ctx, collectorservice.RuntimeConfigFromManagerConfigWithFallback(managerCfg, w.cfg))
		}
		return
	} else if err != nil {
		log.Printf("load manager config: %v", err)
		return
	}

	if setup, ok, err := w.store.LoadSetup(ctx); err == nil && ok {
		_ = w.collectorService.StartRuntime(ctx, collectorpkg.RuntimeConfig{
			CPAUpstreamURL: setup.CPAUpstreamURL,
			ManagementKey:  setup.ManagementKey,
			CollectorMode:  w.cfg.CollectorMode,
			Queue:          setup.Queue,
			PopSide:        setup.PopSide,
			BatchSize:      w.cfg.BatchSize,
			PollInterval:   w.cfg.PollInterval,
			TLSSkipVerify:  w.cfg.TLSSkipVerify,
		})
	} else if err != nil {
		log.Printf("load setup: %v", err)
	}
}

// ReloadNodes restarts node-scoped collectors after CPA node configuration changes.
func (w *CollectorWorker) ReloadNodes(ctx context.Context) error {
	if w.runtimeCtx == nil {
		w.runtimeCtx = ctx
	}
	if w.startNodeCollectors(w.runtimeCtx) {
		return nil
	}
	w.mu.Lock()
	for _, manager := range w.nodeManagers {
		manager.Stop()
	}
	w.nodeManagers = nil
	w.mu.Unlock()
	return w.collectorService.Stop(ctx)
}

func (w *CollectorWorker) startNodeCollectors(ctx context.Context) bool {
	if w.cpaNodeService == nil {
		return false
	}
	nodes, err := w.cpaNodeService.EnabledNodes(ctx)
	if err != nil {
		log.Printf("load CPA nodes for collector: %v", err)
		return false
	}
	if len(nodes) == 0 {
		return false
	}
	if err := w.collectorService.Stop(ctx); err != nil {
		return false
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	for _, manager := range w.nodeManagers {
		manager.Stop()
	}
	w.nodeManagers = nil
	for _, node := range nodes {
		if !node.CollectorEnabled {
			continue
		}
		manager := collectorpkg.NewManager(w.cfg, w.store)
		runtime := collectorpkg.RuntimeConfig{
			NodeID:         node.ID,
			NodeName:       node.Name,
			CPAUpstreamURL: node.BaseURL,
			ManagementKey:  node.ManagementKey,
			CollectorMode:  node.CollectorMode,
			Queue:          node.Queue,
			PopSide:        node.PopSide,
			BatchSize:      node.BatchSize,
			PollInterval:   time.Duration(node.PollIntervalMS) * time.Millisecond,
			TLSSkipVerify:  node.TLSSkipVerify,
		}
		manager.Start(ctx, runtime)
		w.nodeManagers = append(w.nodeManagers, manager)
	}
	return true
}

func (w *CollectorWorker) Stop(ctx context.Context) {
	w.mu.Lock()
	for _, manager := range w.nodeManagers {
		manager.Stop()
	}
	w.nodeManagers = nil
	w.mu.Unlock()
	if err := w.collectorService.Stop(ctx); err != nil {
		log.Printf("stop collector: %v", err)
	}
}
