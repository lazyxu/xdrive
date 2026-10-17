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
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestCurrentBaiduGeoconvServerAKFailsClosedWithoutLiveServer(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, tc := range []struct {
		server *Server
		ctx    context.Context
		owner  uint64
	}{
		{nil, context.Background(), 1},
		{&Server{}, context.Background(), 1},
		{&Server{}, nil, 1},
		{&Server{}, ctx, 1},
		{&Server{}, context.Background(), 0},
	} {
		value, err := tc.server.currentBaiduGeoconvServerAK(tc.ctx, tc.owner)
		if value != "" || !errors.Is(err, errBaiduGeoconvDispatchUnavailable) {
			t.Fatal("a missing or canceled Server unexpectedly released a credential")
		}
	}
}

func TestCurrentBaiduGeoconvServerAKCurrentEncryptedServerOnlyAcrossReplicas(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("real isolated PostgreSQL required")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "baidu_geo_ak_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		t.Cleanup(func() { _ = pool.Close() })
		return db
	}
	db, peer := open(), open()
	if err := db.AutoMigrate(&meta.User{}, &meta.AdminServiceSecret{}); err != nil {
		t.Fatal(err)
	}
	ring, err := connectorsecret.NewKeyring(1, map[uint32]string{1: strings.Repeat("ab", 32)})
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{DB: peer, ConnectorSecrets: ring,
		BaiduMapEnabled: true, BaiduMapAK: "synthetic-env-server-ak"}
	owner := meta.User{Username: "geo-ak-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	read := func(want string) {
		t.Helper()
		got, err := server.currentBaiduGeoconvServerAK(ctx, owner.ID)
		if got != want || err != nil {
			t.Fatal("current private Server credential mismatch or unexpected denial")
		}
	}
	denied := func() {
		t.Helper()
		value, err := server.currentBaiduGeoconvServerAK(ctx, owner.ID)
		if value != "" || !errors.Is(err, errBaiduGeoconvDispatchUnavailable) ||
			strings.Contains(err.Error(), "synthetic") {
			t.Fatal("private credential should be withheld without raw error or secret")
		}
	}
	// Server deployment fallback is allowed ONLY before a saved Server row.
	read("synthetic-env-server-ak")
	if v, err := server.currentBaiduGeoconvServerAK(ctx, owner.ID+100); v != "" || err == nil {
		t.Fatal("unrecognized owner accessed shared Server AK")
	}
	// The independently encrypted Browser AK never replaces the Server key.
	browserVersion, browserCipher, err := ring.Seal(baiduJSAPISecretAADID,
		baiduJSAPISecretKind, []byte("synthetic-browser-jsapi-key"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.AdminServiceSecret{Name: baiduJSAPISecretName,
		Enabled: true, Ciphertext: browserCipher, KeyVersion: browserVersion,
		Revision: 1}).Error; err != nil {
		t.Fatal(err)
	}
	read("synthetic-env-server-ak")

	firstVersion, firstCipher, err := ring.Seal(baiduMapSecretAADID,
		baiduMapSecretKind, []byte("synthetic-saved-server-key-v1"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.AdminServiceSecret{Name: baiduMapSecretName,
		Enabled: true, Ciphertext: firstCipher, KeyVersion: firstVersion,
		Revision: 1}).Error; err != nil {
		t.Fatal(err)
	}
	read("synthetic-saved-server-key-v1")
	nextVersion, nextCipher, err := ring.Seal(baiduMapSecretAADID,
		baiduMapSecretKind, []byte("synthetic-saved-server-key-v2"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.AdminServiceSecret{}).Where("name = ?", baiduMapSecretName).
		Updates(map[string]any{"ciphertext": nextCipher, "key_version": nextVersion,
			"revision": uint64(2)}).Error; err != nil {
		t.Fatal(err)
	}
	read("synthetic-saved-server-key-v2") // the peer replica reads live DB state

	if err := db.Model(&meta.AdminServiceSecret{}).Where("name = ?", baiduMapSecretName).
		Update("enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	denied() // saved disabled MUST NOT fall back to deployment or Browser key
	if err := db.Model(&meta.AdminServiceSecret{}).Where("name = ?", baiduMapSecretName).
		Updates(map[string]any{"enabled": true, "ciphertext": []byte{}, "key_version": 0}).Error; err != nil {
		t.Fatal(err)
	}
	denied() // saved cleared MUST NOT fall back
	if err := db.Model(&meta.AdminServiceSecret{}).Where("name = ?", baiduMapSecretName).
		Updates(map[string]any{"ciphertext": []byte("malformed-aead"), "key_version": 1}).Error; err != nil {
		t.Fatal(err)
	}
	denied() // invalid encryption is an opaque failure
	if err := db.Model(&meta.AdminServiceSecret{}).Where("name = ?", baiduMapSecretName).
		Updates(map[string]any{"ciphertext": nextCipher, "key_version": nextVersion}).Error; err != nil {
		t.Fatal(err)
	}
	read("synthetic-saved-server-key-v2")
	server.ConnectorSecrets = nil
	denied()
	server.ConnectorSecrets = ring

	now := time.Now().UTC()
	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).
		Update("disabled_at", &now).Error; err != nil {
		t.Fatal(err)
	}
	denied()
	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).
		Updates(map[string]any{"disabled_at": nil, "must_change_password": true}).Error; err != nil {
		t.Fatal(err)
	}
	denied()
	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).
		Updates(map[string]any{"must_change_password": false, "session_version": uint64(0)}).Error; err != nil {
		t.Fatal(err)
	}
	denied()
	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).
		Update("session_version", uint64(2)).Error; err != nil {
		t.Fatal(err)
	}
	read("synthetic-saved-server-key-v2")
	canceled, stop := context.WithCancel(ctx)
	stop()
	if v, err := server.currentBaiduGeoconvServerAK(canceled, owner.ID); v != "" || err == nil {
		t.Fatal("canceled request disclosed credential")
	}
}
