package api

import (
	"encoding/base64"
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

func TestClipboardAADScopeIsOwnerBoundOrigin(t *testing.T) {
	for _, good := range []string{
		"https://drive.example:42", "https://drive.example:8443:42",
		"http://localhost:5173:42", "https://[::1]:8443:42",
	} {
		if !clipboardValidAADScope(good, 42) {
			t.Fatalf("rejected valid verified Browser scope %q", good)
		}
	}
	for _, bad := range []string{
		"", "https://drive.example:43", "https://drive.example",
		"https://drive.example/a:42", "https://drive.example?query=x:42",
		"https://drive.example#fragment:42", "https://user@drive.example:42",
		"ftp://drive.example:42", "https://drive.example:bad:42",
		"https://drive.example:42" + strings.Repeat("x", 513),
	} {
		if clipboardValidAADScope(bad, 42) {
			t.Fatalf("accepted invalid or cross-Owner Browser scope %q", bad)
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
	scopeA := fmt.Sprintf("https://public.example:%d", ownerA.ID)
	scopeB := fmt.Sprintf("http://localhost:9876:%d", ownerB.ID)

	// The signed SourceRun bearer carries a valid OwnerID but must never
	// inherit the interactive Owner's Clipboard rights on any verb.
	sourceBearer, err := auth.New("clipboard-owner-mailbox-test-secret", time.Hour).
		IssueSourceRunAccess(ownerA.ID, ownerA.SessionVersion, 123, "clipboard-test-run")
	if err != nil {
		t.Fatal(err)
	}
	for _, route := range []struct{ method, path string }{
		{http.MethodGet, "/api/v1/clipboard/vault"},
		{http.MethodPut, "/api/v1/clipboard/vault/check"},
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
	// Encrypted messages cannot be inserted before the vault verifier exists.
	firstID := uuid.NewString()
	payload := func(id, ct string) string {
		return fmt.Sprintf(`{"client_event_id":%q,"kind":"text/plain","nonce":%q,"ciphertext":%q}`, id, nonce, ct)
	}
	request(t, router, http.MethodPost, "/api/v1/clipboard/items", a,
		strings.NewReader(payload(firstID, ciphertext)), http.StatusConflict)
	check := fmt.Sprintf(`{"nonce":%q,"ciphertext":%q,"scope":%q}`, nonce, ciphertext, scopeA)
	accepted := request(t, router, http.MethodPut, "/api/v1/clipboard/vault/check", a,
		strings.NewReader(check), http.StatusOK)
	var checkDTO struct {
		CheckCiphertext string `json:"check_ciphertext"`
		AADScope        string `json:"aad_scope"`
	}
	if json.Unmarshal(accepted.Body.Bytes(), &checkDTO) != nil ||
		checkDTO.CheckCiphertext != ciphertext || checkDTO.AADScope != scopeA {
		t.Fatal("initial encrypted vault verifier and AAD scope were not stored together")
	}
	// Another browser reached through a different public/LAN hostname must
	// receive the SAME first-origin AAD; the Server never rewrites the verifier.
	alias := request(t, router, http.MethodGet, "/api/v1/clipboard/vault", a, nil, http.StatusOK)
	if json.Unmarshal(alias.Body.Bytes(), &checkDTO) != nil || checkDTO.AADScope != scopeA {
		t.Fatal("cross-origin Owner session did not receive pinned original AAD scope")
	}
	otherProof := fmt.Sprintf(`{"nonce":%q,"ciphertext":%q,"scope":%q}`, nonce,
		base64.StdEncoding.EncodeToString([]byte("another encrypted verifier")),
		fmt.Sprintf("https://alias.example:%d", ownerA.ID))
	accepted = request(t, router, http.MethodPut, "/api/v1/clipboard/vault/check", a,
		strings.NewReader(otherProof), http.StatusOK)
	if json.Unmarshal(accepted.Body.Bytes(), &checkDTO) != nil ||
		checkDTO.CheckCiphertext != ciphertext || checkDTO.AADScope != scopeA {
		t.Fatal("later caller changed immutable canary or pinned AAD scope")
	}
	// A's scope cannot be set in B's vault; the Owner ID comes only from
	// the authorized Server bearer and not the submitted JSON suffix.
	request(t, router, http.MethodPut, "/api/v1/clipboard/vault/check", b,
		strings.NewReader(check), http.StatusBadRequest)
	checkB := fmt.Sprintf(`{"nonce":%q,"ciphertext":%q,"scope":%q}`, nonce, ciphertext, scopeB)
	request(t, router, http.MethodPut, "/api/v1/clipboard/vault/check", b,
		strings.NewReader(checkB), http.StatusOK)

	// Old PR #3950 vaults were already encrypted with the original browser
	// origin, but their schema had no AADScope. A locally verified legacy
	// client may pin it without changing the old encrypted canary.
	if err := db.Model(&meta.ClipboardVault{}).Where("owner_id = ?", ownerA.ID).
		Update("aad_scope", "").Error; err != nil {
		t.Fatal(err)
	}
	legacy := request(t, router, http.MethodGet, "/api/v1/clipboard/vault", a, nil, http.StatusOK)
	if json.Unmarshal(legacy.Body.Bytes(), &checkDTO) != nil || checkDTO.AADScope != "" {
		t.Fatal("legacy vault state not reproduced")
	}
	// Competing original-origin claims for a pre-AADScope vault must select
	// exactly one immutable value, even when requests arrive concurrently.
	// Clients verify the legacy canary before reaching this Server handler.
	legacyScopes := []string{scopeA, fmt.Sprintf("https://lan-alias.example:%d", ownerA.ID)}
	const competingClaims = 12
	var claimWG sync.WaitGroup
	claimCodes := make([]int, competingClaims)
	claimScopes := make([]string, competingClaims)
	for i := 0; i < competingClaims; i++ {
		claimWG.Add(1)
		go func(index int) {
			defer claimWG.Done()
			scope := legacyScopes[index%len(legacyScopes)]
			body := fmt.Sprintf(`{"nonce":%q,"ciphertext":%q,"scope":%q}`, nonce, ciphertext, scope)
			req := httptest.NewRequest(http.MethodPut, "/api/v1/clipboard/vault/check", strings.NewReader(body))
			req.Header.Set("Authorization", "Bearer "+a)
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			claimCodes[index] = rec.Code
			var dto struct {
				Scope string `json:"aad_scope"`
			}
			if json.Unmarshal(rec.Body.Bytes(), &dto) == nil {
				claimScopes[index] = dto.Scope
			}
		}(i)
	}
	claimWG.Wait()
	var pinned meta.ClipboardVault
	if err := db.Where("owner_id = ?", ownerA.ID).First(&pinned).Error; err != nil {
		t.Fatal(err)
	}
	if pinned.CheckCiphertext != ciphertext ||
		(pinned.AADScope != legacyScopes[0] && pinned.AADScope != legacyScopes[1]) {
		t.Fatalf("legacy claim failed to pin an immutable AAD scope: %+v", pinned)
	}
	for i := range claimCodes {
		if claimCodes[i] != http.StatusOK || claimScopes[i] != pinned.AADScope {
			t.Fatalf("legacy claim %d returned status=%d scope=%q, pinned=%q",
				i, claimCodes[i], claimScopes[i], pinned.AADScope)
		}
	}
	// An additional conflicting request cannot rewrite the winning scope.
	accepted = request(t, router, http.MethodPut, "/api/v1/clipboard/vault/check", a,
		strings.NewReader(check), http.StatusOK)
	if json.Unmarshal(accepted.Body.Bytes(), &checkDTO) != nil ||
		checkDTO.CheckCiphertext != ciphertext || checkDTO.AADScope != pinned.AADScope {
		t.Fatal("concurrent legacy AAD scope claim changed the immutable canary or winner")
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
    var changeCount int64
    if err := db.Model(&meta.ClipboardChange{}).Where("owner_id = ?", ownerA.ID).
        Count(&changeCount).Error; err != nil || changeCount != 1 {
        t.Fatalf("first create must append one Owner event, idempotent retry none: %v count=%d", err, changeCount)
    }
	request(t, router, http.MethodPost, "/api/v1/clipboard/items", a,
		strings.NewReader(payload(firstID, base64.StdEncoding.EncodeToString([]byte("different secure data")))),
		http.StatusConflict)
	// A retained expired EventID is already invisible in history. Replaying
	// its exact ciphertext must not falsely acknowledge a delivered message.
	if err := db.Model(&meta.ClipboardItem{}).
		Where("owner_id = ? AND client_event_id = ?", ownerA.ID, firstID).
		Update("expires_at", time.Now().UTC().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodPost, "/api/v1/clipboard/items", a,
		strings.NewReader(payload(firstID, ciphertext)), http.StatusConflict)
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

	// Prefill near the cap, then race real authenticated HTTP requests from
	// the SAME Owner. A row lock must keep the final count at exactly 50.
	for i := 0; i < 40; i++ {
		request(t, router, http.MethodPost, "/api/v1/clipboard/items", a,
			strings.NewReader(payload(uuid.NewString(), ciphertext)), http.StatusCreated)
	}
	const parallel = 20
	var wg sync.WaitGroup
	results := make([]int, parallel)
	for i := 0; i < parallel; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			body := payload(uuid.NewString(), ciphertext)
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
	request(t, router, http.MethodGet, "/api/v1/clipboard/vault", b, nil, http.StatusForbidden)
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
	request(t, router, http.MethodGet, "/api/v1/clipboard/vault", a, nil, http.StatusOK)
}
