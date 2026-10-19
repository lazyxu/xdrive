package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestBaiduJSAPI4OfflineLoaderCandidateFailsClosed(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/_BMapService/api?v=4.0", nil)
	state := baidumapjsapi.MapSessionState{
		OwnerID: 1, SessionVersion: 1, ConfigurationRevision: 1,
		RevocationEpoch: 1, AccountActive: true, RuntimeAuthorized: true,
	}
	gates := baidumapjsapi.ReleaseGates{
		Licensed: true, ObservedResourceInventory: true, RawLeakAudit: true,
		OwnerSessionAndFleetQuota: true, PlatformIsolation: true,
	}
	sender := func(*http.Request) (*http.Response, error) {
		t.Fatal("untrusted Loader reached synthetic sender")
		return nil, nil
	}
	ctx, stop := context.WithCancel(context.Background())
	stop()
	for _, item := range []struct {
		server *Server
		ctx    context.Context
		req    *http.Request
		state  baidumapjsapi.MapSessionState
		gates  baidumapjsapi.ReleaseGates
		send   baiduJSAPI4OfflineLoaderSend
	}{
		{nil, context.Background(), req, state, gates, sender},
		{&Server{}, context.Background(), req, state, gates, sender},
		{&Server{}, nil, req, state, gates, sender},
		{&Server{}, ctx, req, state, gates, sender},
		{&Server{}, context.Background(), nil, state, gates, sender},
		{&Server{}, context.Background(), req, state, gates, nil},
		{&Server{}, context.Background(), req, state, baidumapjsapi.ReleaseGates{}, sender},
	} {
		body, headers, err := item.server.baiduJSAPI4OfflineLoaderCandidate(
			item.ctx, item.req, item.state, item.gates, item.send,
		)
		if body != nil || headers != nil || !errors.Is(err, errBaiduJSAPIResourceDenied) {
			t.Fatal("private Loader candidate admitted untrusted state")
		}
	}
}

