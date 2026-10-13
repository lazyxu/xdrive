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

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestBaiduJSAPIResourceSnapshotRequiresFreshOwnerConfigEpoch(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL fixture required")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "map_resource_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()
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
	if err := db.AutoMigrate(&meta.User{}, &meta.BaiduJSAPIMapEpoch{}, &meta.AdminServiceSecret{}); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{Username: "resource-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 3}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := ensureBaiduMapEpochTx(context.Background(), db, owner.ID); err != nil {
		t.Fatal(err)
	}
	// This is SYNTHETIC config metadata, not real AK; there is no network or runtime route.
	cfg := meta.AdminServiceSecret{Name: baiduJSAPISecretName, Enabled: true, Revision: 8, Ciphertext: []byte("synthetic-encrypted-placeholder"), KeyVersion: 1}
	if err := db.Create(&cfg).Error; err != nil {
		t.Fatal(err)
	}
	srv := &Server{DB: db}
	secret := []byte(strings.Repeat("z", 32))
	now := time.Now().UTC().Truncate(time.Second)
	cookie, err := baidumapjsapi.IssueMapSession(secret, baidumapjsapi.MapSessionState{
		OwnerID: owner.ID, SessionVersion: 3, ConfigurationRevision: 8, RevocationEpoch: 1, AccountActive: true, RuntimeAuthorized: true,
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	newRequest := func() *http.Request {
		r := httptest.NewRequest("GET", "https://example.invalid/_BMapService/api?v=4.0", nil)
		r.Header.Set("Sec-Fetch-Site", "same-origin")
		r.AddCookie(cookie)
		return r
	}
	check := func(r *http.Request) (baidumapjsapi.MapSessionState, error) {
		return srv.baiduJSAPIResourceSnapshot(context.Background(), r, "https://example.invalid", secret, now.Add(time.Second))
	}
	state, err := check(newRequest())
	if err != nil || state.OwnerID != owner.ID || state.SessionVersion != 3 || state.ConfigurationRevision != 8 || state.RevocationEpoch != 1 || state.RuntimeAuthorized {
		t.Fatalf("unsafe state %#v %v", state, err)
	}
	if err := baidumapjsapi.VerifyMapSession(secret, cookie.Value, state, now.Add(time.Second)); err == nil {
		t.Fatal("snapshot enabled JSAPI runtime")
	}
	// A real, otherwise-valid cookie must not authorize ambiguous, foreign,
	// key-injected, bearer-bearing or unreviewed child resource requests.
	invalidRequests := []struct {
		name    string
		prepare func(*http.Request)
	}{
		{"duplicate cookie", func(r *http.Request) { r.AddCookie(cookie) }},
		{"AK override", func(r *http.Request) { r.URL.RawQuery = "v=4.0&ak=attacker" }},
		{"unreviewed child", func(r *http.Request) { r.URL.Path = "/_BMapService/tiles/0.png" }},
		{"bearer", func(r *http.Request) { r.Header.Set("Authorization", "Bearer not-allowed") }},
		{"foreign origin", func(r *http.Request) { r.Header.Set("Origin", "https://attacker.invalid") }},
		{"cross-site", func(r *http.Request) { r.Header.Set("Sec-Fetch-Site", "cross-site") }},
	}
	for _, item := range invalidRequests {
		t.Run(item.name, func(t *testing.T) {
			r := newRequest()
			item.prepare(r)
			if _, err := check(r); err == nil {
				t.Fatal("unsafe map resource request was admitted")
			}
		})
	}
	synthetic := state
	synthetic.RuntimeAuthorized = true
	if err := baidumapjsapi.VerifyMapSession(secret, cookie.Value, synthetic, now.Add(time.Second)); err != nil {
		t.Fatalf("synthetic fixture cookie invalid: %v", err)
	}
	// A config revision invalidates an already-issued map-only cookie.
	if err := db.Model(&meta.AdminServiceSecret{}).Where("name = ?", baiduJSAPISecretName).Update("revision", 9).Error; err != nil {
		t.Fatal(err)
	}
	changed, err := check(newRequest())
	if err != nil || changed.ConfigurationRevision != 9 {
		t.Fatal("did not re-read config revision")
	}
	changed.RuntimeAuthorized = true
	if err := baidumapjsapi.VerifyMapSession(secret, cookie.Value, changed, now.Add(time.Second)); err == nil {
		t.Fatal("old cookie passed rotated revision")
	}
	if err := db.Model(&meta.AdminServiceSecret{}).Where("name = ?", baiduJSAPISecretName).Update("enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := check(newRequest()); err == nil {
		t.Fatal("disabled config admitted resource")
	}
	if err := db.Model(&meta.AdminServiceSecret{}).Where("name = ?", baiduJSAPISecretName).Update("enabled", true).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := advanceBaiduMapEpochTx(context.Background(), db, owner.ID, now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	changed, err = check(newRequest())
	if err != nil || changed.RevocationEpoch != 2 {
		t.Fatal("did not re-read current epoch")
	}
	changed.RuntimeAuthorized = true
	if err := baidumapjsapi.VerifyMapSession(secret, cookie.Value, changed, now.Add(time.Second)); err == nil {
		t.Fatal("revoked cookie validated")
	}
	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).Update("disabled_at", time.Now()).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := check(newRequest()); err == nil {
		t.Fatal("disabled account admitted resource")
	}
}

func TestBaiduJSAPIResourceSnapshotRejectsUntrustedTransport(t *testing.T) {
	now := time.Now()
	origin := "https://example.invalid"
	s := &Server{}
	requests := []*http.Request{
		httptest.NewRequest("GET", origin+"/_BMapService/api?v=4.0", nil),
		httptest.NewRequest("GET", origin+"/_BMapService/tiles/0.png", nil),
		httptest.NewRequest("GET", origin+"/_BMapService/api?v=4.0&ak=fake", nil),
	}
	requests[0].Header.Set("Authorization", "Bearer-not-allowed")
	for _, r := range requests {
		if _, err := s.baiduJSAPIResourceSnapshot(context.Background(), r, origin, []byte(strings.Repeat("z", 32)), now); err == nil {
			t.Fatal("untrusted/no DB preflight admitted")
		}
	}
}
