package api

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
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

func TestCurrentBaiduGeoconvProofQuotaRejectsUntrustedServer(t *testing.T) {
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
		err := tc.server.reserveCurrentBaiduGeoconvSignedAccountQuota(
			tc.ctx, tc.owner, baiduGeoconvAccountEvidenceProof{},
			baiduGeoconvTrustedEvidenceReference{}, nil,
		)
		if !errors.Is(err, errBaiduGeoconvDispatchUnavailable) {
			t.Fatal("missing private Server authority admitted account quota")
		}
	}
}

func TestCurrentBaiduGeoconvProofQuotaLocksLiveOwnerAndServerAKAcrossPools(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated real PostgreSQL is required")
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
	schema := "geoconv_current_scope_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err := db.AutoMigrate(&meta.User{}, &meta.AdminServiceSecret{}, &meta.BaiduGeoconvQuotaBucket{}); err != nil {
		t.Fatal(err)
	}
	keyring, err := connectorsecret.NewKeyring(1, map[uint32]string{
		1: strings.Repeat("bc", 32),
	})
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{DB: peer, ConnectorSecrets: keyring,
		BaiduMapEnabled: true, BaiduMapAK: "synthetic-env-must-not-fallback"}
	owner := meta.User{
		Username: "geoconv-live-proof", PasswordHash: "synthetic",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	var clock time.Time
	if err := db.Raw("SELECT clock_timestamp()").Row().Scan(&clock); err != nil {
		t.Fatal(err)
	}
	evidence := baiduGeoconvTrustedEvidenceReference{
		Revision: 1,
		Digest:   sha256.Sum256([]byte("synthetic independent reviewed quota evidence")),
		MinuteCaps: baiduGeoconvQuotaLimits{
			OwnerRequests: 1, FleetRequests: 2, OwnerPoints: 1, FleetPoints: 2,
		},
		CadenceCaps: baiduGeoconvCadenceCaps{
			OwnerSecond: 1, FleetSecond: 2, OwnerDay: 2, FleetDay: 3,
		},
	}
	sign := func(session, revision uint64) baiduGeoconvAccountEvidenceProof {
		t.Helper()
		p := baiduGeoconvAccountEvidenceProof{
			Format: baiduGeoconvEvidenceFormat,
			Scope: baiduGeoconvAccountEvidenceScope{
				OwnerID: owner.ID, SessionVersion: session,
				ServerAKRevision: revision,
				EvidenceRevision: evidence.Revision,
				EvidenceSHA256:   evidence.Digest,
				MinuteCaps:       evidence.MinuteCaps,
				CadenceCaps:      evidence.CadenceCaps,
			},
			IssuedUnix: clock.Unix() - 10, ExpiresUnix: clock.Unix() + 180,
		}
		msg := baiduGeoconvAccountEvidenceMessage(p)
		copy(p.Signature[:], ed25519.Sign(privateKey, msg))
		clear(msg)
		return p
	}
	attempt := func(p baiduGeoconvAccountEvidenceProof, ref baiduGeoconvTrustedEvidenceReference) error {
		t.Helper()
		return s.reserveCurrentBaiduGeoconvSignedAccountQuota(
			context.Background(), owner.ID, p, ref, publicKey,
		)
	}
	denied := func(p baiduGeoconvAccountEvidenceProof, ref baiduGeoconvTrustedEvidenceReference) {
		t.Helper()
		if err := attempt(p, ref); !errors.Is(err, errBaiduGeoconvDispatchUnavailable) {
			t.Fatal("stale Owner/session/credential/evidence was accepted")
		}
	}
	countRows := func(want int64) {
		t.Helper()
		var got int64
		if err := db.Model(&meta.BaiduGeoconvQuotaBucket{}).Count(&got).Error; err != nil || got != want {
			t.Fatalf("unexpected quota residue: %d rows (expected %d)", got, want)
		}
	}
	reset := func() {
		t.Helper()
		if err := db.Exec("DELETE FROM xd_baidu_geoconv_quota_buckets").Error; err != nil {
			t.Fatal(err)
		}
	}
	p1 := sign(1, 1)
	// An environment AK and a configured Browser key never count as the
	// current revisioned encrypted Server AK for signed account admission.
	denied(p1, evidence)
	browserVersion, browserCiphertext, err := keyring.Seal(
		baiduJSAPISecretAADID, baiduJSAPISecretKind,
		[]byte("synthetic-browser-only-jsapi-key"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.AdminServiceSecret{
		Name: baiduJSAPISecretName, Enabled: true,
		Revision: 1, KeyVersion: browserVersion, Ciphertext: browserCiphertext,
	}).Error; err != nil {
		t.Fatal(err)
	}
	denied(p1, evidence)
	countRows(0)

	serverVersion, serverCiphertext, err := keyring.Seal(
		baiduMapSecretAADID, baiduMapSecretKind, []byte("synthetic-current-server-ak-v1"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.AdminServiceSecret{
		Name: baiduMapSecretName, Enabled: true,
		Revision: 1, KeyVersion: serverVersion, Ciphertext: serverCiphertext,
	}).Error; err != nil {
		t.Fatal(err)
	}
	tampered := p1
	tampered.Signature[0] ^= 1
	denied(tampered, evidence)
	wrong := evidence
	wrong.Revision = 2
	denied(p1, wrong)
	denied(sign(2, 1), evidence)
	denied(sign(1, 2), evidence)
	countRows(0)
	if err := attempt(p1, evidence); err != nil {
		t.Fatal("valid synthetic locked current proof was rejected")
	}
	countRows(2)         // fleet and Owner charged once
	denied(p1, evidence) // Owner limit 1, no second charge
	countRows(2)
	reset()

	// Independent Server replica rotates current encrypted Server secret;
	// the old signature cannot be replayed or fall back to Browser/env.
	rotatedVersion, rotatedCiphertext, err := keyring.Seal(
		baiduMapSecretAADID, baiduMapSecretKind, []byte("synthetic-current-server-ak-v2"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.AdminServiceSecret{}).Where("name = ?", baiduMapSecretName).
		Updates(map[string]any{"revision": uint64(2), "key_version": rotatedVersion,
			"ciphertext": rotatedCiphertext}).Error; err != nil {
		t.Fatal(err)
	}
	denied(p1, evidence)
	countRows(0)
	p2 := sign(1, 2)
	if err := attempt(p2, evidence); err != nil {
		t.Fatal("current rotated Server revision was not observed across pools")
	}
	reset()

	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).
		Update("session_version", uint64(2)).Error; err != nil {
		t.Fatal(err)
	}
	denied(p2, evidence)
	countRows(0)
	p3 := sign(2, 2)
	if err := attempt(p3, evidence); err != nil {
		t.Fatal("current session version was not accepted")
	}
	reset()
	now := time.Now().UTC()
	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).
		Update("disabled_at", &now).Error; err != nil {
		t.Fatal(err)
	}
	denied(p3, evidence)
	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).
		Updates(map[string]any{"disabled_at": nil, "must_change_password": true}).Error; err != nil {
		t.Fatal(err)
	}
	denied(p3, evidence)
	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).
		Updates(map[string]any{"must_change_password": false, "session_version": uint64(0)}).Error; err != nil {
		t.Fatal(err)
	}
	denied(p3, evidence)
	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).
		Update("session_version", uint64(2)).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.AdminServiceSecret{}).Where("name = ?", baiduMapSecretName).
		Update("enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	denied(p3, evidence)
	if err := db.Model(&meta.AdminServiceSecret{}).Where("name = ?", baiduMapSecretName).
		Updates(map[string]any{"enabled": true, "ciphertext": []byte("invalid-aead")}).Error; err != nil {
		t.Fatal(err)
	}
	denied(p3, evidence)
	if err := db.Model(&meta.AdminServiceSecret{}).Where("name = ?", baiduMapSecretName).
		Updates(map[string]any{"ciphertext": rotatedCiphertext}).Error; err != nil {
		t.Fatal(err)
	}
	s.ConnectorSecrets = nil
	denied(p3, evidence)
	s.ConnectorSecrets = keyring
	countRows(0)
	if err := db.Migrator().DropTable(&meta.BaiduGeoconvQuotaBucket{}); err != nil {
		t.Fatal(err)
	}
	denied(p3, evidence) // missing migration never authorizes unmetered egress
}
