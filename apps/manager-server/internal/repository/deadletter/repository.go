package deadletter

import (
	"context"
	"database/sql"
	"time"
)

type Repository interface {
	Insert(ctx context.Context, payload string, errText string) error
	InsertWithNode(ctx context.Context, payload string, errText string, nodeID string, nodeName string) error
	Count(ctx context.Context) (int64, error)
}

type repository struct {
	db *sql.DB
}

func New(db *sql.DB) Repository {
	return &repository{db: db}
}

func (r *repository) Insert(ctx context.Context, payload string, errText string) error {
	return r.InsertWithNode(ctx, payload, errText, "", "")
}

func (r *repository) InsertWithNode(ctx context.Context, payload string, errText string, nodeID string, nodeName string) error {
	_, err := r.db.ExecContext(
		ctx,
		`insert into dead_letter_events(payload, error, node_id, node_name_snapshot, created_at_ms) values(?, ?, ?, ?, ?)`,
		payload,
		errText,
		nullString(nodeID),
		nullString(nodeName),
		time.Now().UnixMilli(),
	)
	return err
}

func nullString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func (r *repository) Count(ctx context.Context) (int64, error) {
	var count int64
	if err := r.db.QueryRowContext(ctx, `select count(*) from dead_letter_events`).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}
