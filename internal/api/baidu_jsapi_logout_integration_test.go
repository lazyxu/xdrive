package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// This test exercises the real /auth/logout Gin route with an isolated
// PostgreSQL schema. No real Baidu AK or public JSAPI proxy is involved.
func TestBaiduMapLogoutRevocationAndSignedBootstrapGuard(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated Postgres fixture requires XD_TEST_DATABASE_URL")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "map_logout_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := parsed.Query()
	q.Set("search_path", schema)
	parsed.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{}, &meta.BaiduJSAPIMapEpoch{}, &meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	manager := auth.New("baidu-map-logout-isolated-secret", time.Hour)
	srv := &Server{DB: db, Auth: manager}
	router := srv.Router()
	ctx := context.Background()
	alice := meta.User{Username: "map-alice", PasswordHash: "not-used", Role: meta.UserRoleUser, SessionVersion: 1}
	bob := meta.User{Username: "map-bob", PasswordHash: "not-used", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&alice).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&bob).Error; err != nil {
		t.Fatal(err)
	}
	makeRefresh := func(userID uint64, expires time.Time) (string, string) {
		t.Helper()
		raw, hash, err := auth.NewRefreshToken()
		if err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.RefreshToken{UserID: userID, TokenHash: hash, ExpiresAt: expires}).Error; err != nil {
			t.Fatal(err)
		}
		return raw, hash
	}
	rawAlice, hashAlice := makeRefresh(alice.ID, time.Now().Add(time.Hour))
	rawBob, _ := makeRefresh(bob.ID, time.Now().Add(time.Hour))
	rawExpired, _ := makeRefresh(alice.ID, time.Now().Add(-time.Hour))
	oldAccess, err := manager.Issue(alice.ID, alice.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ensureBaiduMapEpochTx(ctx, db, alice.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := ensureBaiduMapEpochTx(ctx, db, bob.ID); err != nil {
		t.Fatal(err)
	}
	if claims, epoch, err := srv.verifiedMapBootstrapIdentity(ctx, oldAccess, time.Now()); err != nil || claims.UserID != alice.ID || epoch.Epoch != 1 {
		t.Fatalf("signed access/bootstrap preflight rejected: %#v %#v %v", claims, epoch, err)
	}
	testCookie, err := baidumapjsapi.IssueMapSession([]byte(strings.Repeat("k", 32)), baidumapjsapi.MapSessionState{
		OwnerID: alice.ID, SessionVersion: 1, ConfigurationRevision: 7,
		RevocationEpoch: 1, AccountActive: true, RuntimeAuthorized: true,
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	postLogout := func(raw string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", strings.NewReader(fmt.Sprintf(`{"refresh_token":%q}`, raw)))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)
		return w
	}
	// Invalid, expired and missing RefreshTokens remain idempotent and cannot
	// increment any other user's map epoch or record false success audits.
	for _, value := range []string{"not-a-real-refresh-token", rawExpired, ""} {
		if res := postLogout(value); res.Code != http.StatusNoContent {
			t.Fatalf("invalid logout status %d", res.Code)
		}
	}
	before, err := loadBaiduMapEpoch(ctx, db, alice.ID)
	if err != nil || before.Epoch != 1 {
		t.Fatal("invalid refresh token mutated map epoch")
	}
	res := postLogout(rawAlice)
	if res.Code != http.StatusNoContent || !strings.Contains(res.Header().Get("Set-Cookie"), "XD_BMAP_SESSION=") ||
		!strings.Contains(res.Header().Get("Set-Cookie"), "Max-Age=0") {
		t.Fatalf("valid logout did not clear browser map cookie: %d %q", res.Code, res.Header().Get("Set-Cookie"))
	}
	after, err := loadBaiduMapEpoch(ctx, db, alice.ID)
	if err != nil || after.Epoch != 2 || after.RevokedAfter == nil {
		t.Fatalf("map epoch not revoked: %#v %v", after, err)
	}
	var saved meta.RefreshToken
	if err := db.Where("token_hash = ?", hashAlice).Take(&saved).Error; err != nil || saved.RevokedAt == nil {
		t.Fatal("refresh token was not revoked")
	}
	if _, _, err := srv.verifiedMapBootstrapIdentity(ctx, oldAccess, time.Now()); err == nil {
		t.Fatal("old signed, otherwise-live access JWT bypassed logout map cutoff")
	}
	currentState := baidumapjsapi.MapSessionState{
		OwnerID: alice.ID, SessionVersion: 1, ConfigurationRevision: 7,
		RevocationEpoch: after.Epoch, AccountActive: true, RuntimeAuthorized: true,
	}
	if err := baidumapjsapi.VerifyMapSession([]byte(strings.Repeat("k", 32)), testCookie.Value, currentState, time.Now()); err == nil {
		t.Fatal("pre-logout map-only cookie passed new epoch")
	}
	if res := postLogout(rawAlice); res.Code != http.StatusNoContent {
		t.Fatal("replayed logout changed response")
	}
	unchanged, err := loadBaiduMapEpoch(ctx, db, alice.ID)
	if err != nil || unchanged.Epoch != 2 {
		t.Fatal("replayed refresh token incremented epoch")
	}
	other, err := loadBaiduMapEpoch(ctx, db, bob.ID)
	if err != nil || other.Epoch != 1 || other.RevokedAfter != nil {
		t.Fatal("Alice logout revoked Bob")
	}
	if res := postLogout(rawBob); res.Code != http.StatusNoContent {
		t.Fatal("Bob logout failed")
	}
	other, err = loadBaiduMapEpoch(ctx, db, bob.ID)
	if err != nil || other.Epoch != 2 {
		t.Fatal("Bob logout was not owner-scoped")
	}
	var audits []meta.AuditEvent
	if err := db.Where("action = ?", "auth.logout.baidu_jsapi_map_session").Order("id").Find(&audits).Error; err != nil {
		t.Fatal(err)
	}
	if len(audits) != 2 || audits[0].ActorUserID == nil || *audits[0].ActorUserID != alice.ID ||
		strings.Contains(audits[0].Metadata, rawAlice) || strings.Contains(audits[0].Metadata, oldAccess) {
		t.Fatal("missing/unsafe/non-idempotent map logout audit")
	}
	// An audit failure rolls back BOTH the refresh and epoch update.
	rawUnlogged, hashUnlogged := makeRefresh(alice.ID, time.Now().Add(time.Hour))
	if err := db.Migrator().DropTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	if res := postLogout(rawUnlogged); res.Code != http.StatusServiceUnavailable {
		t.Fatalf("failed audit did not fail closed: %d", res.Code)
	}
	saved = meta.RefreshToken{}
	if err := db.Where("token_hash = ?", hashUnlogged).Take(&saved).Error; err != nil || saved.RevokedAt != nil {
		t.Fatal("audit failure unexpectedly committed refresh revocation")
	}
	afterFailed, err := loadBaiduMapEpoch(ctx, db, alice.ID)
	if err != nil || afterFailed.Epoch != 2 {
		t.Fatal("audit failure unexpectedly committed map epoch")
	}
}
