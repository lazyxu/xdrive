package api

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestClipboardValidationRejectsPlaintextAndBadShapes(t *testing.T) {
	nonce := base64.StdEncoding.EncodeToString(make([]byte, 12))
	ciphertext := base64.StdEncoding.EncodeToString(make([]byte, 20))
	good := clipboardWriteRequest{
		ClientEventID: uuid.NewString(), Kind: "text/plain",
		Nonce: nonce, Ciphertext: ciphertext,
	}
	if err := validateClipboardWrite(good); err != nil {
		t.Fatal(err)
	}
	cases := []clipboardWriteRequest{
		{ClientEventID: "plaintext", Kind: "text/plain", Nonce: nonce, Ciphertext: ciphertext},
		{ClientEventID: good.ClientEventID, Kind: "application/json", Nonce: nonce, Ciphertext: ciphertext},
		{ClientEventID: good.ClientEventID, Kind: good.Kind, Nonce: "plain", Ciphertext: ciphertext},
		{ClientEventID: good.ClientEventID, Kind: good.Kind, Nonce: nonce, Ciphertext: "secret password"},
		{ClientEventID: good.ClientEventID, Kind: good.Kind, Nonce: nonce, Ciphertext: base64.StdEncoding.EncodeToString(make([]byte, clipboardMaxText+17))},
		{ClientEventID: good.ClientEventID, Kind: good.Kind, Nonce: nonce, Ciphertext: base64.StdEncoding.EncodeToString(make([]byte, 16))},
	}
	for i, req := range cases {
		if validateClipboardWrite(req) == nil {
			t.Fatalf("invalid case %d accepted", i)
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
		&meta.AuditEvent{}, &meta.ClipboardVault{}, &meta.ClipboardItem{},
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

	// No body or key is accepted from unauthenticated callers.
	request(t, router, http.MethodGet, "/api/v1/clipboard/items", "", nil, http.StatusUnauthorized)
	vaultA := request(t, router, http.MethodGet, "/api/v1/clipboard/vault", a, nil, http.StatusOK)
	vaultB := request(t, router, http.MethodGet, "/api/v1/clipboard/vault", b, nil, http.StatusOK)
	var salts [2]struct {
		Salt string `json:"salt"`
	}
	if json.Unmarshal(vaultA.Body.Bytes(), &salts[0]) != nil ||
		json.Unmarshal(vaultB.Body.Bytes(), &salts[1]) != nil ||
		salts[0].Salt == salts[1].Salt || salts[0].Salt == "" || salts[1].Salt == "" {
		t.Fatal("vault salts must be distinct and Owner-scoped")
	}
	repeated := request(t, router, http.MethodGet, "/api/v1/clipboard/vault", a, nil, http.StatusOK)
	var previous struct {
		Salt string `json:"salt"`
	}
	if json.Unmarshal(repeated.Body.Bytes(), &previous) != nil || previous.Salt != salts[0].Salt {
		t.Fatal("vault initialization was not idempotent")
	}
	nonce := base64.StdEncoding.EncodeToString(make([]byte, 12))
	ciphertext := base64.StdEncoding.EncodeToString([]byte("fake ciphertext and auth tag"))
	check := fmt.Sprintf(`{"nonce":%q,"ciphertext":%q}`, nonce, ciphertext)
	accepted := request(t, router, http.MethodPut, "/api/v1/clipboard/vault/check", a,
		strings.NewReader(check), http.StatusOK)
	var checkDTO struct {
		CheckCiphertext string `json:"check_ciphertext"`
	}
	if json.Unmarshal(accepted.Body.Bytes(), &checkDTO) != nil || checkDTO.CheckCiphertext != ciphertext {
		t.Fatal("initial encrypted vault verifier was not stored")
	}
	otherProof := fmt.Sprintf(`{"nonce":%q,"ciphertext":%q}`, nonce,
		base64.StdEncoding.EncodeToString([]byte("another encrypted verifier")))
	accepted = request(t, router, http.MethodPut, "/api/v1/clipboard/vault/check", a,
		strings.NewReader(otherProof), http.StatusOK)
	if json.Unmarshal(accepted.Body.Bytes(), &checkDTO) != nil || checkDTO.CheckCiphertext != ciphertext {
		t.Fatal("later caller changed the immutable encrypted vault verifier")
	}
	request(t, router, http.MethodPut, "/api/v1/clipboard/vault/check", b,
		strings.NewReader(check), http.StatusOK)
	firstID := uuid.NewString()
	payload := func(id, ct string) string {
		return fmt.Sprintf(`{"client_event_id":%q,"kind":"text/plain","nonce":%q,"ciphertext":%q}`, id, nonce, ct)
	}
	receipt := request(t, router, http.MethodPost, "/api/v1/clipboard/items", a,
		strings.NewReader(payload(firstID, ciphertext)), http.StatusCreated)
	var first clipboardItemResponse
	if err := json.Unmarshal(receipt.Body.Bytes(), &first); err != nil || first.ID == 0 {
		t.Fatalf("invalid encrypted receipt: %s", receipt.Body.String())
	}
	if strings.Contains(receipt.Body.String(), "owner_id") {
		t.Fatal("wire receipt leaks internal Owner identity")
	}
	request(t, router, http.MethodPost, "/api/v1/clipboard/items", a,
		strings.NewReader(payload(firstID, ciphertext)), http.StatusOK)
	request(t, router, http.MethodPost, "/api/v1/clipboard/items", a,
		strings.NewReader(payload(firstID, base64.StdEncoding.EncodeToString([]byte("different secure data")))),
		http.StatusConflict)
	request(t, router, http.MethodGet, "/api/v1/clipboard/items?before=bogus",
		a, nil, http.StatusBadRequest)
	request(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/clipboard/items/%d", first.ID),
		b, nil, http.StatusNotFound)

	for i := 0; i < 55; i++ {
		request(t, router, http.MethodPost, "/api/v1/clipboard/items", a,
			strings.NewReader(payload(uuid.NewString(), ciphertext)), http.StatusCreated)
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
}