func TestBaiduJSAPI4OfflineLoaderCandidatePinnedPlanNoLeakAndQuota(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated real PostgreSQL required")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	rootSQL, err := root.DB()
	if err != nil {
		t.Fatal(err)
	}
	rootSQL.SetMaxOpenConns(2)
	defer rootSQL.Close()
	schema := "jsapi_loader_pipeline_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	open := func() *gorm.DB {
		t.Helper()
		db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		pool, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		pool.SetMaxOpenConns(8)
		t.Cleanup(func() { _ = pool.Close() })
		return db
	}
	db, peer := open(), open()
	if err := db.AutoMigrate(
		&meta.User{}, &meta.AdminServiceSecret{}, &meta.BaiduJSAPIMapEpoch{},
		&meta.BaiduJSAPIQuotaBucket{}, &meta.BaiduJSAPILoaderFlight{},
	); err != nil {
		t.Fatal(err)
	}
	keyring, err := connectorsecret.NewKeyring(1, map[uint32]string{
		1: strings.Repeat("cd", 32),
	})
	if err != nil {
		t.Fatal(err)
	}
	owner := meta.User{
		Username: "loader-test-owner", PasswordHash: "synthetic",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.BaiduJSAPIMapEpoch{
		OwnerID: owner.ID, Epoch: 1,
	}).Error; err != nil {
		t.Fatal(err)
	}
	rev1, cipher1, err := keyring.Seal(
		baiduJSAPISecretAADID, baiduJSAPISecretKind, []byte("synthetic-browser-ak-one"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.AdminServiceSecret{
		Name: baiduJSAPISecretName, Enabled: true, Revision: 1,
		KeyVersion: rev1, Ciphertext: cipher1,
	}).Error; err != nil {
		t.Fatal(err)
	}
	srv := &Server{
		DB: peer, ConnectorSecrets: keyring,
		AllowedOrigin:   "https://gallery.invalid",
		BaiduMapEnabled: true, BaiduMapAK: "synthetic-static-ak-not-jsapi",
	}
	state := baidumapjsapi.MapSessionState{
		OwnerID: owner.ID, SessionVersion: 1, ConfigurationRevision: 1,
		RevocationEpoch: 1, AccountActive: true, RuntimeAuthorized: true,
	}
	gates := baidumapjsapi.ReleaseGates{
		Licensed: true, ObservedResourceInventory: true, RawLeakAudit: true,
		OwnerSessionAndFleetQuota: true, PlatformIsolation: true,
	}
	inbound := func() *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/_BMapService/api?v=4.0", nil)
		r.Header.Set("Origin", "https://gallery.invalid")
		r.Header.Set("Referer", "https://forged-attacker.invalid/") // never forwarded
		r.Header.Set("Sec-Fetch-Site", "same-origin")
		return r
	}
	const safeBody = "window.BMap = {Map:function(){}};"
	respond := func(body string) *http.Response {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header: http.Header{
				"Content-Type": {"application/javascript"},
				"Set-Cookie":   {"provider-cookie-forbidden"},
				"Location":     {},
			},
			Body:          io.NopCloser(strings.NewReader(body)),
			ContentLength: int64(len(body)),
		}
	}
	var sends atomic.Int64
	sender := func(req *http.Request) (*http.Response, error) {
		sends.Add(1)
		if req.Method != http.MethodGet ||
			req.URL.Scheme != "https" || req.URL.Host != "api.map.baidu.com" ||
			req.URL.Path != "/api" || req.URL.Query().Get("v") != "4.0" ||
			req.URL.Query().Get("ak") != "synthetic-browser-ak-one" ||
			req.Header.Get("Bmap_proxy_url") != "https://gallery.invalid/_BMapService/" ||
			req.Header.Get("Referer") != "https://gallery.invalid/" ||
			req.Header.Get("Cookie") != "" || req.Header.Get("Authorization") != "" ||
			req.Header.Get("Proxy-Authorization") != "" {
			t.Fatal("synthetic upstream was not a pinned Server-only Loader plan")
		}
		return respond(safeBody), nil
	}
	call := func(r *http.Request, send baiduJSAPI4OfflineLoaderSend) ([]byte, http.Header, error) {
		return srv.baiduJSAPI4OfflineLoaderCandidate(
			r.Context(), r, state, gates, send,
		)
	}
	checkRows := func(requests int64) {
		t.Helper()
		for _, scope := range []int64{0, int64(owner.ID)} {
			var row meta.BaiduJSAPIQuotaBucket
			if requests > 0 {
				if err := db.Where("scope_id = ?", scope).Take(&row).Error; err != nil ||
					row.Requests != requests ||
					row.ReservedBytes != requests*baidumapjsapi.MaxLoaderBytes {
					t.Fatal("private Loader quota was not charged atomically")
				}
			}
		}
		var flights int64
		if err := db.Model(&meta.BaiduJSAPILoaderFlight{}).Count(&flights).Error; err != nil || flights != 0 {
			t.Fatal("Loader flight was not released after mock send")
		}
	}
	// Client query injection and unreviewed paths must not consume a quota
	// or read the Browser AK, even when the fixture says "authorized".
	bad := inbound()
	bad.URL.RawQuery = "v=4.0&ak=attacker"
	if body, _, err := call(bad, sender); body != nil || !errors.Is(err, errBaiduJSAPIResourceDenied) {
		t.Fatal("query-injected Loader was admitted")
	}
	if sends.Load() != 0 {
		t.Fatal("untrusted inbound reached sender")
	}
	body, headers, err := call(inbound(), sender)
	if err != nil || string(body) != safeBody ||
		headers.Get("Set-Cookie") != "" || headers.Get("Location") != "" ||
		headers.Get("Content-Type") != "application/javascript; charset=utf-8" ||
		strings.Contains(string(body), "synthetic-browser-ak-one") {
		t.Fatal("Loader response was not minimally sanitized")
	}
	checkRows(1)

	// Raw AK in upstream JS must fail closed and never be returned, while
	// the consumed request budget stays charged; in-flight lease is released.
	if data, _, err := call(inbound(), func(*http.Request) (*http.Response, error) {
		sends.Add(1)
		return respond("var ak='synthetic-browser-ak-one';"), nil
	}); data != nil || !errors.Is(err, errBaiduJSAPIResourceDenied) {
		t.Fatal("upstream browser key escaped raw response audit")
	}
	checkRows(2)

	// Concurrent Server changes during mock upstream invalidate the final
	// DB read. No JS response is returned from the stale Browser revision.
	rev2, cipher2, err := keyring.Seal(
		baiduJSAPISecretAADID, baiduJSAPISecretKind, []byte("synthetic-browser-ak-two"),
	)
	if err != nil {
		t.Fatal(err)
	}
	var forwarded atomic.Int64
	rotate := func(*http.Request) (*http.Response, error) {
		forwarded.Add(1)
		if err := db.Model(&meta.AdminServiceSecret{}).
			Where("name = ?", baiduJSAPISecretName).
			Updates(map[string]any{
				"revision": uint64(2), "key_version": rev2,
				"ciphertext": cipher2,
			}).Error; err != nil {
			t.Fatal(err)
		}
		return respond(safeBody), nil
	}
	if data, _, err := call(inbound(), rotate); data != nil ||
		!errors.Is(err, errBaiduJSAPIResourceDenied) || forwarded.Load() != 1 {
		t.Fatal("rotated Browser AK returned stale JS body")
	}
	checkRows(3)
	if data, _, err := call(inbound(), sender); data != nil ||
		!errors.Is(err, errBaiduJSAPIResourceDenied) {
		t.Fatal("old map session revision permitted new Browser AK")
	}
	checkRows(3)
	state.ConfigurationRevision = 2
	if err := db.Model(&meta.BaiduJSAPIMapEpoch{}).
		Where("owner_id = ?", owner.ID).Update("epoch", uint64(2)).Error; err != nil {
		t.Fatal(err)
	}
	if data, _, err := call(inbound(), sender); data != nil ||
		!errors.Is(err, errBaiduJSAPIResourceDenied) {
		t.Fatal("revoked map-only session reached outbound sender")
	}
	checkRows(3)

	// Missing migration means no unmetered network and no durable flight.
	state.RevocationEpoch = 2
	if err := db.Migrator().DropTable(&meta.BaiduJSAPIQuotaBucket{}); err != nil {
		t.Fatal(err)
	}
	if data, _, err := call(inbound(), sender); data != nil ||
		!errors.Is(err, errBaiduJSAPIResourceDenied) {
		t.Fatal("missing quota table admitted an unmetered upstream request")
	}
	var flights int64
	if err := db.Model(&meta.BaiduJSAPILoaderFlight{}).Count(&flights).Error; err != nil || flights != 0 {
		t.Fatal("unmetered candidate leaked in-flight slot")
	}
}
