package mediawake

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"gorm.io/gorm"
)

const (
	PostgreSQLChannel = "xdrive_media_file_committed"
	reconnectDelay    = 5 * time.Second
	eventBuffer       = 256
)

type Listener struct {
	Events <-chan uint64
	Ready  <-chan struct{}
}

func InstallPostgreSQLTrigger(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("media wake database is required")
	}
	if err := db.Exec(`
CREATE OR REPLACE FUNCTION xd_notify_media_file_commit()
RETURNS trigger AS $$
DECLARE
	media_owner_id BIGINT;
BEGIN
	IF TG_OP = 'UPDATE'
		AND OLD.size IS NOT DISTINCT FROM NEW.size
		AND OLD.storage_key IS NOT DISTINCT FROM NEW.storage_key
		AND OLD.sha256 IS NOT DISTINCT FROM NEW.sha256 THEN
		RETURN NEW;
	END IF;

	SELECT owner_id INTO media_owner_id
	FROM xd_nodes
	WHERE id = NEW.node_id;

	IF media_owner_id IS NOT NULL THEN
		PERFORM pg_notify('xdrive_media_file_committed', media_owner_id::text);
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
`).Error; err != nil {
		return fmt.Errorf("create media file commit wake function: %w", err)
	}
	if err := db.Exec(
		`DROP TRIGGER IF EXISTS xd_files_media_commit_wakeup ON xd_files`,
	).Error; err != nil {
		return fmt.Errorf("drop stale media file commit wake trigger: %w", err)
	}
	if err := db.Exec(`
CREATE TRIGGER xd_files_media_commit_wakeup
AFTER INSERT OR UPDATE OF size, storage_key, sha256 ON xd_files
FOR EACH ROW EXECUTE FUNCTION xd_notify_media_file_commit()
`).Error; err != nil {
		return fmt.Errorf("create media file commit wake trigger: %w", err)
	}
	return nil
}

func Listen(
	ctx context.Context,
	databaseURL string,
	logger *slog.Logger,
) Listener {
	events := make(chan uint64, eventBuffer)
	ready := make(chan struct{})
	if logger == nil {
		logger = slog.Default()
	}
	databaseURL = strings.TrimSpace(databaseURL)

	go listen(ctx, databaseURL, logger, events, ready)
	return Listener{Events: events, Ready: ready}
}

func listen(
	ctx context.Context,
	databaseURL string,
	logger *slog.Logger,
	events chan<- uint64,
	ready chan struct{},
) {
	var readyOnce sync.Once
	for ctx.Err() == nil {
		conn, err := pgx.Connect(ctx, databaseURL)
		if err != nil {
			if ctx.Err() == nil {
				logger.Warn(
					"media_index_wakeup_listener_connect_failed",
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
					"media_index_wakeup_listener_listen_failed",
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
			"media_index_wakeup_listener_ready",
			"channel", PostgreSQLChannel,
		)
		for ctx.Err() == nil {
			notification, err := conn.WaitForNotification(ctx)
			if err != nil {
				if ctx.Err() == nil {
					logger.Warn(
						"media_index_wakeup_listener_disconnected",
						"error", err,
					)
				}
				break
			}
			ownerID, err := parseOwnerID(notification.Payload)
			if err != nil {
				logger.Warn(
					"media_index_wakeup_payload_invalid",
					"payload", notification.Payload,
					"error", err,
				)
				continue
			}
			select {
			case events <- ownerID:
			default:
				logger.Debug(
					"media_index_wakeup_coalesced",
					"owner_id", ownerID,
				)
			}
		}
		_ = conn.Close(context.Background())
		if ctx.Err() == nil && !sleep(ctx, reconnectDelay) {
			return
		}
	}
}

func parseOwnerID(raw string) (uint64, error) {
	value, err := strconv.ParseUint(strings.TrimSpace(raw), 10, 64)
	if err != nil || value == 0 {
		return 0, fmt.Errorf("invalid owner id %q", raw)
	}
	return value, nil
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
