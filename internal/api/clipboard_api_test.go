package api

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestClipboardValidationAcceptsPlaintextAndRejectsInvalidShapes(t *testing.T) {
	good := clipboardWriteRequest{ClientEventID: uuid.NewString(), Kind: "text/plain", Content: "Hello from Clipboard"}
	if err := validateClipboardWrite(good); err != nil {
		t.Fatal(err)
	}
	bad := []clipboardWriteRequest{
		{ClientEventID: "not-an-event", Kind: good.Kind, Content: good.Content},
		{ClientEventID: good.ClientEventID, Kind: "application/json", Content: good.Content},
		{ClientEventID: good.ClientEventID, Kind: good.Kind},
		{ClientEventID: good.ClientEventID, Kind: good.Kind, Content: strings.Repeat("x", clipboardMaxText+1)},
		{ClientEventID: good.ClientEventID, Kind: good.Kind, Content: string([]byte{0xff})},
		{ClientEventID: good.ClientEventID, Kind: good.Kind, Content: "asset:42", NodeID: 42},
		{ClientEventID: good.ClientEventID, Kind: "image/x-xdrive-node-ref", Content: "asset:42", NodeID: 42},
	}
	for i, item := range bad {
		if validateClipboardWrite(item) == nil {
			t.Fatalf("invalid plaintext case %d accepted", i)
		}
	}
}

