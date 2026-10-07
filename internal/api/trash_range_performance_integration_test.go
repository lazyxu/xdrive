package api

import (
	"context"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	clientpkg "github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestTrashRangeBoundsFileExplorerInitialPayload(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, err := baseDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	baseSQL.SetMaxOpenConns(2)
	baseSQL.SetMaxIdleConns(0)
	t.Cleanup(func() { _ = baseSQL.Close() })

	schema := "trash_range_perf_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error })

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(4)
	sqlDB.SetMaxIdleConns(0)
	t.Cleanup(func() { _ = sqlDB.Close() })

	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{}, &meta.AuditEvent{}, &meta.Node{}, &meta.File{}); err != nil {

		t.Fatal(err)

	}
	srv := &Server{
		DB:            db,
		Auth:          auth.New("trash-range-performance-secret", time.Hour),
		RefreshTTL:    24 * time.Hour,
		AllowedOrigin: "http://localhost",
	}
	router := srv.Router()
	token := createTestUser(t, db, router, "trash-range-user", "trash-range-password")
	var user meta.User
	if err := db.Where("username = ?", "trash-range-user").First(&user).Error; err != nil {
		t.Fatal(err)
	}

	deletedAt := time.Now().UTC()
	nodes := make([]meta.Node, 1201)
	for index := range nodes {
		nodes[index] = meta.Node{
			Name:      fmt.Sprintf("trash-%04d.txt", index),
			Type:      meta.NodeTypeFile,
			OwnerID:   user.ID,
			Revision:  1,
			DeletedAt: &deletedAt,
		}
	}
	if err := db.CreateInBatches(&nodes, 200).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.Node{}).
		Where("owner_id = ? AND deleted_at IS NOT NULL", user.ID).
		UpdateColumn("trash_root_id", gorm.Expr("id")).Error; err != nil {
		t.Fatal(err)
	}

	httpServer := httptest.NewServer(router)
	t.Cleanup(httpServer.Close)
	cli := clientpkg.New(httpServer.URL, token)
	ctx := context.Background()

	first, err := cli.TrashRange(ctx, 0, 200, "name", "asc", true)
	if err != nil {
		t.Fatal(err)
	}
	if !first.HasTotalCount() || first.TotalCount != 1201 {
		t.Fatalf("first trash total=%d included=%v want=1201/true", first.TotalCount, first.HasTotalCount())
	}
	if len(first.Items) != 200 {
		t.Fatalf("first trash items=%d want=200", len(first.Items))
	}
	if first.Items[0].Name != "trash-0000.txt" || first.Items[199].Name != "trash-0199.txt" {
		t.Fatalf("first trash boundaries=%q..%q", first.Items[0].Name, first.Items[199].Name)
	}

	last, err := cli.TrashRange(ctx, 1000, 200, "name", "asc", false)
	if err != nil {
		t.Fatal(err)
	}
	if last.HasTotalCount() {
		t.Fatalf("count-free trash range unexpectedly includes total: %+v", last)
	}
	if len(last.Items) != 200 || last.Items[0].Name != "trash-1000.txt" {
		t.Fatalf("trash offset=1000 items=%d first=%q", len(last.Items), last.Items[0].Name)
	}

	legacy, err := cli.Trash(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(legacy) != 1201 {
		t.Fatalf("legacy trash items=%d want=1201", len(legacy))
	}
}
