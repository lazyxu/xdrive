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
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// This is a real isolated PostgreSQL Owner/session/config/epoch check.
// It does not access Baidu, decrypt Browser AK, mint a map Cookie or expose
// any new proxy/Loader route.
func TestBaiduJSAPIBootstrapCandidateOwnerAndFailClosedRelease(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL fixture requires XD_TEST_DATABASE_URL")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "map_bootstrap_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA \"%s\"", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA \"%s\" CASCADE", schema)).Error }()
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
	if err := db.AutoMigrate(&meta.User{}, &meta.BaiduJSAPIMapEpoch{}, &meta.AdminServiceSecret{}); err != nil {
		t.Fatal(err)
	}
	keyring, err := connectorsecret.NewKeyring(1, map[uint32]string{1: strings.Repeat("ab", 32)})
	if err != nil {
		t.Fatal(err)
	}
	const origin = "https://gallery.example.invalid"
	manager := auth.New("isolated-jsapi-bootstrap-owner", time.Hour)
	srv := &Server{DB: db, Auth: manager, ConnectorSecrets: keyring, AllowedOrigin: origin}
	user := meta.User{Username: "map-bootstrap-alice", PasswordHash: "no-login", Role: meta.UserRoleUser, SessionVersion: 4}
	other := meta.User{Username: "map-bootstrap-bob", PasswordHash: "no-login", Role: meta.UserRoleUser, SessionVersion: 3}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := ensureBaiduMapEpochTx(context.Background(), db, user.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := ensureBaiduMapEpochTx(context.Background(), db, other.ID); err != nil {
		t.Fatal(err)
	}
	config := meta.AdminServiceSecret{
		Name: baiduJSAPISecretName, Enabled: true, Revision: 7,
		Ciphertext: []byte("synthetic-encrypted-blob-not-a-real-AK"), KeyVersion: 1,
	}
	if err := db.Create(&config).Error; err != nil {
		t.Fatal(err)
	}
	token, err := manager.Issue(user.ID, user.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	otherToken, err := manager.Issue(other.ID, other.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Add(time.Second)
	newRequest := func(bearer string) *http.Request {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/media/places/baidu-jsapi/session", nil)
		req.Header.Set("Authorization", "Bearer "+bearer)
		req.Header.Set("Origin", origin)
		req.Header.Set("Sec-Fetch-Site", "same-origin")
		return req
	}
	check := func(req *http.Request) (baidumapjsapi.MapSessionState, error) {
		return srv.baiduJSAPIBootstrapCandidate(context.Background(), req, now)
	}
	state, err := check(newRequest(token))
	if err != nil || state.OwnerID != user.ID || state.SessionVersion != 4 ||
		state.ConfigurationRevision != 7 || state.RevocationEpoch != 1 ||
		!state.AccountActive || state.RuntimeAuthorized {
		t.Fatalf("unsafe bootstrap candidate %#v %v", state, err)
	}
	// A REAL authenticated Owner + saved, configured Browser AK is NOT a JSAPI
	// licence, release signature or signed map-only session admission.
	if cookie, err := baidumapjsapi.IssueMapSession([]byte(strings.Repeat("x", 32)), state, now); err == nil || cookie != nil {
		t.Fatal("unauthorized bootstrap candidate minted map Cookie")
	}
	// These real Gin routes were added after the offline bootstrap candidate.
	// A genuine signed Owner JWT plus desired Browser AK still cannot mint
	// a map Cookie or access Loader bytes without the independently verified
	// complete signed operator release. Default routes deny with 503.
	router := srv.Router()
	for _, blocked := range []*http.Request{
		newRequest(token),
		httptest.NewRequest(http.MethodGet, "/_BMapService/api?v=4.0", nil),
	} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, blocked)
		if response.Code != http.StatusServiceUnavailable ||
			response.Header().Get("Set-Cookie") != "" ||
			strings.Contains(response.Body.String(), token) {
			t.Fatal("blocked JSAPI4 route became publicly usable or echoed a token")
		}
	}
	// Another valid Owner can derive only THEIR own identity and non-release.
	second, err := check(newRequest(otherToken))
	if err != nil || second.OwnerID != other.ID || second.OwnerID == state.OwnerID ||
		second.RuntimeAuthorized {
		t.Fatal("cross-owner bootstrap scope")
	}

	for _, caseName := range []string{
		"missing header", "duplicated header", "non-bearer", "bearer with space",
		"cross site", "cross origin", "missing origin", "query token",
		"wrong method", "wrong path", "absolute URL", "encoded alias", "nonempty body", "chunked body",
		"untrusted server origin", "cancelled context",
	} {
		t.Run(caseName, func(t *testing.T) {
			req := newRequest(token)
			originalOrigin := srv.AllowedOrigin
			defer func() { srv.AllowedOrigin = originalOrigin }()
			ctx := context.Background()
			switch caseName {
			case "missing header":
				req.Header.Del("Authorization")
			case "duplicated header":
				req.Header.Add("Authorization", "Bearer "+otherToken)
			case "non-bearer":
				req.Header.Set("Authorization", "Basic "+token)
			case "bearer with space":
				req.Header.Set("Authorization", "Bearer "+token+" extra")
			case "cross site":
				req.Header.Set("Sec-Fetch-Site", "cross-site")
			case "cross origin":
				req.Header.Set("Origin", "https://evil.example.invalid")
			case "missing origin":
				req.Header.Del("Origin")
			case "query token":
				req.URL.RawQuery = "token=forbidden"
			case "wrong method":
				req.Method = http.MethodGet
			case "wrong path":
				req.URL.Path = "/api/v1/media/places/baidu-static"
			case "absolute URL":
				req.URL.Scheme = "https"
				req.URL.Host = "gallery.example.invalid"
			case "encoded alias":
				req.URL.RawPath = "/api/v1/media/places/baidu-jsapi/%73ession"
			case "nonempty body":
				req.ContentLength = 1
			case "chunked body":
				req.TransferEncoding = []string{"chunked"}
			case "untrusted server origin":
				srv.AllowedOrigin = "*"
			case "cancelled context":
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			}
			if snapshot, err := srv.baiduJSAPIBootstrapCandidate(ctx, req, now); err == nil ||
				snapshot.OwnerID != 0 || snapshot.RuntimeAuthorized {
				t.Fatal("malformed or untrusted map bootstrap accepted")
			}
		})
	}
	// Must re-read desired configuration from PostgreSQL, never from browser.
	if err := db.Model(&meta.AdminServiceSecret{}).Where("name = ?", baiduJSAPISecretName).
		Update("revision", 8).Error; err != nil {
		t.Fatal(err)
	}
	rotated, err := check(newRequest(token))
	if err != nil || rotated.ConfigurationRevision != 8 {
		t.Fatal("Browser AK revision was not re-read")
	}
	if err := db.Model(&meta.AdminServiceSecret{}).Where("name = ?", baiduJSAPISecretName).
		Update("enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := check(newRequest(token)); err == nil {
		t.Fatal("disabled Browser AK desired config admitted")
	}
	if err := db.Model(&meta.AdminServiceSecret{}).Where("name = ?", baiduJSAPISecretName).
		Update("enabled", true).Error; err != nil {
		t.Fatal(err)
	}
	// A fresh lookup must reject a disabled user, not rely only on the JWT.
	if err := db.Model(&meta.User{}).Where("id = ?", user.ID).
		Update("session_version", 5).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := check(newRequest(token)); err == nil {
		t.Fatal("stale JWT version admitted")
	}
	if err := db.Model(&meta.User{}).Where("id = ?", user.ID).
		Update("session_version", 4).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.User{}).Where("id = ?", user.ID).
		Update("disabled_at", now).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := check(newRequest(token)); err == nil {
		t.Fatal("disabled user admitted")
	}
	if err := db.Model(&meta.User{}).Where("id = ?", user.ID).
		Update("disabled_at", nil).Error; err != nil {
		t.Fatal(err)
	}
	// Logout advances the durable map epoch and cutoff in a transaction. A
	// still-unexpired old signed access JWT then has no bootstrap rights.
	if _, err := advanceBaiduMapEpochTx(context.Background(), db, user.ID, now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if candidate, err := srv.baiduJSAPIBootstrapCandidate(
		context.Background(), newRequest(token), now.Add(2*time.Second),
	); err == nil || candidate.OwnerID != 0 {
		t.Fatal("old signed JWT bypassed durable map logout cutoff")
	}
}

func TestBaiduJSAPIBootstrapCandidateRejectsMissingRuntimeDependencies(t *testing.T) {
	origin := "https://gallery.example.invalid"
	req := httptest.NewRequest("POST", "/api/v1/media/places/baidu-jsapi/session", nil)
	req.Header.Set("Origin", origin)
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	req.Header.Set("Authorization", "Bearer intentionally-invalid")
	now := time.Now()
	var nilServer *Server
	for _, s := range []*Server{nilServer, {}, {AllowedOrigin: origin}} {
		if candidate, err := s.baiduJSAPIBootstrapCandidate(context.Background(), req, now); err == nil ||
			candidate.OwnerID != 0 || candidate.RuntimeAuthorized {
			t.Fatal("missing DB/keyring cannot enter map bootstrap")
		}
	}
}
