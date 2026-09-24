package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/lazyxu/xdrive/internal/admin"
	"github.com/lazyxu/xdrive/internal/config"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const adminUsage = "usage: xdrive-server admin <create|exists|list|reset-password|enable|disable>"

func runAdminCommand(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf(adminUsage)
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
	case "list":
		return listAdminUsers(db, args[1:])
	case "reset-password":
		return resetAdminPassword(db, args[1:])
	case "enable":
		return setAdminAccountDisabled(db, args[1:], false)
	case "disable":
		return setAdminAccountDisabled(db, args[1:], true)
	default:
		return fmt.Errorf(adminUsage)
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
	password, err := readAdminPassword()
	if err != nil {
		return err
	}
	user, err := admin.Bootstrap(db, *username, password)
	if err != nil {
		return err
	}
	fmt.Printf("created xDrive administrator %s (id=%d)\n", user.Username, user.ID)
	return nil
}

func listAdminUsers(db *gorm.DB, args []string) error {
	if len(args) != 0 {
		return fmt.Errorf("usage: xdrive-server admin list")
	}
	users, err := admin.ListUsers(db)
	if err != nil {
		return err
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	if _, err := fmt.Fprintln(w, "ID\tUSERNAME\tROLE\tSTATUS\tMUST_CHANGE\tQUOTA_BYTES\tLAST_LOGIN"); err != nil {
		return err
	}
	for _, user := range users {
		status := "active"
		if user.Disabled {
			status = "disabled"
		}
		lastLogin := "-"
		if user.LastLoginAt != nil {
			lastLogin = user.LastLoginAt.UTC().Format(time.RFC3339)
		}
		if _, err := fmt.Fprintf(w, "%d\t%s\t%s\t%s\t%t\t%d\t%s\n",
			user.ID, user.Username, user.Role, status, user.MustChangePassword, user.QuotaBytes, lastLogin); err != nil {
			return err
		}
	}
	return w.Flush()
}

func resetAdminPassword(db *gorm.DB, args []string) error {
	username, passwordStdin, mustChange, err := parseResetPasswordArgs(args)
	if err != nil {
		return err
	}
	if !passwordStdin {
		return fmt.Errorf("--password-stdin is required")
	}
	password, err := readAdminPassword()
	if err != nil {
		return err
	}
	user, err := admin.ResetPassword(db, username, password, mustChange)
	if err != nil {
		return err
	}
	fmt.Printf("reset password for %s (id=%d); existing sessions revoked; must_change_password=%t\n",
		user.Username, user.ID, user.MustChangePassword)
	return nil
}

func parseResetPasswordArgs(args []string) (username string, passwordStdin, mustChange bool, err error) {
	mustChange = true
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--password-stdin":
			passwordStdin = true
		case "--must-change":
			mustChange = true
		case "--no-must-change":
			mustChange = false
		case "--username":
			i++
			if i >= len(args) {
				return "", false, true, fmt.Errorf("--username requires a value")
			}
			if username != "" {
				return "", false, true, fmt.Errorf("username specified more than once")
			}
			username = strings.TrimSpace(args[i])
		case "--password":
			return "", false, true, fmt.Errorf("--password is not supported; use --password-stdin")
		default:
			if strings.HasPrefix(args[i], "--password=") {
				return "", false, true, fmt.Errorf("--password is not supported; use --password-stdin")
			}
			if strings.HasPrefix(args[i], "-") {
				return "", false, true, fmt.Errorf("unknown option %s", args[i])
			}
			if username != "" {
				return "", false, true, fmt.Errorf("username specified more than once")
			}
			username = strings.TrimSpace(args[i])
		}
	}
	if username == "" {
		return "", false, mustChange, fmt.Errorf("usage: xdrive-server admin reset-password USER [--password-stdin] [--no-must-change]")
	}
	return username, passwordStdin, mustChange, nil
}

func setAdminAccountDisabled(db *gorm.DB, args []string, disabled bool) error {
	username, err := parseSingleUsername(args)
	if err != nil {
		return err
	}
	user, err := admin.SetDisabled(db, username, disabled)
	if err != nil {
		return err
	}
	if disabled {
		fmt.Printf("disabled %s (id=%d); existing sessions revoked\n", user.Username, user.ID)
	} else {
		fmt.Printf("enabled %s (id=%d)\n", user.Username, user.ID)
	}
	return nil
}

func parseSingleUsername(args []string) (string, error) {
	var username string
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--username":
			i++
			if i >= len(args) {
				return "", fmt.Errorf("--username requires a value")
			}
			if username != "" {
				return "", fmt.Errorf("username specified more than once")
			}
			username = strings.TrimSpace(args[i])
		default:
			if strings.HasPrefix(args[i], "-") {
				return "", fmt.Errorf("unknown option %s", args[i])
			}
			if username != "" {
				return "", fmt.Errorf("username specified more than once")
			}
			username = strings.TrimSpace(args[i])
		}
	}
	if username == "" {
		return "", fmt.Errorf("username is required")
	}
	return username, nil
}

func readAdminPassword() (string, error) {
	passwordBytes, err := io.ReadAll(io.LimitReader(os.Stdin, 4097))
	if err != nil {
		return "", fmt.Errorf("read password: %w", err)
	}
	if len(passwordBytes) > 4096 {
		return "", fmt.Errorf("password input is too long")
	}
	password := strings.TrimRight(string(passwordBytes), "\r\n")
	if password == "" {
		return "", fmt.Errorf("password is empty")
	}
	return password, nil
}
