package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
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
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}, &meta.DownloadProgress{}); err != nil {
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

	// S4C3-A: authentic signed-download 64-bit HTTP Range boundary coverage.
	// Sparse file is deliberately NOT a whole-file SHA or native OS-download proof.
	const largeSize int64 = (4 << 30) + 17
	const cross2GiB int64 = (2 << 30) - 8
	largeKey := "download/pwa-s4c3a-sparse-large.bin"
	filePath := filepath.Join(store.FilesystemRoot(), filepath.FromSlash(largeKey))
	largeFile, err := os.OpenFile(filePath, os.O_CREATE|os.O_TRUNC|os.O_RDWR, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	crossMarker := []byte("S4C3-2GiB-crossing-marker")
	tailMarker := []byte("S4C3-after-4GiB")
	tailOffset := largeSize - int64(len(tailMarker))
	if err := largeFile.Truncate(largeSize); err != nil {
		_ = largeFile.Close()
		t.Fatal(err)
	}
	if _, err := largeFile.WriteAt(crossMarker, cross2GiB); err != nil {
		_ = largeFile.Close()
		t.Fatal(err)
	}
	if _, err := largeFile.WriteAt(tailMarker, tailOffset); err != nil {
		_ = largeFile.Close()
		t.Fatal(err)
	}
	if err := largeFile.Close(); err != nil {
		t.Fatal(err)
	}
	largeNode := meta.Node{Name: "pwa-s4c3a-sparse-large.bin", Type: meta.NodeTypeFile, OwnerID: user.ID, Revision: 7}
	if err := db.Create(&largeNode).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{NodeID: largeNode.ID, Size: largeSize, StorageKey: largeKey,
		SHA256: strings.Repeat("c", 64)}).Error; err != nil {
		t.Fatal(err)
	}
	largeTicketResponse := request(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/files/%d/download-ticket", largeNode.ID), accessToken, nil, http.StatusOK)
	var largeTicket authenticatedDownloadTicketDTO
	if err := json.Unmarshal(largeTicketResponse.Body.Bytes(), &largeTicket); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name   string
		offset int64
		want   []byte
	}{
		{name: "cross 2 GiB", offset: cross2GiB, want: crossMarker},
		{name: "last 16+ bytes beyond 4 GiB", offset: tailOffset, want: tailMarker},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rangeHeader := fmt.Sprintf("bytes=%d-%d", tc.offset, tc.offset+int64(len(tc.want))-1)
			resp := requestWithHeaders(t, router, http.MethodGet, largeTicket.URL, "", nil,
				http.StatusPartialContent, map[string]string{"Range": rangeHeader})
			if got, want := resp.Header().Get("Content-Range"),
				fmt.Sprintf("bytes %d-%d/%d", tc.offset, tc.offset+int64(len(tc.want))-1, largeSize); got != want {
				t.Fatalf("Content-Range=%q want=%q", got, want)
			}
			if got, want := resp.Header().Get("Content-Length"), fmt.Sprint(len(tc.want)); got != want {
				t.Fatalf("Content-Length=%q want=%q", got, want)
			}
			if got := resp.Header().Get("Cache-Control"); !strings.Contains(got, "no-store") {
				t.Fatalf("private download response must not be cached: %q", got)
			}
			if !bytes.Equal(resp.Body.Bytes(), tc.want) {
				t.Fatalf("sparse Range payload mismatch at offset %d", tc.offset)
			}
		})
	}
	beyondEOF := requestWithHeaders(t, router, http.MethodGet, largeTicket.URL, "", nil,
		http.StatusRequestedRangeNotSatisfiable,
		map[string]string{"Range": fmt.Sprintf("bytes=%d-", largeSize)})
	if got, want := beyondEOF.Header().Get("Content-Range"), fmt.Sprintf("bytes */%d", largeSize); got != want {
		t.Fatalf("out-of-bounds Range Content-Range=%q want=%q", got, want)
	}
	// S4C3-B2b: a real TCP/HTTP response cancellation must reach Go's
	// Request.Context(), finish native transfer observation as cancelled,
	// and stop sending well before a 4 GiB sparse Range would complete.
	// This probes transport cancellation only: the independent B2a test
	// covers non-sparse 4 GiB browser-native full disk SHA-256.
	t.Run("cancel live signed 4 GiB HTTP Range", func(t *testing.T) {
		if largeTicket.TransferID == "" {
			t.Fatal("real signed native download must have a transfer progress id")
		}
		peer := httptest.NewServer(router)
		defer peer.Close()
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, peer.URL+largeTicket.URL, nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Range", fmt.Sprintf("bytes=0-%d", largeSize-1))
		resp, err := peer.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != http.StatusPartialContent ||
			resp.Header.Get("Content-Range") != fmt.Sprintf("bytes 0-%d/%d", largeSize-1, largeSize) {
			_ = resp.Body.Close()
			t.Fatal("real live 4 GiB signed Range headers invalid")
		}
		chunk := make([]byte, 32<<10)
		if _, err := io.ReadFull(resp.Body, chunk); err != nil {
			_ = resp.Body.Close()
			t.Fatalf("real live 4 GiB native Range never started: %v", err)
		}
		cancel() // The real httptest TCP client aborts only this request.
		_ = resp.Body.Close()
		deadline := time.Now().Add(12 * time.Second)
		for time.Now().Before(deadline) {
			var progress meta.DownloadProgress
			if err := db.Where("id = ? AND owner_id = ?",
				largeTicket.TransferID, user.ID).First(&progress).Error; err != nil {
				t.Fatal(err)
			}
			if progress.State == "cancelled" && progress.ActiveRequests == 0 {
				if progress.BytesSent <= 0 || progress.BytesSent >= largeSize {
					t.Fatalf("cancelled 4 GiB response reported invalid byte count=%d", progress.BytesSent)
				}
				if progress.FailureState != "cancelled" {
					t.Fatalf("cancelled 4 GiB response failure state=%q", progress.FailureState)
				}
				// Cancellation is request-scoped, not a permanent ticket ban.
				// A later small tail Range is still authenticated and intact.
				tail := requestWithHeaders(t, router, http.MethodGet, largeTicket.URL, "", nil,
					http.StatusPartialContent, map[string]string{
						"Range": fmt.Sprintf("bytes=%d-%d", tailOffset, largeSize-1),
					})
				if !bytes.Equal(tail.Body.Bytes(), tailMarker) {
					t.Fatal("new Range after cancelled request lost tail CAS bytes")
				}
				return
			}
			time.Sleep(100 * time.Millisecond)
		}
		t.Fatal("HTTP client cancellation did not finish the Go download progress as cancelled")
	})
	// Token revocation must fence even a previously valid >4 GiB Range.
	if err := db.Model(&meta.User{}).Where("id = ?", user.ID).Update("session_version", 2).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodGet, largeTicket.URL, "", nil,
		http.StatusUnauthorized, map[string]string{"Range": fmt.Sprintf("bytes=%d-", tailOffset)})
	request(t, router, http.MethodGet, versionTicket.URL, "", nil, http.StatusUnauthorized)
}
