package main

import (
	"context"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/api"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/config"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"github.com/lazyxu/xdrive/internal/version"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "admin":
			if err := runAdminCommand(os.Args[2:]); err != nil {
				log.Fatal(err)
			}
			return
		case "storage":
			if err := runStorageCommand(os.Args[2:]); err != nil {
				log.Fatal(err)
			}
			return
		case "audit":
			if err := runAuditCommand(os.Args[2:]); err != nil {
				log.Fatal(err)
			}
			return
		case "healthcheck":
			if err := runHealthcheck(os.Args[2:]); err != nil {
				log.Fatal(err)
			}
			return
		case "version":
			if err := runVersionCommand(os.Args[2:]); err != nil {
				log.Fatal(err)
			}
			return
		case "source":
			if err := runSourceCommand(os.Args[2:]); err != nil {
				log.Fatal(err)
			}
			return
		case "media":
			if err := runMediaCommand(os.Args[2:]); err != nil {
				log.Fatal(err)
			}
			return
		case "source-credentials":
			if err := runSourceCredentialCommand(os.Args[2:]); err != nil {
				log.Fatal(err)
			}
			return
		case "worker":
			if err := runWorker(os.Args[2:]); err != nil {
				log.Fatal(err)
			}
			return
		}
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{})
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	if err := migrate(db); err != nil {
		log.Fatalf("migrate database: %v", err)
	}
	store, err := storage.NewLocal(cfg.StorageRoot)
	if err != nil {
		log.Fatalf("open local storage: %v", err)
	}
	connectorSecrets, err := connectorsecret.ParseKeyring(
		cfg.ConnectorSecretActiveVersion,
		cfg.ConnectorSecretKeys,
		cfg.ConnectorSecretLegacyKey,
	)
	if err != nil {
		log.Fatalf("invalid connector credential keyring: %v", err)
	}
	srv := &api.Server{
		DB: db, Store: store,
		Auth:                      auth.New(cfg.JWTSecret, cfg.AccessTokenTTL),
		RefreshTTL:                cfg.RefreshTokenTTL,
		AllowedOrigin:             cfg.AllowedOrigin,
		MaxUploadBytes:            cfg.MaxUploadBytes,
		SourceRunFailureRetention: cfg.SourceRunFailureRetention,
		ConnectorSecrets:          connectorSecrets,
		HostControlDir:            strings.TrimSpace(os.Getenv("XD_HOST_CONTROL_DIR")),
	}
	janitorCtx, janitorCancel := context.WithCancel(context.Background())
	defer janitorCancel()
	srv.StartUploadJanitor(janitorCtx)
	srv.StartStorageSampler(janitorCtx)
	srv.StartMediaIndexer(janitorCtx)
	srv.StartFileOperationWorker(janitorCtx)
	slog.Info("server_listening", "address", cfg.ListenAddr)
	if err := srv.Router().Run(cfg.ListenAddr); err != nil {
		log.Fatal(err)
	}
}

