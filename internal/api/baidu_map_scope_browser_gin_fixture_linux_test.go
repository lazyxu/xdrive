//go:build linux

package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/version"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// This opt-in fixture exposes the REAL Gin Router on loopback while actual
// Chromium loads the trusted Gallery at a separate synthetic HTTPS Origin.
// The browser harness forwards same-origin /api requests unchanged. No
// production account, provider SDK, AK, JWT or physical photo is accessed.
func TestPlacesP04MountedBrowserRealGinFixture(t *testing.T) {
	if os.Getenv("XD_PLACES_P04_BROWSER_GIN") != "1" {
		t.Skip("only the dedicated non-production Chromium/PostgreSQL job uses this fixture")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	origin := os.Getenv("XD_PLACES_P04_GALLERY_ORIGIN")
	ready := os.Getenv("XD_PLACES_P04_READY_FILE")
	stop := os.Getenv("XD_PLACES_P04_STOP_FILE")
	if dsn == "" || ready == "" || stop == "" ||
		!strings.HasPrefix(origin, "https://gallery.example.net:") {
		t.Fatal("missing bounded Chromium/Gin fixture configuration")
	}
	o, err := url.Parse(origin)
	if err != nil || o.String() != origin || o.Port() == "" || o.Hostname() != "gallery.example.net" {
		t.Fatal("invalid local browser origin")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	rootPool, err := root.DB()
	if err != nil {
		t.Fatal(err)
	}
	rootPool.SetMaxOpenConns(2)
	defer rootPool.Close()
	schema := "p04_browser_gin_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	dbURI, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := dbURI.Query()
	q.Set("search_path", schema)
	dbURI.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(dbURI.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	pool.SetMaxOpenConns(4)
	defer pool.Close()
	if err := db.AutoMigrate(
		&meta.User{}, &meta.AdminServiceSecret{}, &meta.InternalServiceKeyAnchor{},
		&meta.BaiduJSAPIMapEpoch{}, &meta.PhotoCollection{},
		&meta.BaiduMapScopeHandoff{},
	); err != nil {
		t.Fatal(err)
	}
	keyring, err := connectorsecret.NewKeyring(1,
		map[uint32]string{1: strings.Repeat("ee", 32)})
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB: db, ConnectorSecrets: keyring,
		Auth:          auth.New("p04-mounted-chromium-gin-only", time.Hour),
		AllowedOrigin: origin,
	}
	owner := meta.User{Username: "browser-map-owner", PasswordHash: "synthetic",
		Role: meta.UserRoleUser, SessionVersion: 1}
	foreign := meta.User{Username: "browser-map-foreign", PasswordHash: "synthetic",
		Role: meta.UserRoleUser, SessionVersion: 1}
	for _, person := range []*meta.User{&owner, &foreign} {
		if err := db.Create(person).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.BaiduJSAPIMapEpoch{
			OwnerID: person.ID, Epoch: 3,
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&meta.PhotoCollection{
		OwnerID: owner.ID, ExternalKey: "manual:Family",
		Kind: meta.PhotoCollectionKindManual, Name: "Family",
		State: meta.PhotoCollectionStateActive, Revision: 7,
	}).Error; err != nil {
		t.Fatal(err)
	}
	v, ciphertext, err := keyring.Seal(baiduJSAPISecretAADID,
		baiduJSAPISecretKind, []byte("SYNTHETIC_BROWSER_AK_NEVER_USED_WITH_PROVIDER"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.AdminServiceSecret{
		Name: baiduJSAPISecretName, Enabled: true, Revision: 1,
		KeyVersion: v, Ciphertext: ciphertext,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := server.EnsureBaiduJSAPI4InternalKeys(context.Background()); err != nil {
		t.Fatal(err)
	}
	beforeCommit := version.Commit
	version.Commit = strings.Repeat("b", 40)
	defer func() { version.Commit = beforeCommit }()
	if err := server.RefreshBaiduJSAPI4ManagedRelease(context.Background()); err != nil {
		t.Fatal("protected signed release unavailable in non-production fixture")
	}
	defer server.ClearBaiduJSAPI4OperatorRelease()
	ownerToken, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	foreignToken, err := server.Auth.Issue(foreign.ID, foreign.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := server.Router()
	mux := http.NewServeMux()
	mux.Handle("/api/", router)
	// This synthetic token endpoint exists ONLY inside this opt-in test
	// process, is bound to 127.0.0.1 and is never installed on a Server.
	mux.HandleFunc("/__fixture/map-owner", func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		ip := net.ParseIP(host)
		if r.Method != http.MethodGet || err != nil || ip == nil || !ip.IsLoopback() {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		token := ownerToken
		if r.URL.Query().Get("account") == "foreign" {
			token = foreignToken
		} else if r.URL.RawQuery != "" {
			http.Error(w, "invalid", http.StatusBadRequest)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"token": token})
	})
	httpServer := httptest.NewServer(mux)
	defer httpServer.Close()
	// No bearer, AK or database information enters this readiness file.
	payload, err := json.Marshal(map[string]any{
		"real_gin": true, "postgresql": true, "url": httpServer.URL,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(ready), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ready, payload, 0600); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(ready)
	deadline := time.NewTimer(3 * time.Minute)
	defer deadline.Stop()
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-deadline.C:
			t.Fatal("real mounted Chromium did not return a bounded completion signal")
		case <-ticker.C:
			if _, err := os.Stat(stop); err == nil {
				return
			} else if !os.IsNotExist(err) {
				t.Fatal("invalid completion path")
			}
		}
	}
}
