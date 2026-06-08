package cpanode

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/model"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/cpa"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/service/managerconfig"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
)

var (
	ErrNodeIDRequired        = errors.New("nodeId is required")
	ErrNodeNotFound          = errors.New("CPA node not found")
	ErrNodeDisabled          = errors.New("CPA node is disabled")
	ErrNodeNameRequired      = errors.New("node name is required")
	ErrNodeBaseURLRequired   = errors.New("baseUrl is required")
	ErrManagementKeyRequired = errors.New("managementKey is required")
)

// Service manages CPA node records and resolves node scoped runtime setup.
type Service struct {
	store *store.Store
}

// SaveNodeRequest carries node fields plus optional global collector defaults.
type SaveNodeRequest struct {
	model.CPANode
	CollectorMode                string `json:"collectorMode,omitempty"`
	Queue                        string `json:"queue,omitempty"`
	PopSide                      string `json:"popSide,omitempty"`
	BatchSize                    int    `json:"batchSize,omitempty"`
	PollIntervalMS               int    `json:"pollIntervalMs,omitempty"`
	QueryLimit                   int    `json:"queryLimit,omitempty"`
	TLSSkipVerify                bool   `json:"tlsSkipVerify,omitempty"`
	EnsureUsageStatisticsEnabled *bool  `json:"ensureUsageStatisticsEnabled,omitempty"`
	RequestMonitoringEnabled     *bool  `json:"requestMonitoringEnabled,omitempty"`
}

// New creates a CPA node service.
func New(store *store.Store) *Service {
	return &Service{store: store}
}

// ListNodes returns CPA nodes without management keys.
func (s *Service) ListNodes(ctx context.Context) ([]model.CPANode, error) {
	nodes, err := s.store.CPANodes.List(ctx)
	if err != nil {
		return nil, err
	}
	for i := range nodes {
		nodes[i].ManagementKey = ""
	}
	return nodes, nil
}

// EnabledNodes returns enabled CPA nodes with decrypted management keys.
func (s *Service) EnabledNodes(ctx context.Context) ([]model.CPANode, error) {
	return s.store.CPANodes.ListEnabled(ctx)
}

// GetNode returns one CPA node without its management key.
func (s *Service) GetNode(ctx context.Context, id string) (model.CPANode, error) {
	node, ok, err := s.store.CPANodes.Get(ctx, strings.TrimSpace(id))
	if err != nil {
		return model.CPANode{}, err
	}
	if !ok {
		return model.CPANode{}, ErrNodeNotFound
	}
	node.ManagementKey = ""
	return node, nil
}

// CreateNode validates and persists a new CPA node.
func (s *Service) CreateNode(ctx context.Context, node model.CPANode) (model.CPANode, error) {
	return s.CreateNodeWithOptions(ctx, SaveNodeRequest{CPANode: node})
}

// CreateNodeWithOptions validates, persists, and optionally applies collector defaults.
func (s *Service) CreateNodeWithOptions(ctx context.Context, req SaveNodeRequest) (model.CPANode, error) {
	node := req.CPANode
	node.ID = strings.TrimSpace(node.ID)
	if node.ID == "" {
		node.ID = uuid.NewString()
	}
	node.Name = strings.TrimSpace(node.Name)
	node.BaseURL = cpa.NormalizeBaseURL(node.BaseURL)
	node.ManagementKey = strings.TrimSpace(node.ManagementKey)
	node.Description = strings.TrimSpace(node.Description)
	applyNodeCollectorDefaults(&node, req)
	if node.Name == "" {
		return model.CPANode{}, ErrNodeNameRequired
	}
	if node.BaseURL == "" {
		return model.CPANode{}, ErrNodeBaseURLRequired
	}
	if node.ManagementKey == "" {
		return model.CPANode{}, ErrManagementKeyRequired
	}
	if req.EnsureUsageStatisticsEnabled != nil && *req.EnsureUsageStatisticsEnabled {
		if err := cpa.SetUsageStatisticsEnabled(ctx, node.BaseURL, node.ManagementKey, true); err != nil {
			return model.CPANode{}, err
		}
	}
	created, err := s.store.CPANodes.Create(ctx, node)
	if err != nil {
		return model.CPANode{}, err
	}
	created.ManagementKey = ""
	return created, nil
}

// UpdateNode updates a CPA node. An empty management key keeps the old key.
func (s *Service) UpdateNode(ctx context.Context, id string, submitted model.CPANode) (model.CPANode, error) {
	return s.UpdateNodeWithOptions(ctx, id, SaveNodeRequest{CPANode: submitted})
}

