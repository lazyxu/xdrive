package main

import (
	"log"

	"github.com/lazyxu/xdrive/internal/api"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/config"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func main() {
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
		Auth: auth.New(cfg.JWTSecret, cfg.AccessTokenTTL),
		RefreshTTL: cfg.RefreshTokenTTL,
		AllowedOrigin: cfg.AllowedOrigin,
		MaxUploadBytes: cfg.MaxUploadBytes,
	}
	log.Printf("xDrive server listening on %s", cfg.ListenAddr)
	if err := srv.Router().Run(cfg.ListenAddr); err != nil {
		log.Fatal(err)
	}
}

func migrate(db *gorm.DB) error {
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}); err != nil {
		return err
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL`).Error; err != nil {
		return err
	}
	return db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error
}
