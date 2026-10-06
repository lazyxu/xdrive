package fileoperationwake

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"gorm.io/gorm"
)

const (
	PostgreSQLChannel = "xdrive_file_operation_queued"
	reconnectDelay    = 5 * time.Second
)

type Listener struct {
	Wakeups <-chan struct{}
	Ready   <-chan struct{}
}

func InstallPostgreSQLTrigger(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("file operation wake database is required")
	}
	if err := db.Exec(`
CREATE OR REPLACE FUNCTION xd_notify_file_operation_queued()
RETURNS trigger AS $$
BEGIN
	IF NEW.status <> 'queued' THEN
		RETURN NEW;
	END IF;
	IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
		PERFORM pg_notify('xdrive_file_operation_queued', '');
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
`).Error; err != nil {
		return fmt.Errorf("create file operation wake function: %w", err)
	}
	if err := db.Exec(
		`DROP TRIGGER IF EXISTS xd_file_operations_queue_wakeup ON xd_file_operations`,
	).Error; err != nil {
		return fmt.Errorf("drop stale file operation wake trigger: %w", err)
	}
	if err := db.Exec(`
CREATE TRIGGER xd_file_operations_queue_wakeup
AFTER INSERT OR UPDATE OF status ON xd_file_operations
FOR EACH ROW EXECUTE FUNCTION xd_notify_file_operation_queued()
`).Error; err != nil {
		return fmt.Errorf("create file operation wake trigger: %w", err)
	}
	return nil
}

func Listen(
	ctx context.Context,
	databaseURL string,
	logger *slog.Logger,
) Listener {
	wakeups := make(chan struct{}, 1)
	ready := make(chan struct{})
	if logger == nil {
		logger = slog.Default()
	}
	go listen(
		ctx,
		strings.TrimSpace(databaseURL),
		logger,
		wakeups,
		ready,
	)
	return Listener{Wakeups: wakeups, Ready: ready}
}

func listen(
	ctx context.Context,
	databaseURL string,
	logger *slog.Logger,
	wakeups chan<- struct{},
	ready chan struct{},
) {
	var readyOnce sync.Once
	for ctx.Err() == nil {
		conn, err := pgx.Connect(ctx, databaseURL)
		if err != nil {
			if ctx.Err() == nil {
				logger.Warn(
					"file_operation_wakeup_listener_connect_failed",
					"error", err,
				)
			}
			if !sleep(ctx, reconnectDelay) {
				return
			}
			continue
		}
		if _, err := conn.Exec(
			ctx,
			"LISTEN "+PostgreSQLChannel,
		); err != nil {
			if ctx.Err() == nil {
				logger.Warn(
					"file_operation_wakeup_listener_listen_failed",
					"error", err,
				)
			}
			_ = conn.Close(context.Background())
			if !sleep(ctx, reconnectDelay) {
				return
			}
			continue
		}

		readyOnce.Do(func() { close(ready) })
		logger.Info(
			"file_operation_wakeup_listener_ready",
			"channel", PostgreSQLChannel,
		)
		for ctx.Err() == nil {
			if _, err := conn.WaitForNotification(ctx); err != nil {
				if ctx.Err() == nil {
					logger.Warn(
						"file_operation_wakeup_listener_disconnected",
						"error", err,
					)
				}
				break
			}
			select {
			case wakeups <- struct{}{}:
			default:
				logger.Debug("file_operation_wakeup_coalesced")
			}
		}
		_ = conn.Close(context.Background())
		if ctx.Err() == nil && !sleep(ctx, reconnectDelay) {
			return
		}
	}
}

func sleep(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