func migrate(db *gorm.DB) error {
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}, &meta.ContentBlob{}, &meta.ContentDigestAlias{}, &meta.Share{}, &meta.UploadSession{}, &meta.UploadPart{}, &meta.AuditEvent{}, &meta.StorageSample{}, &meta.StagingCleanupRun{}, &meta.StagingCleanupFailure{}, &meta.Source{}, &meta.SourceItem{}, &meta.SourceItemAlias{}, &meta.SyncRun{}, &meta.SourceRunFailure{}, &meta.SourceCredential{}, &meta.SourceConnectorConfig{}, &meta.SourceCollection{}, &meta.SourceCollectionItem{}, &meta.SourceItemMetadata{}, &meta.MediaMetadata{}, &meta.MediaDerivedResource{}, &meta.MediaGroup{}, &meta.MediaGroupItem{}, &meta.FileOperation{}); err != nil {
		return err
	}
	if err := db.Exec(`UPDATE xd_nodes SET revision = 1 WHERE revision = 0`).Error; err != nil {
		return err
	}
	if err := db.Exec(`UPDATE xd_users SET role = 'user' WHERE role IS NULL OR role = ''`).Error; err != nil {
		return err
	}
	if err := db.Exec(`UPDATE xd_users SET session_version = 1 WHERE session_version = 0`).Error; err != nil {
		return err
	}
	if err := db.Exec(`
		UPDATE xd_upload_sessions
		SET reserved_bytes = 0
		WHERE status <> 'active' OR expires_at <= NOW()
	`).Error; err != nil {
		return err
	}
	if err := db.Exec(`
		UPDATE xd_upload_sessions AS s
		SET reserved_bytes = s.total_size + GREATEST(
			s.total_size - COALESCE((
				SELECT SUM(p.size) FROM xd_upload_parts AS p WHERE p.session_id = s.id
			), 0),
			0
		)
		WHERE s.status = 'active' AND s.expires_at > NOW()
	`).Error; err != nil {
		return err
	}
	if err := db.Exec(`
		UPDATE xd_upload_sessions
		SET quota_reserved_bytes = 0
		WHERE status <> 'active' OR expires_at <= NOW()
	`).Error; err != nil {
		return err
	}
	if err := db.Exec(`
		UPDATE xd_upload_sessions AS s
		SET quota_reserved_bytes = CASE
			WHEN u.quota_bytes <= 0 THEN 0
			WHEN s.sha256 <> '' AND EXISTS (
				SELECT 1
				FROM (
					SELECT f.storage_key
					FROM xd_files f
					JOIN xd_nodes n ON n.id = f.node_id
					WHERE n.owner_id = s.owner_id
					UNION ALL
					SELECT v.storage_key
					FROM xd_file_versions v
					JOIN xd_nodes n ON n.id = v.node_id
					WHERE n.owner_id = s.owner_id
				) refs
				WHERE refs.storage_key = '.xdrive-blobs/sha256/' || substring(lower(s.sha256), 1, 2) || '/' || lower(s.sha256)
			) THEN 0
			ELSE s.total_size
		END
		FROM xd_users u
		WHERE u.id = s.owner_id AND s.status = 'active' AND s.expires_at > NOW()
	`).Error; err != nil {
		return err
	}
	if err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_xd_upload_sessions_owner_active_quota ON xd_upload_sessions(owner_id, expires_at) WHERE status = 'active' AND quota_reserved_bytes > 0`).Error; err != nil {
		return err
	}
	if err := db.Exec(`DROP INDEX IF EXISTS idx_xd_files_storage_key`).Error; err != nil {
		return err
	}
	if err := db.Exec(`DROP INDEX IF EXISTS idx_xd_file_versions_storage_key`).Error; err != nil {
		return err
	}
	if err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_xd_files_storage_key ON xd_files(storage_key)`).Error; err != nil {
		return err
	}
	if err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_xd_file_versions_storage_key ON xd_file_versions(storage_key)`).Error; err != nil {
		return err
	}
	if err := db.Exec(`DROP INDEX IF EXISTS idx_xd_nodes_parent_name`).Error; err != nil {
		return err
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		return err
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		return err
	}
	if err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_xd_nodes_children_name ON xd_nodes(owner_id, parent_id, type, lower(name), id) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		return err
	}
	if err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_xd_nodes_children_updated ON xd_nodes(owner_id, parent_id, type, updated_at, id) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		return err
	}
	if err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_xd_files_size_node ON xd_files(size, node_id)`).Error; err != nil {
		return err
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_sources_owner_name ON xd_sources(owner_id, lower(name))`).Error; err != nil {
		return err
	}
	if err := db.Exec(`
		WITH maxima AS (
			SELECT source_id, COALESCE(MAX(run_number), 0) AS max_run_number
			FROM xd_sync_runs
			GROUP BY source_id
		),
		ranked AS (
			SELECT r.id,
				m.max_run_number + ROW_NUMBER() OVER (
					PARTITION BY r.source_id
					ORDER BY r.started_at ASC, r.created_at ASC, r.id ASC
				) AS run_number
			FROM xd_sync_runs AS r
			JOIN maxima AS m ON m.source_id = r.source_id
			WHERE r.run_number = 0
		)
		UPDATE xd_sync_runs AS r
		SET run_number = ranked.run_number
		FROM ranked
		WHERE r.id = ranked.id
	`).Error; err != nil {
		return err
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_sync_runs_source_run_number ON xd_sync_runs(source_id, run_number) WHERE run_number > 0`).Error; err != nil {
		return err
	}
	if err := db.Exec(`
		INSERT INTO xd_source_run_failures
			(run_id, source_id, source_item_id, external_id, kind, path, size, error, failed_at, created_at, updated_at)
		SELECT si.last_seen_run_id, si.source_id, si.id, si.external_id, si.kind, si.path, si.size,
			si.last_error, COALESCE(si.updated_at, NOW()), NOW(), NOW()
		FROM xd_source_items AS si
		JOIN xd_sync_runs AS r ON r.id = si.last_seen_run_id AND r.source_id = si.source_id
		WHERE si.state = 'error' AND si.last_error <> '' AND si.last_seen_run_id <> ''
		ON CONFLICT (run_id, source_item_id) DO NOTHING
	`).Error; err != nil {
		return err
	}
	if err := migrateLegacyYikeTargets(db); err != nil {
		return fmt.Errorf("migrate legacy Yike targets: %w", err)
	}
	return meta.InstallNodeChangeJournal(db)
}

func runHealthcheck(args []string) error {
	if len(args) > 1 {
		return fmt.Errorf("usage: xdrive-server healthcheck [URL]")
	}
	url := strings.TrimSpace(os.Getenv("XD_HEALTHCHECK_URL"))
	if len(args) == 1 {
		url = strings.TrimSpace(args[0])
	}
	if url == "" {
		url = "http://127.0.0.1:8080/api/v1/readyz"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("health request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("health endpoint returned HTTP %d", resp.StatusCode)
	}
	return nil
}

func runVersionCommand(args []string) error {
	if len(args) != 0 {
		return fmt.Errorf("usage: xdrive-server version")
	}
	info := version.Metadata()
	fmt.Printf("server version: %s\n", info.Version)
	if info.Channel != "" {
		fmt.Printf("channel: %s\n", info.Channel)
	}
	if info.Commit != "" {
		fmt.Printf("commit: %s\n", info.Commit)
	}
	if info.CommitMessage != "" {
		fmt.Printf("commit message: %s\n", info.CommitMessage)
	}
	if info.CommitTime != "" {
		fmt.Printf("commit time: %s\n", info.CommitTime)
	}
	if info.BuildTime != "" {
		fmt.Printf("build time: %s\n", info.BuildTime)
	}
	return nil
}
