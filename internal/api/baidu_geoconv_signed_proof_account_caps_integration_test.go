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

func TestBaiduSignedProofAccountCapsFailsClosedWithoutTrust(t *testing.T) {
	ctx, stop := context.WithCancel(context.Background())
	stop()
	for _, item := range []struct {
		ctx   context.Context
		owner uint64
	}{
		{nil, 71},
		{ctx, 71},
		{context.Background(), 0},
		{context.Background(), baiduGeoconvQuotaMaxOwnerID + 1},
		{context.Background(), 71},
	} {
		err := reserveBaiduGeoconvSignedProofAccountCaps(
			item.ctx, nil, item.owner, baiduGeoconvAccountEvidenceProof{},
			nil, baiduGeoconvAccountEvidenceScope{},
		)
		if !errors.Is(err, errBaiduGeoconvDispatchUnavailable) {
			t.Fatal("missing trustworthy private request admitted")
		}
	}
}

func TestBaiduSignedProofAccountCapsAtomicPostgresTwoPools(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated real PostgreSQL service required")
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
	schema := "geoconv_proof_caps_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err := db.AutoMigrate(&meta.BaiduGeoconvQuotaBucket{}); err != nil {
		t.Fatal(err)
	}
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	otherKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	var now time.Time
	if err := db.Raw("SELECT clock_timestamp()").Row().Scan(&now); err != nil || now.IsZero() {
		t.Fatal(err)
	}
	scope := func(owner uint64) baiduGeoconvAccountEvidenceScope {
		return baiduGeoconvAccountEvidenceScope{
			OwnerID: owner, SessionVersion: 4, ServerAKRevision: 8, EvidenceRevision: 2,
			EvidenceSHA256: sha256.Sum256([]byte("synthetic offline reviewed account terms")),
			MinuteCaps: baiduGeoconvQuotaLimits{
				OwnerRequests: 1, FleetRequests: 2, OwnerPoints: 1, FleetPoints: 2,
			},
			CadenceCaps: baiduGeoconvCadenceCaps{
				OwnerSecond: 1, FleetSecond: 2, OwnerDay: 1, FleetDay: 2,
			},
		}
	}
	sign := func(s baiduGeoconvAccountEvidenceScope, issued, expires int64) baiduGeoconvAccountEvidenceProof {
		p := baiduGeoconvAccountEvidenceProof{
			Format: baiduGeoconvEvidenceFormat, Scope: s,
			IssuedUnix: issued, ExpiresUnix: expires,
		}
		msg := baiduGeoconvAccountEvidenceMessage(p)
		copy(p.Signature[:], ed25519.Sign(private, msg))
		clear(msg)
		return p
	}
	issue := func(owner uint64) baiduGeoconvAccountEvidenceProof {
		return sign(scope(owner), now.Unix()-10, now.Unix()+180)
	}
	attempt := func(connection *gorm.DB, owner uint64, p baiduGeoconvAccountEvidenceProof,
		expected baiduGeoconvAccountEvidenceScope, key ed25519.PublicKey) error {
		return reserveBaiduGeoconvSignedProofAccountCaps(
			context.Background(), connection, owner, p, key, expected,
		)
	}
	deny := func(connection *gorm.DB, owner uint64, p baiduGeoconvAccountEvidenceProof,
		expected baiduGeoconvAccountEvidenceScope, key ed25519.PublicKey) {
		t.Helper()
		if err := attempt(connection, owner, p, expected, key); !errors.Is(err, errBaiduGeoconvDispatchUnavailable) {
			t.Fatal("unsigned, expired or over-quota attempt admitted")
		}
	}
	read := func(id int64) meta.BaiduGeoconvQuotaBucket {
		t.Helper()
		var row meta.BaiduGeoconvQuotaBucket
		if err := peer.Where("scope_id = ?", id).Take(&row).Error; err != nil {
			t.Fatal(err)
		}
		return row
	}
	first, p1 := scope(71), issue(71)
	deny(db, 71, p1, first, nil)
	deny(db, 71, p1, first, otherKey)
	deny(db, 72, p1, first, public)
	outdated := first
	outdated.ServerAKRevision++
	deny(db, 71, p1, outdated, public)
	outdated = first
	outdated.SessionVersion++
	deny(db, 71, p1, outdated, public)
	tampered := p1
	tampered.Signature[0] ^= 1
	deny(db, 71, tampered, first, public)
	expired := sign(first, now.Unix()-300, now.Unix()-290)
	deny(db, 71, expired, first, public)
	var empty int64
	if err := peer.Model(&meta.BaiduGeoconvQuotaBucket{}).Count(&empty).Error; err != nil || empty != 0 {
		t.Fatal("denied signed proofs consumed quota or created a fleet bucket")
	}

	// Two distinct PostgreSQL pools share the fleet and each Owner's minute,
	// second and UTC-day counters. At most two valid signed photos are allowed.
	var success atomic.Int64
	var deniedCount atomic.Int64
	var unexpected atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 18; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			connection := db
			if i%2 == 1 {
				connection = peer
			}
			owner := uint64(71 + i%3)
			err := attempt(connection, owner, issue(owner), scope(owner), public)
			switch {
			case err == nil:
				success.Add(1)
			case errors.Is(err, errBaiduGeoconvDispatchUnavailable):
				deniedCount.Add(1)
			default:
				unexpected.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if success.Load() != 2 || deniedCount.Load() != 16 || unexpected.Load() != 0 {
		t.Fatalf("cross-replica signed quota drift: success=%d denied=%d unexpected=%d",
			success.Load(), deniedCount.Load(), unexpected.Load())
	}
	if fleet := read(0); fleet.Requests != 2 || fleet.Points != 2 || fleet.DayRequests != 2 {
		t.Fatal("two-pool signed fleet quota oversubscribed or not atomic")
	}
	var ownerTotals int64
	for _, owner := range []int64{71, 72, 73} {
		var row meta.BaiduGeoconvQuotaBucket
		if err := peer.Where("scope_id = ?", owner).Find(&row).Error; err != nil {
			t.Fatal(err)
		}
		if row.Requests > 1 || row.DayRequests > 1 {
			t.Fatal("Owner signed quota oversubscribed")
		}
		ownerTotals += row.Requests
	}
	if ownerTotals != 2 {
		t.Fatal("fleet and Owner signed reservations diverged")
	}

	// Once Fleet UTC-day capacity is exhausted, its earlier minute mutation
	// and newly inserted Owner row must both roll back.
	if err := db.Exec("DELETE FROM xd_baidu_geoconv_quota_buckets").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.BaiduGeoconvQuotaBucket{
		ScopeID: 0, WindowMinute: 0, WindowDay: now.Unix() / 86400,
		DayRequests: 2,
	}).Error; err != nil {
		t.Fatal(err)
	}
	deny(db, 74, issue(74), scope(74), public)
	if fleet := read(0); fleet.Requests != 0 || fleet.Points != 0 || fleet.DayRequests != 2 {
		t.Fatal("denied day quota failed to roll back minute fleet usage")
	}
	var blockedOwner int64
	if err := peer.Model(&meta.BaiduGeoconvQuotaBucket{}).
		Where("scope_id = ?", 74).Count(&blockedOwner).Error; err != nil || blockedOwner != 0 {
		t.Fatal("day quota rejection left a partial Owner row")
	}
	if err := db.Migrator().DropTable(&meta.BaiduGeoconvQuotaBucket{}); err != nil {
		t.Fatal(err)
	}
	deny(db, 71, p1, first, public) // absent migration must fail closed
}
