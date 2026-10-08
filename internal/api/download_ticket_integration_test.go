package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestAuthenticatedDownloadTicketsStreamWithoutBearerAndFenceState(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "download_ticket_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}); err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB:    db,
		Store: store,
		Auth:  auth.New("download-ticket-integration-secret", time.Hour),
	}
	router := server.Router()

	user := meta.User{
		Username:       "download-owner",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	accessToken, err := server.Auth.Issue(user.ID, user.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}

	currentBytes := []byte("current-download-content")
	currentKey := "download/current.bin"
	if _, err := store.Put(t.Context(), currentKey, bytes.NewReader(currentBytes)); err != nil {
		t.Fatal(err)
	}
	node := meta.Node{
		Name:     "report.bin",
		Type:     meta.NodeTypeFile,
		OwnerID:  user.ID,
		Revision: 3,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{
		NodeID:     node.ID,
		Size:       int64(len(currentBytes)),
		StorageKey: currentKey,
		SHA256:     strings.Repeat("a", 64),
	}).Error; err != nil {
		t.Fatal(err)
	}

	versionBytes := []byte("version-download-content")
	versionKey := "download/version.bin"
	if _, err := store.Put(t.Context(), versionKey, bytes.NewReader(versionBytes)); err != nil {
		t.Fatal(err)
	}
	version := meta.FileVersion{
		NodeID:     node.ID,
		Revision:   2,
		Size:       int64(len(versionBytes)),
		StorageKey: versionKey,
		SHA256:     strings.Repeat("b", 64),
		CreatedAt:  time.Now().Add(-time.Hour),
	}
	if err := db.Create(&version).Error; err != nil {
		t.Fatal(err)
	}

	ticketRes := request(
		t,
		router,
		http.MethodPost,
		fmt.Sprintf("/api/v1/files/%d/download-ticket", node.ID),
		accessToken,
		nil,
		http.StatusOK,
	)
	var ticket authenticatedDownloadTicketDTO
	if err := json.Unmarshal(ticketRes.Body.Bytes(), &ticket); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(ticket.URL, fmt.Sprintf("/api/v1/file-download/%d?ticket=", node.ID)) ||
		!ticket.ExpiresAt.After(time.Now()) {
		t.Fatalf("ticket=%+v", ticket)
	}

	rangeRes := requestWithHeaders(
		t,
		router,
		http.MethodGet,
		ticket.URL,
		"",
		nil,
		http.StatusPartialContent,
		map[string]string{"Range": "bytes=0-6"},
	)
	if got := rangeRes.Header().Get("Content-Disposition"); !strings.HasPrefix(got, "attachment;") {
		t.Fatalf("content-disposition=%q", got)
	}
	if got := rangeRes.Header().Get("Referrer-Policy"); got != "no-referrer" {
		t.Fatalf("referrer-policy=%q", got)
	}
	if got := rangeRes.Header().Get("Content-Range"); got != fmt.Sprintf("bytes 0-6/%d", len(currentBytes)) {
		t.Fatalf("content-range=%q", got)
	}
	if !bytes.Equal(rangeRes.Body.Bytes(), currentBytes[:7]) {
		t.Fatalf("range bytes=%q want=%q", rangeRes.Body.Bytes(), currentBytes[:7])
	}

	if err := db.Model(&meta.Node{}).Where("id = ?", node.ID).Update("revision", 4).Error; err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodGet, ticket.URL, "", nil, http.StatusGone)

	versionTicketRes := request(
		t,
		router,
		http.MethodPost,
		fmt.Sprintf("/api/v1/files/%d/versions/%d/download-ticket", node.ID, version.ID),
		accessToken,
		nil,
		http.StatusOK,
	)
	var versionTicket authenticatedDownloadTicketDTO
	if err := json.Unmarshal(versionTicketRes.Body.Bytes(), &versionTicket); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(
		versionTicket.URL,
		fmt.Sprintf("/api/v1/file-version-download/%d/%d?ticket=", node.ID, version.ID),
	) {
		t.Fatalf("version ticket=%+v", versionTicket)
	}
	versionRes := request(t, router, http.MethodGet, versionTicket.URL, "", nil, http.StatusOK)
	if !bytes.Equal(versionRes.Body.Bytes(), versionBytes) {
		t.Fatalf("version bytes=%q want=%q", versionRes.Body.Bytes(), versionBytes)
	}

	if err := db.Model(&meta.User{}).Where("id = ?", user.ID).Update("session_version", 2).Error; err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodGet, versionTicket.URL, "", nil, http.StatusUnauthorized)
}
