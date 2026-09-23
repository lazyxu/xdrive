package main

import (
	"log"
	"os"

	"github.com/lazyxu/xdrive/internal/api"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/config"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func main() {
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
	log.Printf("xDrive server listening on %s", cfg.ListenAddr)
	if err := srv.Router().Run(cfg.ListenAddr); err != nil {
		log.Fatal(err)
	}
}

func migrate(db *gorm.DB) error {
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}); err != nil {
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
