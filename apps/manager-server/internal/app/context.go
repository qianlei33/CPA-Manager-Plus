package app

import (
	"context"
	"io/fs"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/collector"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/config"
	adminauthsvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/adminauth"
	apikeyaliassvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/apikeyalias"
	authrefreshsvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/authrefresh"
	bootstrapsvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/bootstrap"
	codexinspectionsvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/codexinspection"
	collectorsvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/collector"
	cpanodesvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/cpanode"
	dashboardsvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/dashboard"
	managerconfigsvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/managerconfig"
	modelpricesvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/modelprice"
	monitoringsvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/monitoring"
	panelsvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/panel"
	proxysvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/proxy"
	setupsvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/setup"
	usagesvc "github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/usage"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
)

type Context struct {
	Config    config.Config
	Store     *store.Store
	Collector *collector.Manager

	StartedAt int64
	ServiceID string
	Bootstrap bootstrapsvc.Result

	SetupService           *setupsvc.Service
	AdminAuthService       *adminauthsvc.Service
	ManagerConfigService   *managerconfigsvc.Service
	CollectorService       *collectorsvc.Service
	CPANodeService         *cpanodesvc.Service
	UsageService           *usagesvc.Service
	DashboardService       *dashboardsvc.Service
	CodexInspectionService *codexinspectionsvc.Service
	MonitoringService      *monitoringsvc.Service
	ModelPriceService      *modelpricesvc.Service
	APIKeyAliasService     *apikeyaliassvc.Service
	AuthRefreshService     *authrefreshsvc.Service
	ProxyService           *proxysvc.Service
	PanelService           *panelsvc.Service
	CollectorReloader      CollectorReloader
}

// CollectorReloader reloads node-scoped collectors after CPA node changes.
type CollectorReloader interface {
	ReloadNodes(ctx context.Context) error
	NodeStatuses() []NodeCollectorStatus
}

// NodeCollectorStatus describes one node-scoped collector runtime.
type NodeCollectorStatus struct {
	NodeID   string           `json:"nodeId"`
	NodeName string           `json:"nodeName"`
	Status   collector.Status `json:"status"`
}

func FromExisting(
	cfg config.Config,
	st *store.Store,
	collectorManager *collector.Manager,
	startedAt int64,
	embeddedPanel fs.FS,
	modelPriceSyncURL *string,
	openRouterModelPriceSyncURL *string,
	serviceID string,
) *Context {
	collectorService := collectorsvc.New(collectorManager)
	managerConfigService := managerconfigsvc.New(cfg, st, collectorService)
	cpaNodeService := cpanodesvc.New(st)
	return &Context{
		Config:                 cfg,
		Store:                  st,
		Collector:              collectorManager,
		StartedAt:              startedAt,
		ServiceID:              serviceID,
		AdminAuthService:       adminauthsvc.New(cfg, st),
		SetupService:           setupsvc.New(cfg, st, collectorService, managerConfigService, startedAt, serviceID),
		ManagerConfigService:   managerConfigService,
		CollectorService:       collectorService,
		CPANodeService:         cpaNodeService,
		UsageService:           usagesvc.New(st),
		DashboardService:       dashboardsvc.New(st),
		CodexInspectionService: codexinspectionsvc.New(st, managerConfigService, cpaNodeService),
		MonitoringService:      monitoringsvc.New(st),
		ModelPriceService:      modelpricesvc.NewMultiSource(st, modelPriceSyncURL, openRouterModelPriceSyncURL, managerConfigService),
		APIKeyAliasService:     apikeyaliassvc.New(st),
		AuthRefreshService:     authrefreshsvc.New(managerConfigService, cpaNodeService),
		ProxyService:           proxysvc.New(managerConfigService, cpaNodeService),
		PanelService:           panelsvc.New(cfg.PanelPath, embeddedPanel),
	}
}
