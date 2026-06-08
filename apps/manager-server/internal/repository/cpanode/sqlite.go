package cpanode

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/model"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/security"
)

type repository struct {
	db        *sql.DB
	protector *security.Protector
}

// New creates a SQLite CPA node repository.
func New(db *sql.DB, protector ...*security.Protector) Repository {
	var p *security.Protector
	if len(protector) > 0 {
		p = protector[0]
	}
	return &repository{db: db, protector: p}
}

func (r *repository) List(ctx context.Context) ([]model.CPANode, error) {
	rows, err := r.db.QueryContext(ctx, selectNodeColumns+`
		from cpa_nodes order by created_at_ms asc, name asc`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanNodes(rows, r.unprotect)
}

func (r *repository) ListEnabled(ctx context.Context) ([]model.CPANode, error) {
	rows, err := r.db.QueryContext(ctx, selectNodeColumns+`
		from cpa_nodes where enabled = 1 order by created_at_ms asc, name asc`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanNodes(rows, r.unprotect)
}

func (r *repository) Get(ctx context.Context, id string) (model.CPANode, bool, error) {
	row := r.db.QueryRowContext(ctx, selectNodeColumns+`
		from cpa_nodes where id = ?`, id)
	node, err := scanNode(row)
	if errors.Is(err, sql.ErrNoRows) {
		return model.CPANode{}, false, nil
	}
	if err != nil {
		return model.CPANode{}, false, err
	}
	node, err = r.unprotect(node)
	if err != nil {
		return model.CPANode{}, false, err
	}
	return node, true, nil
}

func (r *repository) Create(ctx context.Context, node model.CPANode) (model.CPANode, error) {
	now := time.Now().UnixMilli()
	if node.CreatedAtMS <= 0 {
		node.CreatedAtMS = now
	}
	node.UpdatedAtMS = now
	protected, err := r.protect(node)
	if err != nil {
		return model.CPANode{}, err
	}
	_, err = r.db.ExecContext(ctx, `insert into cpa_nodes(
		id, name, base_url, management_key, enabled, description,
		collector_enabled, collector_mode, queue, pop_side, batch_size, poll_interval_ms, query_limit, tls_skip_verify,
		created_at_ms, updated_at_ms
	) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, protected.ID, protected.Name, protected.BaseURL, protected.ManagementKey, boolInt(protected.Enabled), nullString(protected.Description), boolInt(protected.CollectorEnabled), protected.CollectorMode, protected.Queue, protected.PopSide, protected.BatchSize, protected.PollIntervalMS, protected.QueryLimit, boolInt(protected.TLSSkipVerify), protected.CreatedAtMS, protected.UpdatedAtMS)
	if err != nil {
		return model.CPANode{}, err
	}
	return node, nil
}

func (r *repository) Update(ctx context.Context, node model.CPANode) error {
	protected, err := r.protect(node)
	if err != nil {
		return err
	}
	protected.UpdatedAtMS = time.Now().UnixMilli()
	_, err = r.db.ExecContext(ctx, `update cpa_nodes set
		name = ?, base_url = ?, management_key = ?, enabled = ?, description = ?,
		collector_enabled = ?, collector_mode = ?, queue = ?, pop_side = ?, batch_size = ?, poll_interval_ms = ?, query_limit = ?, tls_skip_verify = ?,
		updated_at_ms = ?
		where id = ?`,
		protected.Name, protected.BaseURL, protected.ManagementKey, boolInt(protected.Enabled), nullString(protected.Description), boolInt(protected.CollectorEnabled), protected.CollectorMode, protected.Queue, protected.PopSide, protected.BatchSize, protected.PollIntervalMS, protected.QueryLimit, boolInt(protected.TLSSkipVerify), protected.UpdatedAtMS, protected.ID)
	return err
}

func (r *repository) Delete(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `delete from cpa_nodes where id = ?`, id)
	return err
}

func scanNodes(rows *sql.Rows, unprotect func(model.CPANode) (model.CPANode, error)) ([]model.CPANode, error) {
	nodes := make([]model.CPANode, 0)
	for rows.Next() {
		node, err := scanNode(rows)
		if err != nil {
			return nil, err
		}
		node, err = unprotect(node)
		if err != nil {
			return nil, err
		}
		nodes = append(nodes, node)
	}
	return nodes, rows.Err()
}

type scanner interface {
	Scan(dest ...any) error
}

const selectNodeColumns = `select id, name, base_url, management_key, enabled, description,
	collector_enabled, collector_mode, queue, pop_side, batch_size, poll_interval_ms, query_limit, tls_skip_verify,
	created_at_ms, updated_at_ms`

func scanNode(row scanner) (model.CPANode, error) {
	var node model.CPANode
	var enabled, collectorEnabled, tlsSkipVerify int
	var description sql.NullString
	if err := row.Scan(
		&node.ID,
		&node.Name,
		&node.BaseURL,
		&node.ManagementKey,
		&enabled,
		&description,
		&collectorEnabled,
		&node.CollectorMode,
		&node.Queue,
		&node.PopSide,
		&node.BatchSize,
		&node.PollIntervalMS,
		&node.QueryLimit,
		&tlsSkipVerify,
		&node.CreatedAtMS,
		&node.UpdatedAtMS,
	); err != nil {
		return model.CPANode{}, err
	}
	node.Enabled = enabled != 0
	node.Description = description.String
	node.CollectorEnabled = collectorEnabled != 0
	node.TLSSkipVerify = tlsSkipVerify != 0
	return node, nil
}

func (r *repository) protect(node model.CPANode) (model.CPANode, error) {
	if r.protector == nil {
		return node, nil
	}
	value, err := r.protector.ProtectString(node.ManagementKey)
	if err != nil {
		return model.CPANode{}, err
	}
	node.ManagementKey = value
	return node, nil
}

func (r *repository) unprotect(node model.CPANode) (model.CPANode, error) {
	if r.protector == nil {
		return node, nil
	}
	value, err := r.protector.UnprotectString(node.ManagementKey)
	if err != nil {
		return model.CPANode{}, err
	}
	node.ManagementKey = value
	return node, nil
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func nullString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
