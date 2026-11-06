//go:build linux

package api

import (
	"crypto/tls"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

// TestDesktopMapRealAgentHTTPSFixture exposes genuine Gin/PG auth over an
// actual selected private-IP TLS socket to a real Go Agent and Electron WebView.
// The tiny synthetic map page is NOT the production Gallery/Main UI.
func TestDesktopMapRealAgentHTTPSFixture(t *testing.T) {
	if os.Getenv("XD_DESKTOP_MAP_REAL_AGENT_E2E") != "1" {
		t.Skip("dedicated actual Go Agent/Gin/PostgreSQL/Electron test only")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	ready := os.Getenv("XD_DESKTOP_MAP_E2E_READY_FILE")
	stop := os.Getenv("XD_DESKTOP_MAP_E2E_STOP_FILE")
	certPath := os.Getenv("XD_DESKTOP_MAP_E2E_CERT_FILE")
	keyPath := os.Getenv("XD_DESKTOP_MAP_E2E_KEY_FILE")
	ip := os.Getenv("XD_DESKTOP_MAP_E2E_IP")
	if dsn == "" || ready == "" || stop == "" || certPath == "" ||
		keyPath == "" || ip != "10.233.15.12" {
		t.Fatal("missing bounded synthetic private-IP, TLS, PostgreSQL or readiness fixture")
	}
	certificate, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		t.Fatal(err)
	}
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{},
		&meta.DesktopMapGuestGrant{}, &meta.BaiduJSAPIMapEpoch{}, &meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	for _, userName := range []string{"desktop-map-e2e-owner", "desktop-map-e2e-foreign"} {
		password := "SyntheticAgentOnly-2026!"
		if userName == "desktop-map-e2e-foreign" {
			password = "SyntheticForeignOnly-2026!"
		}
		hash, err := auth.HashPassword(password)
		if err != nil {
			t.Fatal(err)
		}
		owner := meta.User{Username: userName, PasswordHash: hash,
			Role: meta.UserRoleUser, SessionVersion: 1}
		if err := db.Create(&owner).Error; err != nil {
			t.Fatal(err)
		}
	}
	s := &Server{DB: db, Auth: auth.New("test-map-e2e-synthetic-only", 15*time.Minute),
		RefreshTTL: time.Hour}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(gin.Recovery())
	v1 := r.Group("/api/v1")
	v1.GET("/version", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"version": "map-real-agent-e2e"})
	})
	v1.POST("/auth/login", s.login)
	v1.POST("/auth/refresh", s.refresh)
	v1.POST("/auth/logout", s.logout)
	v1.POST("/auth/browser/refresh", s.refresh)
	v1.POST("/auth/desktop-map/issue", s.requireAuth(), s.issueDesktopMapGuestGrant)
	v1.POST("/auth/desktop-map/redeem", s.redeemDesktopMapGuestGrant)
	v1.POST("/auth/desktop-map/session", s.desktopMapBrowserSessionProbe)
	v1.GET("/me", s.requireAuth(), s.me)
	r.GET("/__fixture/map", func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(
			"<!doctype html><html><body><main data-xdrive-test-only-map=\"1\">"+
				"<div id=\"test-map-only\">synthetic map transport fixture</div></main></body></html>"))
	})
	listener, err := net.Listen("tcp", net.JoinHostPort(ip, "0"))
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewUnstartedServer(r)
	_ = server.Listener.Close()
	server.Listener = listener
	server.TLS = &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS12}
	server.StartTLS()
	defer server.Close()
	if !strings.HasPrefix(server.URL, "https://"+ip+":") {
		t.Fatal("test server did not bind exact controlled private-IP origin")
	}
	body, err := json.Marshal(map[string]string{
		"url":      server.URL,
		"username": "desktop-map-e2e-owner",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(ready), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ready, body, 0600); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(ready)
	deadline := time.NewTimer(5 * time.Minute)
	defer deadline.Stop()
	tick := time.NewTicker(150 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-tick.C:
			if _, err := os.Stat(stop); err == nil {
				return
			}
		case <-deadline.C:
			t.Fatal("actual Agent/HTTPS/Electron test fixture exceeded its bounded lifetime")
		}
	}
}
