//go:build linux

package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

// Tests real isolated PostgreSQL, without deployed Owner accounts or secrets.
func TestDesktopMapBrowserSessionProbeRevokeAndOwnerPostgres(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL fixture is not configured")
	}
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{}); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{Username: "probe-" + uuid.NewString(),
		PasswordHash: "synthetic", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	s := &Server{DB: db, Auth: auth.New("desktop-map-probe-test-only", 15*time.Minute),
		RefreshTTL: time.Hour}
	issued, err := s.issueSession(db, owner)
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/v1/auth/desktop-map/session", s.desktopMapBrowserSessionProbe)
	const origin = "https://drive.example.test:8443"
	probe := func(token, expected string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost,
			origin+"/api/v1/auth/desktop-map/session", strings.NewReader(""))
		req.Header.Set("Origin", origin)
		req.Header.Set("Sec-Fetch-Site", "same-origin")
		req.Header.Set("X-XDrive-Browser-Owner", expected)
		if token != "" {
			req.AddCookie(&http.Cookie{Name: browserRefreshCookieName, Value: token})
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	good := probe(issued.RefreshToken, owner.Username)
	if good.Code != 200 {
		t.Fatalf("live Owner Cookie rejected: %d %s", good.Code, good.Body.String())
	}
	var result map[string]any
	if err := json.Unmarshal(good.Body.Bytes(), &result); err != nil ||
		result["username"] != owner.Username || result["browser_session"] != true {
		t.Fatal("session probe returned incorrect Owner or status")
	}
	if len(good.Result().Cookies()) != 0 ||
		strings.Contains(good.Body.String(), issued.RefreshToken) ||
		strings.Contains(good.Body.String(), issued.AccessToken) {
		t.Fatal("read-only probe minted or leaked credentials")
	}
	if w := probe(issued.RefreshToken, "another-owner"); w.Code != 409 {
		t.Fatalf("foreign Owner accepted Cookie: %d", w.Code)
	}
	if w := probe(issued.RefreshToken, owner.Username); w.Code != 200 {
		t.Fatalf("mismatched Owner rotated an existing Cookie: %d", w.Code)
	}
	if w := probe("", owner.Username); w.Code != 401 {
		t.Fatalf("missing Cookie accepted: %d", w.Code)
	}
	now := time.Now().UTC()
	if err := db.Model(&meta.RefreshToken{}).Where("token_hash = ?",
		auth.HashRefreshToken(issued.RefreshToken)).Update("revoked_at", now).Error; err != nil {
		t.Fatal(err)
	}
	if w := probe(issued.RefreshToken, owner.Username); w.Code != 401 {
		t.Fatalf("revoked Cookie remained ready: %d", w.Code)
	}
	again, err := s.issueSession(db, owner)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).
		Update("disabled_at", now).Error; err != nil {
		t.Fatal(err)
	}
	if w := probe(again.RefreshToken, owner.Username); w.Code != 403 {
		t.Fatalf("disabled Owner remained ready: %d", w.Code)
	}
}
