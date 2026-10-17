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
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestBaiduGeoconvSignedAccountQuotaFailsClosedWithoutTrust(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, tc := range []struct {
		ctx   context.Context
		owner uint64
	}{
		{nil, 1}, {ctx, 1}, {context.Background(), 0}, {context.Background(), 1},
	} {
		err := reserveBaiduGeoconvSignedAccountQuota(
			tc.ctx, nil, tc.owner, baiduGeoconvAccountEvidenceProof{},
			baiduGeoconvAccountEvidenceScope{}, nil,
		)
		if !errors.Is(err, errBaiduGeoconvDispatchUnavailable) {
			t.Fatal("untrusted signed quota admitted")
		}
	}
}

func TestBaiduGeoconvSignedLowerCapsAtomicTwoPostgresPools(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated real PostgreSQL service required")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	pool, err := root.DB()
	if err != nil {
		t.Fatal(err)
	}
	pool.SetMaxOpenConns(2)
	defer pool.Close()
	schema := "geoconv_signed_quota_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := parsed.Query()
	q.Set("search_path", schema)
	parsed.RawQuery = q.Encode()
	open := func() *gorm.DB {
		t.Helper()
		db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		sqlDB, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		sqlDB.SetMaxOpenConns(8)
		t.Cleanup(func() { _ = sqlDB.Close() })
		return db
	}
	db, peer := open(), open()
	if err := db.AutoMigrate(&meta.BaiduGeoconvQuotaBucket{}); err != nil {
		t.Fatal(err)
	}
	public, secret, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	var now time.Time
	if err := db.Raw("SELECT clock_timestamp()").Row().Scan(&now); err != nil {
		t.Fatal(err)
	}
	scope := func(owner uint64) baiduGeoconvAccountEvidenceScope {
		return baiduGeoconvAccountEvidenceScope{
			OwnerID: owner, SessionVersion: 2, ServerAKRevision: 7, EvidenceRevision: 1,
			EvidenceSHA256: sha256.Sum256([]byte("synthetic offline account evidence")),
			MinuteCaps: baiduGeoconvQuotaLimits{
				OwnerRequests: 1, FleetRequests: 2, OwnerPoints: 1, FleetPoints: 2,
			},
			CadenceCaps: baiduGeoconvCadenceCaps{
				OwnerSecond: 1, FleetSecond: 2, OwnerDay: 1, FleetDay: 2,
			},
		}
	}
	sign := func(s baiduGeoconvAccountEvidenceScope) baiduGeoconvAccountEvidenceProof {
		p := baiduGeoconvAccountEvidenceProof{
			Format: baiduGeoconvEvidenceFormat, Scope: s,
			IssuedUnix: now.Unix() - 10, ExpiresUnix: now.Unix() + 110,
		}
		msg := baiduGeoconvAccountEvidenceMessage(p)
		copy(p.Signature[:], ed25519.Sign(secret, msg))
		clear(msg)
		return p
	}
	read := func(owner int64) meta.BaiduGeoconvQuotaBucket {
		t.Helper()
		var row meta.BaiduGeoconvQuotaBucket
		if err := peer.Where("scope_id = ?", owner).Take(&row).Error; err != nil {
			t.Fatal(err)
		}
		return row
	}
	first, second := scope(71), scope(72)
	p1, p2 := sign(first), sign(second)
	denied := func(proof baiduGeoconvAccountEvidenceProof, expected baiduGeoconvAccountEvidenceScope,
		owner uint64, key ed25519.PublicKey) {
		t.Helper()
		if err := reserveBaiduGeoconvSignedAccountQuota(
			context.Background(), db, owner, proof, expected, key,
		); !errors.Is(err, errBaiduGeoconvDispatchUnavailable) {
			t.Fatal("untrusted signed quota admitted")
		}
	}
	denied(p1, first, 71, nil)
	denied(p1, first, 72, public)
	stale := first
	stale.ServerAKRevision++
	denied(p1, stale, 71, public)
	stale = first
	stale.CadenceCaps.OwnerDay++
	denied(p1, stale, 71, public)
	tampered := p1
	tampered.Signature[0] ^= 1
	denied(tampered, first, 71, public)
	expired := p1
	expired.IssuedUnix -= 1000
	expired.ExpiresUnix -= 1000
	denied(expired, first, 71, public)
	var before int64
	if err := peer.Model(&meta.BaiduGeoconvQuotaBucket{}).Count(&before).Error; err != nil || before != 0 {
		t.Fatal("denied proof mutated fleet/Owner budget")
	}

	// Different replicas share the same fleet row; many signed Owner claims
	// cannot overrun the two-request fleet cap or one-request Owner cap.
	var success atomic.Int64
	var deniedCount atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			owner, sc, proof, connection := uint64(71), first, p1, db
			if i%2 == 1 {
				owner, sc, proof, connection = 72, second, p2, peer
			}
			err := reserveBaiduGeoconvSignedAccountQuota(
				context.Background(), connection, owner, proof, sc, public,
			)
			switch {
			case err == nil:
				success.Add(1)
			case errors.Is(err, errBaiduGeoconvDispatchUnavailable):
				deniedCount.Add(1)
			default:
				t.Errorf("quota returned unredacted error")
			}
		}(i)
	}
	wg.Wait()
	if success.Load() != 2 || deniedCount.Load() != 10 {
		t.Fatalf("signed quota parallel admitted=%d denied=%d", success.Load(), deniedCount.Load())
	}
	if fleet, a, b := read(0), read(71), read(72); fleet.Requests != 2 ||
		fleet.Points != 2 || fleet.DayRequests != 2 ||
		a.Requests != 1 || a.DayRequests != 1 ||
		b.Requests != 1 || b.DayRequests != 1 {
		t.Fatal("cross-replica signed lower limits were not enforced atomically")
	}

	// A full daily bucket rejects one new, otherwise minute-eligible Owner.
	// It must not charge the fleet minute or leave a new Owner row behind.
	if err := db.Exec("DELETE FROM xd_baidu_geoconv_quota_buckets").Error; err != nil {
		t.Fatal(err)
	}
	dayScope := scope(73)
	dayScope.CadenceCaps.FleetDay = 1
	dayProof := sign(dayScope)
	if err := db.Create(&meta.BaiduGeoconvQuotaBucket{
		ScopeID: 0, WindowMinute: 0, WindowDay: now.Unix() / 86400, DayRequests: 1,
	}).Error; err != nil {
		t.Fatal(err)
	}
	denied(dayProof, dayScope, 73, public)
	if fleet := read(0); fleet.Requests != 0 || fleet.Points != 0 || fleet.DayRequests != 1 {
		t.Fatal("daily denial failed to roll back fleet minute reservation")
	}
	var ownerRows int64
	if err := peer.Model(&meta.BaiduGeoconvQuotaBucket{}).
		Where("scope_id = ?", 73).Count(&ownerRows).Error; err != nil || ownerRows != 0 {
		t.Fatal("denied signed proof left Owner quota residue")
	}
	if err := db.Migrator().DropTable(&meta.BaiduGeoconvQuotaBucket{}); err != nil {
		t.Fatal(err)
	}
	denied(p1, first, 71, public) // missing migration always fails closed
}
