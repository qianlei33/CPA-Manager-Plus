package cpanode

import (
	"context"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/model"
)

// Repository stores managed CPA node definitions.
type Repository interface {
	List(ctx context.Context) ([]model.CPANode, error)
	ListEnabled(ctx context.Context) ([]model.CPANode, error)
	Get(ctx context.Context, id string) (model.CPANode, bool, error)
	Create(ctx context.Context, node model.CPANode) (model.CPANode, error)
	Update(ctx context.Context, node model.CPANode) error
	Delete(ctx context.Context, id string) error
}
