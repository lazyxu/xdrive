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

func TestFilePreviewTicketRangeAndSafety(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "file_preview_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()

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
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{}); err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB: db, Store: store,
		Auth: auth.New("file-preview-integration-secret", time.Hour),
	}
	router := server.Router()

	user := meta.User{
		Username: "preview-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	token, err := server.Auth.Issue(user.ID, user.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}

	pdf := []byte("%PDF-1.7\n0123456789abcdefghijklmnopqrstuvwxyz\n%%EOF")
	const storageKey = "preview/document.pdf"
	if _, err := store.Put(t.Context(), storageKey, bytes.NewReader(pdf)); err != nil {
		t.Fatal(err)
	}
	node := meta.Node{
		Name: "document.pdf", Type: meta.NodeTypeFile,
		OwnerID: user.ID, Revision: 1,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	file := meta.File{
		NodeID: node.ID, Size: int64(len(pdf)), StorageKey: storageKey,
		SHA256: strings.Repeat("b", 64),
	}
	if err := db.Create(&file).Error; err != nil {
		t.Fatal(err)
	}

	ticketResponse := request(
		t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/files/%d/preview-ticket", node.ID),
		token, nil, http.StatusOK,
	)
	var ticket filePreviewTicketDTO
	if err := json.Unmarshal(ticketResponse.Body.Bytes(), &ticket); err != nil {
		t.Fatal(err)
	}
	if ticket.Kind != "pdf" || ticket.MIMEType != "application/pdf" ||
		!strings.HasPrefix(ticket.URL, fmt.Sprintf("/api/v1/file-preview/%d?ticket=", node.ID)) ||
		!ticket.ExpiresAt.After(time.Now()) {
		t.Fatalf("ticket=%+v", ticket)
	}

	rangeResponse := requestWithHeaders(
		t, router, http.MethodGet, ticket.URL, "", nil, http.StatusPartialContent,
		map[string]string{"Range": "bytes=0-7"},
	)
	if got := rangeResponse.Header().Get("Content-Type"); got != "application/pdf" {
		t.Fatalf("content-type=%q", got)
	}
	if got := rangeResponse.Header().Get("Content-Range"); got != fmt.Sprintf("bytes 0-7/%d", len(pdf)) {
		t.Fatalf("content-range=%q", got)
	}
	if !bytes.Equal(rangeResponse.Body.Bytes(), pdf[:8]) {
		t.Fatalf("range bytes=%q want=%q", rangeResponse.Body.Bytes(), pdf[:8])
	}
	if got := rangeResponse.Header().Get("Content-Disposition"); !strings.HasPrefix(got, "inline;") {
		t.Fatalf("content-disposition=%q", got)
	}
	if got := rangeResponse.Header().Get("Referrer-Policy"); got != "no-referrer" {
		t.Fatalf("referrer-policy=%q", got)
	}
	if got := rangeResponse.Header().Get("ETag"); got != "\"file-preview-"+strings.Repeat("b", 64)+"\"" {
		t.Fatalf("etag=%q", got)
	}

	authedRange := requestWithHeaders(
		t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/files/%d/preview", node.ID),
		token, nil, http.StatusPartialContent,
		map[string]string{"Range": "bytes=8-15"},
	)
	if !bytes.Equal(authedRange.Body.Bytes(), pdf[8:16]) {
		t.Fatalf("authenticated range bytes=%q want=%q", authedRange.Body.Bytes(), pdf[8:16])
	}

	unsafe := meta.Node{
		Name: "active.html", Type: meta.NodeTypeFile,
		OwnerID: user.ID, Revision: 1,
	}
	if err := db.Create(&unsafe).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{
		NodeID: unsafe.ID, Size: 7, StorageKey: "preview/active.html",
	}).Error; err != nil {
		t.Fatal(err)
	}
	request(
		t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/files/%d/preview-ticket", unsafe.ID),
		token, nil, http.StatusUnsupportedMediaType,
	)

	if err := db.Model(&meta.Node{}).Where("id = ?", node.ID).
		Update("revision", gorm.Expr("revision + 1")).Error; err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodGet, ticket.URL, "", nil, http.StatusGone)
}
