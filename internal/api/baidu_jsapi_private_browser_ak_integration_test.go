package api

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestBaiduJSAPIBrowserAKCandidateHasNoPublicRelease(t *testing.T) {
	valid := baidumapjsapi.MapSessionState{
		OwnerID: 10, SessionVersion: 2, ConfigurationRevision: 1,
		RevocationEpoch: 1, AccountActive: true, RuntimeAuthorized: true,
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, item := range []struct {
		s     *Server
		ctx   context.Context
		state baidumapjsapi.MapSessionState
	}{
		{nil, context.Background(), valid},
		{&Server{}, context.Background(), valid},
		{&Server{}, nil, valid},
		{&Server{}, ctx, valid},
		{&Server{}, context.Background(), baidumapjsapi.MapSessionState{}},
	} {
		ak, err := item.s.currentBaiduJSAPIBrowserAKCandidate(item.ctx, item.state)
		if ak != "" || !errors.Is(err, errBaiduJSAPIResourceDenied) {
			t.Fatal("untrusted Browser AK candidate did not fail closed")
		}
	}
}

func TestBaiduJSAPIBrowserAKCandidateCurrentEncryptedAcrossPostgresPools(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated real PostgreSQL required")
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
	schema := "jsapi_browser_current_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	open := func() *gorm.DB {
		t.Helper()
		db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
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
	if err := db.AutoMigrate(&meta.User{}, &meta.BaiduJSAPIMapEpoch{}, &meta.AdminServiceSecret{}); err != nil {
		t.Fatal(err)
	}
	keyring, err := connectorsecret.NewKeyring(1, map[uint32]string{
		1: strings.Repeat("cd", 32),
	})
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB: peer, ConnectorSecrets: keyring,
		BaiduMapEnabled: true, BaiduMapAK: "synthetic-static-server-only",
	}
	owner := meta.User{
		Username: "private-jsapi-browser-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 3,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	epoch := meta.BaiduJSAPIMapEpoch{OwnerID: owner.ID, Epoch: 1}
	if err := db.Create(&epoch).Error; err != nil {
		t.Fatal(err)
	}
	state := baidumapjsapi.MapSessionState{
		OwnerID: owner.ID, SessionVersion: 3, ConfigurationRevision: 1,
		RevocationEpoch: 1, AccountActive: true, RuntimeAuthorized: true,
	}
	read := func(s baidumapjsapi.MapSessionState, want string) {
		t.Helper()
		value, err := server.currentBaiduJSAPIBrowserAKCandidate(context.Background(), s)
		if err != nil || value != want {
			t.Fatal("current private Browser AK did not match encrypted revision")
		}
	}
	denied := func(s baidumapjsapi.MapSessionState) {
		t.Helper()
		value, err := server.currentBaiduJSAPIBrowserAKCandidate(context.Background(), s)
		if value != "" || !errors.Is(err, errBaiduJSAPIResourceDenied) ||
			strings.Contains(err.Error(), "synthetic") {
			t.Fatal("Browser AK was exposed or untrusted revision admitted")
		}
	}
	// Neither deployment/static Server AK nor its saved encrypted config can
	// fill a missing browser-specific row.
	denied(state)
	staticVersion, staticCipher, err := keyring.Seal(
		baiduMapSecretAADID, baiduMapSecretKind, []byte("synthetic-saved-static-ak"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.AdminServiceSecret{
		Name: baiduMapSecretName, Enabled: true, Revision: 1,
		KeyVersion: staticVersion, Ciphertext: staticCipher,
	}).Error; err != nil {
		t.Fatal(err)
	}
	denied(state)
	firstVersion, firstCipher, err := keyring.Seal(
		baiduJSAPISecretAADID, baiduJSAPISecretKind,
		[]byte("synthetic-jsapi-browser-v1"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.AdminServiceSecret{
		Name: baiduJSAPISecretName, Enabled: true, Revision: 1,
		KeyVersion: firstVersion, Ciphertext: firstCipher,
	}).Error; err != nil {
		t.Fatal(err)
	}
	read(state, "synthetic-jsapi-browser-v1")
	blocked := state
	blocked.RuntimeAuthorized = false
	denied(blocked)
	blocked = state
	blocked.AccountActive = false
	denied(blocked)

	// Another Server connection rotates the saved Browser AK. No stale
	// session revision can read the replacement or fall back to static key.
	nextVersion, nextCipher, err := keyring.Seal(
		baiduJSAPISecretAADID, baiduJSAPISecretKind,
		[]byte("synthetic-jsapi-browser-v2"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.AdminServiceSecret{}).Where("name = ?", baiduJSAPISecretName).
		Updates(map[string]any{
			"revision": uint64(2), "key_version": nextVersion,
			"ciphertext": nextCipher,
		}).Error; err != nil {
		t.Fatal(err)
	}
	denied(state)
	state.ConfigurationRevision = 2
	read(state, "synthetic-jsapi-browser-v2")

	// Map-only logout/epoch revocation across replicas invalidates any
	// previously valid Browser AK resource identity.
	if err := db.Model(&meta.BaiduJSAPIMapEpoch{}).Where("owner_id = ?", owner.ID).
		Update("epoch", uint64(2)).Error; err != nil {
		t.Fatal(err)
	}
	denied(state)
	state.RevocationEpoch = 2
	read(state, "synthetic-jsapi-browser-v2")

	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).
		Update("session_version", uint64(4)).Error; err != nil {
		t.Fatal(err)
	}
	denied(state)
	state.SessionVersion = 4
	read(state, "synthetic-jsapi-browser-v2")

	now := time.Now().UTC()
	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).
		Update("disabled_at", &now).Error; err != nil {
		t.Fatal(err)
	}
	denied(state)
	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).
		Updates(map[string]any{
			"disabled_at": nil, "must_change_password": true,
		}).Error; err != nil {
		t.Fatal(err)
	}
	denied(state)
	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).
		Updates(map[string]any{
			"must_change_password": false, "session_version": uint64(0),
		}).Error; err != nil {
		t.Fatal(err)
	}
	denied(state)
	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).
		Update("session_version", uint64(4)).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.Model(&meta.AdminServiceSecret{}).Where("name = ?", baiduJSAPISecretName).
		Update("enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	denied(state)
	if err := db.Model(&meta.AdminServiceSecret{}).Where("name = ?", baiduJSAPISecretName).
		Updates(map[string]any{
			"enabled": true, "ciphertext": []byte{},
			"key_version": uint32(0),
		}).Error; err != nil {
		t.Fatal(err)
	}
	denied(state)
	if err := db.Model(&meta.AdminServiceSecret{}).Where("name = ?", baiduJSAPISecretName).
		Updates(map[string]any{
			"ciphertext": []byte("broken-aead"), "key_version": nextVersion,
		}).Error; err != nil {
		t.Fatal(err)
	}
	denied(state)
	if err := db.Model(&meta.AdminServiceSecret{}).Where("name = ?", baiduJSAPISecretName).
		Updates(map[string]any{
			"ciphertext": nextCipher, "key_version": nextVersion,
		}).Error; err != nil {
		t.Fatal(err)
	}
	server.ConnectorSecrets = nil
	denied(state)
	server.ConnectorSecrets = keyring
	read(state, "synthetic-jsapi-browser-v2")
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if value, err := server.currentBaiduJSAPIBrowserAKCandidate(cancelled, state); value != "" ||
		!errors.Is(err, errBaiduJSAPIResourceDenied) {
		t.Fatal("canceled request observed Browser AK")
	}
}