func TestClipboardOwnerMailboxPostgres(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	base, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "clipboard_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := base.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = base.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error })
	dsnURL, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := dsnURL.Query()
	query.Set("search_path", schema)
	dsnURL.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(dsnURL.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{},
		&meta.FileVersion{}, &meta.ContentBlob{}, &meta.Share{},
		&meta.UploadSession{}, &meta.UploadPart{}, &meta.LocalPushQuotaHold{},
		&meta.AuditEvent{}, &meta.ClipboardVault{}, &meta.ClipboardItem{}, &meta.ClipboardChange{},
	); err != nil {
		t.Fatal(err)
	}
	router := (&Server{
		DB: db, Auth: auth.New("clipboard-owner-mailbox-test-secret", time.Hour),
		RefreshTTL: time.Hour, AllowedOrigin: "http://localhost",
		MaxUploadBytes: 10 << 20,
	}).Router()
	a := createTestUser(t, db, router, "clipboard-owner-a", "clipboard-pass-a")
	b := createTestUser(t, db, router, "clipboard-owner-b", "clipboard-pass-b")
	var ownerA, ownerB meta.User
	if err := db.Where("username = ?", "clipboard-owner-a").First(&ownerA).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("username = ?", "clipboard-owner-b").First(&ownerB).Error; err != nil {
		t.Fatal(err)
	}
	// The signed SourceRun bearer carries a valid OwnerID but must never
	// inherit the interactive Owner's Clipboard rights on any verb.
	sourceBearer, err := auth.New("clipboard-owner-mailbox-test-secret", time.Hour).
		IssueSourceRunAccess(ownerA.ID, ownerA.SessionVersion, 123, "clipboard-test-run")
	if err != nil {
		t.Fatal(err)
	}
	for _, route := range []struct{ method, path string }{
		{http.MethodGet, "/api/v1/clipboard/items"},
		{http.MethodGet, "/api/v1/clipboard/events"},
		{http.MethodPost, "/api/v1/clipboard/items"},
		{http.MethodDelete, "/api/v1/clipboard/items/1"},
		{http.MethodDelete, "/api/v1/clipboard/items"},
	} {
		request(t, router, route.method, route.path, sourceBearer, nil, http.StatusForbidden)
	}

	// No body or key is accepted from unauthenticated callers.
	request(t, router, http.MethodGet, "/api/v1/clipboard/items", "", nil, http.StatusUnauthorized)
	// Legacy unlock endpoints are gone. Signed-in Owners can immediately send.
	request(t, router, http.MethodGet, "/api/v1/clipboard/vault", a, nil, http.StatusNotFound)
	request(t, router, http.MethodPut, "/api/v1/clipboard/vault/check", a,
		strings.NewReader("{}"), http.StatusNotFound)
	content := "test plaintext clipboard payload"
	firstID := uuid.NewString()
	payload := func(id, value string) string {
		return fmt.Sprintf(`{"client_event_id":%q,"kind":"text/plain","content":%q}`, id, value)
	}
	// The former encrypted-only JSON contract cannot create a plaintext item.
	request(t, router, http.MethodPost, "/api/v1/clipboard/items", a,
		strings.NewReader(fmt.Sprintf(`{"client_event_id":%q,"kind":"text/plain","nonce":"old","ciphertext":"old"}`, uuid.NewString())),
		http.StatusBadRequest)
	receipt := request(t, router, http.MethodPost, "/api/v1/clipboard/items", a,
		strings.NewReader(payload(firstID, content)), http.StatusCreated)
	var first clipboardItemResponse
	if err := json.Unmarshal(receipt.Body.Bytes(), &first); err != nil || first.ID == 0 {
		t.Fatalf("invalid plaintext receipt: %s", receipt.Body.String())
	}
	if strings.Contains(receipt.Body.String(), "owner_id") {
		t.Fatal("wire receipt leaks internal Owner identity")
	}
	request(t, router, http.MethodPost, "/api/v1/clipboard/items", a,
		strings.NewReader(payload(firstID, content)), http.StatusOK)
	var changeCount int64
	if err := db.Model(&meta.ClipboardChange{}).Where("owner_id = ?", ownerA.ID).
		Count(&changeCount).Error; err != nil || changeCount != 1 {
		t.Fatalf("first create must append one Owner event, idempotent retry none: %v count=%d", err, changeCount)
	}

	// Real HTTP/SSE framing: a stream for A begins with an encrypted-content-free
	// sync hint and the committed Owner A change ID; it must never carry the
	// message's nonce or content. Keep the HTTP context bounded so the
	// handler's 20s reconnect timer cannot stall CI.
	streamServer := httptest.NewServer(router)
	defer streamServer.Close()
	{
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet,
			streamServer.URL+"/api/v1/clipboard/events?after=0", nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+a)
		req.Header.Set("Accept", "text/event-stream")
		response, err := streamServer.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK ||
			!strings.Contains(response.Header.Get("Content-Type"), "text/event-stream") {
			t.Fatalf("Owner SSE stream rejected: status=%d type=%q",
				response.StatusCode, response.Header.Get("Content-Type"))
		}
		scanner := bufio.NewScanner(response.Body)
		var frames strings.Builder
		for scanner.Scan() {
			frames.WriteString(scanner.Text())
			frames.WriteByte('\n')
			if strings.Contains(frames.String(), "event: change") &&
				strings.Contains(frames.String(), "id: ") {
				break
			}
		}
		if err := scanner.Err(); err != nil {
			t.Fatalf("Owner SSE did not produce a change cursor: %v", err)
		}
		wire := frames.String()
		if !strings.Contains(wire, "event: sync") ||
			!strings.Contains(wire, "event: change") ||
			!strings.Contains(wire, "id: ") ||
			strings.Contains(wire, content) {
			t.Fatalf("Owner SSE did not carry only invalidation cursors: %q", wire)
		}
		cancel()
		_ = response.Body.Close() // Disconnect immediately, not at test teardown.
	}
	request(t, router, http.MethodPost, "/api/v1/clipboard/items", a,
		strings.NewReader(payload(firstID, "different plaintext")),
		http.StatusConflict)
	// A retained expired EventID is already invisible in history. Replaying
	// its exact content must not falsely acknowledge a delivered message.
	if err := db.Model(&meta.ClipboardItem{}).
		Where("owner_id = ? AND client_event_id = ?", ownerA.ID, firstID).
		Update("expires_at", time.Now().UTC().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodPost, "/api/v1/clipboard/items", a,
		strings.NewReader(payload(firstID, content)), http.StatusConflict)
	request(t, router, http.MethodGet, "/api/v1/clipboard/items?before=bogus",
		a, nil, http.StatusBadRequest)
	request(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/clipboard/items/%d", first.ID),
		b, nil, http.StatusNotFound)

	for i := 0; i < 55; i++ {
		request(t, router, http.MethodPost, "/api/v1/clipboard/items", a,
			strings.NewReader(payload(uuid.NewString(), content)), http.StatusCreated)
	}
	page := request(t, router, http.MethodGet, "/api/v1/clipboard/items", a, nil, http.StatusOK)
	var list struct {
		Items      []clipboardItemResponse `json:"items"`
		NextBefore *uint64                 `json:"next_before"`
	}
	if err := json.Unmarshal(page.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Items) != clipboardPageSize || list.NextBefore != nil {
		t.Fatalf("retention exceeds 50 rows or misleading cursor: %+v", list)
	}
	other := request(t, router, http.MethodGet, "/api/v1/clipboard/items", b, nil, http.StatusOK)
	var otherList struct {
		Items []clipboardItemResponse `json:"items"`
	}
	if err := json.Unmarshal(other.Body.Bytes(), &otherList); err != nil || len(otherList.Items) != 0 {
		t.Fatalf("Owner B saw Owner A items: %s", other.Body.String())
	}
	request(t, router, http.MethodDelete, "/api/v1/clipboard/items", b, nil, http.StatusNoContent)
	request(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/clipboard/items/%d", list.Items[0].ID),
		a, nil, http.StatusNoContent)
	if err := db.Model(&meta.ClipboardItem{}).
		Where("client_event_id = ?", list.Items[1].ClientEventID).
		Update("expires_at", time.Now().UTC().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	page = request(t, router, http.MethodGet, "/api/v1/clipboard/items", a, nil, http.StatusOK)
	if json.Unmarshal(page.Body.Bytes(), &list) != nil || len(list.Items) != clipboardPageSize-2 {
		t.Fatalf("delete/expiry filtering failed: %s", page.Body.String())
	}
	request(t, router, http.MethodDelete, "/api/v1/clipboard/items", a, nil, http.StatusNoContent)
	page = request(t, router, http.MethodGet, "/api/v1/clipboard/items", a, nil, http.StatusOK)
	if json.Unmarshal(page.Body.Bytes(), &list) != nil || len(list.Items) != 0 {
		t.Fatalf("Owner clear failed: %s", page.Body.String())
	}

	// Prefill near the cap, then race real authenticated HTTP requests from
	// the SAME Owner. A row lock must keep the final count at exactly 50.
	for i := 0; i < 40; i++ {
		request(t, router, http.MethodPost, "/api/v1/clipboard/items", a,
			strings.NewReader(payload(uuid.NewString(), content)), http.StatusCreated)
	}
	const parallel = 20
	var wg sync.WaitGroup
	results := make([]int, parallel)
	for i := 0; i < parallel; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			body := payload(uuid.NewString(), content)
			req := httptest.NewRequest(http.MethodPost, "/api/v1/clipboard/items", strings.NewReader(body))
			req.Header.Set("Authorization", "Bearer "+a)
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			results[index] = rec.Code
		}(i)
	}
	wg.Wait()
	for i, code := range results {
		if code != http.StatusCreated {
			t.Fatalf("concurrent send %d status=%d; expected %d", i, code, http.StatusCreated)
		}
	}
	var retained int64
	if err := db.Model(&meta.ClipboardItem{}).Where("owner_id = ?", ownerA.ID).
		Count(&retained).Error; err != nil {
		t.Fatal(err)
	}
	if retained != clipboardPageSize {
		t.Fatalf("concurrent same-Owner sends retained %d rows, wanted %d", retained, clipboardPageSize)
	}
	if err := db.Model(&meta.ClipboardChange{}).
		Where("owner_id = ?", ownerA.ID).Count(&changeCount).Error; err != nil ||
		changeCount == 0 || changeCount > clipboardChangeCap {
		t.Fatalf("SSE events must be bounded per Owner: %v count=%d", err, changeCount)
	}
	var bEvents int64
	if err := db.Model(&meta.ClipboardChange{}).
		Where("owner_id = ?", ownerB.ID).Count(&bEvents).Error; err != nil || bEvents != 0 {
		t.Fatalf("one Owner's events reached another Owner: %v count=%d", err, bEvents)
	}
	other = request(t, router, http.MethodGet, "/api/v1/clipboard/items", b, nil, http.StatusOK)
	if json.Unmarshal(other.Body.Bytes(), &otherList) != nil || len(otherList.Items) != 0 {
		t.Fatalf("concurrent Owner A writes leaked to Owner B: %s", other.Body.String())
	}

	// Password-rotation gate, disabled accounts and revoked session versions
	// must block the real Owner token, not merely reject malformed JSON.
	if err := db.Model(&meta.User{}).Where("id = ?", ownerB.ID).
		Update("must_change_password", true).Error; err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodGet, "/api/v1/clipboard/items", b, nil, http.StatusForbidden)
	if err := db.Model(&meta.User{}).Where("id = ?", ownerB.ID).
		Update("must_change_password", false).Error; err != nil {
		t.Fatal(err)
	}
	disabledAt := time.Now().UTC()
	if err := db.Model(&meta.User{}).Where("id = ?", ownerB.ID).
		Update("disabled_at", &disabledAt).Error; err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodGet, "/api/v1/clipboard/items", b, nil, http.StatusForbidden)
	if err := db.Model(&meta.User{}).Where("id = ?", ownerB.ID).
		Update("disabled_at", nil).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.User{}).Where("id = ?", ownerB.ID).
		Update("session_version", ownerB.SessionVersion+1).Error; err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodGet, "/api/v1/clipboard/items", b, nil, http.StatusUnauthorized)
	request(t, router, http.MethodGet, "/api/v1/clipboard/items", a, nil, http.StatusOK)

	// Revocation during a live SSE connection must close it without waiting for
	// the 20-second maximum duration or sending any new Owner data.
	var lastChangeID uint64
	if err := db.Raw("SELECT COALESCE(MAX(id), 0) FROM xd_clipboard_changes WHERE owner_id = ?",
		ownerA.ID).Scan(&lastChangeID).Error; err != nil {
		t.Fatal(err)
	}
	{
		ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet,
			fmt.Sprintf("%s/api/v1/clipboard/events?after=%d", streamServer.URL, lastChangeID), nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+a)
		response, err := streamServer.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("Owner SSE stream before revocation returned %d", response.StatusCode)
		}
		scanner := bufio.NewScanner(response.Body)
		sawSync := false
		for scanner.Scan() {
			if scanner.Text() == "event: sync" {
				sawSync = true
				break
			}
		}
		if err := scanner.Err(); err != nil || !sawSync {
			t.Fatalf("Owner SSE handshake failed (sync=%v): %v", sawSync, err)
		}
		if err := db.Model(&meta.User{}).Where("id = ?", ownerA.ID).
			Update("session_version", ownerA.SessionVersion+1).Error; err != nil {
			t.Fatal(err)
		}
		for scanner.Scan() {
			if strings.HasPrefix(scanner.Text(), "event: change") {
				t.Fatal("revoked Owner SSE stream emitted an additional change")
			}
		}
		if err := scanner.Err(); err != nil {
			t.Fatalf("revoked Owner SSE did not close promptly: %v", err)
		}
	}
}
