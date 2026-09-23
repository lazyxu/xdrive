package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/lazyxu/xdrive/internal/admin"
	"github.com/lazyxu/xdrive/internal/config"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func runAdminCommand(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: xdrive-server admin <create|exists>")
	}
	db, err := openAdminDB()
	if err != nil {
		return err
	}
	switch args[0] {
	case "exists":
		var count int64
		if err := db.Model(&meta.User{}).Where("role = ?", meta.UserRoleAdmin).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			return fmt.Errorf("no xDrive administrator exists")
		}
		fmt.Println("xDrive administrator exists")
		return nil
	case "create":
		return createBootstrapAdmin(db, args[1:])
	default:
		return fmt.Errorf("usage: xdrive-server admin <create|exists>")
	}
}

func openAdminDB() (*gorm.DB, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{})
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	if err := migrate(db); err != nil {
		return nil, fmt.Errorf("migrate database: %w", err)
	}
	return db, nil
}

func createBootstrapAdmin(db *gorm.DB, args []string) error {
	fs := flag.NewFlagSet("admin create", flag.ContinueOnError)
	username := fs.String("username", "", "administrator username")
	passwordStdin := fs.Bool("password-stdin", false, "read password from standard input")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*username) == "" {
		return fmt.Errorf("--username is required")
	}
	if !*passwordStdin {
		return fmt.Errorf("--password-stdin is required")
	}
	passwordBytes, err := io.ReadAll(io.LimitReader(os.Stdin, 4096))
	if err != nil {
		return fmt.Errorf("read password: %w", err)
	}
	password := strings.TrimRight(string(passwordBytes), "\\r\\n")
	if password == "" {
		return fmt.Errorf("password is empty")
	}
	user, err := admin.Bootstrap(db, *username, password)
	if err != nil {
		return err
	}
	fmt.Printf("created xDrive administrator %s (id=%d)\\n", user.Username, user.ID)
	return nil
}