// UpdateNodeWithOptions updates a node and optional collector defaults.
func (s *Service) UpdateNodeWithOptions(ctx context.Context, id string, req SaveNodeRequest) (model.CPANode, error) {
	submitted := req.CPANode
	id = strings.TrimSpace(id)
	current, ok, err := s.store.CPANodes.Get(ctx, id)
	if err != nil {
		return model.CPANode{}, err
	}
	if !ok {
		return model.CPANode{}, ErrNodeNotFound
	}
	next := current
	next.Name = strings.TrimSpace(submitted.Name)
	next.BaseURL = cpa.NormalizeBaseURL(submitted.BaseURL)
	next.Description = strings.TrimSpace(submitted.Description)
	next.Enabled = submitted.Enabled
	applyNodeCollectorDefaults(&next, req)
	if strings.TrimSpace(submitted.ManagementKey) != "" {
		next.ManagementKey = strings.TrimSpace(submitted.ManagementKey)
	}
	if next.Name == "" {
		return model.CPANode{}, ErrNodeNameRequired
	}
	if next.BaseURL == "" {
		return model.CPANode{}, ErrNodeBaseURLRequired
	}
	if next.ManagementKey == "" {
		return model.CPANode{}, ErrManagementKeyRequired
	}
	if err := s.store.CPANodes.Update(ctx, next); err != nil {
		return model.CPANode{}, err
	}
	next.ManagementKey = ""
	return next, nil
}

func applyNodeCollectorDefaults(node *model.CPANode, req SaveNodeRequest) {
	if req.RequestMonitoringEnabled != nil {
		node.CollectorEnabled = *req.RequestMonitoringEnabled
	} else if !node.CollectorEnabled && node.CollectorMode == "" && node.Queue == "" && node.PollIntervalMS <= 0 {
		node.CollectorEnabled = true
	}
	node.CollectorMode = managerconfig.CollectorMode(firstNonEmpty(node.CollectorMode, req.CollectorMode, "auto"))
	node.Queue = firstNonEmpty(strings.TrimSpace(node.Queue), strings.TrimSpace(req.Queue), "usage")
	node.PopSide = managerconfig.NormalizePopSide(firstNonEmpty(node.PopSide, req.PopSide, "right"), "right")
	node.BatchSize = managerconfig.PositiveOrDefault(firstPositive(node.BatchSize, req.BatchSize), 100, 100)
	node.PollIntervalMS = managerconfig.PositiveOrDefault(firstPositive(node.PollIntervalMS, req.PollIntervalMS), 500, 500)
	node.QueryLimit = managerconfig.PositiveOrDefault(firstPositive(node.QueryLimit, req.QueryLimit), 50000, 50000)
	node.TLSSkipVerify = node.TLSSkipVerify || req.TLSSkipVerify
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstPositive(values ...int) int {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}

// DeleteNode deletes a CPA node by ID.
func (s *Service) DeleteNode(ctx context.Context, id string) error {
	return s.store.CPANodes.Delete(ctx, strings.TrimSpace(id))
}

// ValidateNode validates a stored CPA node against its management API.
func (s *Service) ValidateNode(ctx context.Context, id string) error {
	node, ok, err := s.store.CPANodes.Get(ctx, strings.TrimSpace(id))
	if err != nil {
		return err
	}
	if !ok {
		return ErrNodeNotFound
	}
	return cpa.ValidateManagementAPI(ctx, node.BaseURL, node.ManagementKey)
}

// ResolveSetup resolves an enabled CPA node to the legacy setup shape.
func (s *Service) ResolveSetup(ctx context.Context, nodeID string) (store.Setup, error) {
	nodeID = strings.TrimSpace(nodeID)
	if nodeID == "" {
		return store.Setup{}, ErrNodeIDRequired
	}
	node, ok, err := s.store.CPANodes.Get(ctx, nodeID)
	if err != nil {
		return store.Setup{}, err
	}
	if !ok {
		return store.Setup{}, ErrNodeNotFound
	}
	if !node.Enabled {
		return store.Setup{}, ErrNodeDisabled
	}
	return store.Setup{CPAUpstreamURL: node.BaseURL, ManagementKey: node.ManagementKey}, nil
}

// ResolveNode returns an enabled CPA node with decrypted management key.
func (s *Service) ResolveNode(ctx context.Context, nodeID string) (model.CPANode, error) {
	nodeID = strings.TrimSpace(nodeID)
	if nodeID == "" {
		return model.CPANode{}, ErrNodeIDRequired
	}
	node, ok, err := s.store.CPANodes.Get(ctx, nodeID)
	if err != nil {
		return model.CPANode{}, err
	}
	if !ok {
		return model.CPANode{}, ErrNodeNotFound
	}
	if !node.Enabled {
		return model.CPANode{}, ErrNodeDisabled
	}
	return node, nil
}
