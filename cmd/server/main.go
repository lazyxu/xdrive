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
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
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
	srv := &api.Server{
		DB: db, Store: store,
		Auth:           auth.New(cfg.JWTSecret, cfg.AccessTokenTTL),
		RefreshTTL:     cfg.RefreshTokenTTL,
		AllowedOrigin:  cfg.AllowedOrigin,
		MaxUploadBytes: cfg.MaxUploadBytes,
	}
	janitorCtx, janitorCancel := context.WithCancel(context.Background())
	defer janitorCancel()
	srv.StartUploadJanitor(janitorCtx)
	slog.Info("server_listening", "address", cfg.ListenAddr)
	if err := srv.Router().Run(cfg.ListenAddr); err != nil {
		log.Fatal(err)
	}
}

func migrate(db *gorm.DB) error {
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}, &meta.Share{}, &meta.UploadSession{}, &meta.UploadPart{}, &meta.AuditEvent{}); err != nil {
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
	if err := db.Exec(`DROP INDEX IF EXISTS idx_xd_nodes_parent_name`).Error; err != nil {
		return err
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		return err
	}
	return db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error
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
