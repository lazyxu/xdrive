package api

import (
	"context"
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
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func testCaddyDBPendingDigest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return fmt.Sprintf("%x", sum)
}

func testCaddyDBPendingFixture(t *testing.T) (*gorm.DB, *gorm.DB, *connectorsecret.Keyring) {
	t.Helper()
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured: genuine PostgreSQL required")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "caddy_db_pending_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error })
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
	db2, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.AdminCaddyHTTPSSetting{},
		&meta.AdminServiceSecret{}, &meta.AdminCaddyHostApplyReservation{}); err != nil {
		t.Fatal(err)
	}
	ring, err := connectorsecret.NewKeyring(1, map[uint32]string{1: strings.Repeat("ac", 32)})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.AdminCaddyHTTPSSetting{
		Name: caddyHTTPSSettingName, Revision: 7,
		LANEnabled: true, LANIP: "192.168.2.4",
	}).Error; err != nil {
		t.Fatal(err)
	}
	return db, db2, ring
}

func testCaddyDBPendingRequest(t *testing.T, revision, credential uint64,
	domainEnabled bool, domain string, lanEnabled bool, ip string) caddyHostDBReservationRequest {
	t.Helper()
	body, err := buildCaddyHTTPSHostPlan(caddyPreflightSnapshot{
		Desired: adminCaddyHTTPSDesired{
			Revision: revision, Source: "saved", Enabled: domainEnabled,
			Domain: domain, LANEnabled: lanEnabled, LANIP: ip,
		},
		Credential: meta.AdminServiceSecret{
			Revision: credential, Enabled: credential != 0, KeyVersion: 1,
			Ciphertext: []byte("fake-test-encrypted-metadata"),
		},
		CredentialExists: credential != 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(body)
	return caddyHostDBReservationRequest{
		HTTPSRevision: revision, CredentialRevision: credential,
		OperationSHA256:            testCaddyDBPendingDigest("operator-operation"),
		NonceSHA256:                testCaddyDBPendingDigest("nonce"),
		IntentSHA256:               testCaddyDBPendingDigest("signed-intent"),
		PlanSHA256:                 fmt.Sprintf("%x", sum),
		CandidateEnvironmentSHA256: testCaddyDBPendingDigest("candidate-env"),
	}
}

func TestCaddyHostDBReservationInputRejectsUntrustedHashes(t *testing.T) {
	req := caddyHostDBReservationRequest{
		HTTPSRevision: 1, OperationSHA256: testCaddyDBPendingDigest("operation"),
		NonceSHA256:                testCaddyDBPendingDigest("nonce"),
		IntentSHA256:               testCaddyDBPendingDigest("intent"),
		PlanSHA256:                 testCaddyDBPendingDigest("plan"),
		CandidateEnvironmentSHA256: testCaddyDBPendingDigest("candidate"),
	}
	if !validCaddyHostDBReservationRequest(req) {
		t.Fatal("rejected valid digest-only reservation request")
	}
	for _, bad := range []string{"", "f", strings.Repeat("F", 64), strings.Repeat("g", 64),
		strings.Repeat("a", 63), strings.Repeat("a", 65)} {
		wrong := req
		wrong.NonceSHA256 = bad
		if validCaddyHostDBReservationRequest(wrong) {
			t.Fatalf("accepted noncanonical nonce digest %q", bad)
		}
	}
	for _, revision := range []uint64{0, 1 << 60, 1 << 61} {
		wrong := req
		wrong.HTTPSRevision = revision
		if validCaddyHostDBReservationRequest(wrong) {
			t.Fatalf("accepted unsafe desired revision %d", revision)
		}
	}
}

func TestCaddyHostDBPendingOneReservationAndNoReplay(t *testing.T) {
	db, second, ring := testCaddyDBPendingFixture(t)
	input := testCaddyDBPendingRequest(t, 7, 0, false, "", true, "192.168.2.4")
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	for _, wrong := range []caddyHostDBReservationRequest{
		func() caddyHostDBReservationRequest { x := input; x.HTTPSRevision = 6; return x }(),
		func() caddyHostDBReservationRequest { x := input; x.PlanSHA256 = strings.Repeat("f", 64); return x }(),
		func() caddyHostDBReservationRequest { x := input; x.NonceSHA256 = "not-hex"; return x }(),
	} {
		if err := stageCaddyHostDBPendingUnapplied(ctx, db, ring, wrong); !errors.Is(err, errCaddyHostDBReservationBlocked) {
			t.Fatalf("expected fail-closed stale/unsafe request: %v", err)
		}
	}
	var before int64
	if err := db.Model(&meta.AdminCaddyHostApplyReservation{}).Count(&before).Error; err != nil || before != 0 {
		t.Fatalf("failed input wrote a reservation: %d %v", before, err)
	}
	var accepted atomic.Int32
	var wg sync.WaitGroup
	failures := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			target := db
			if index%2 == 1 {
				target = second
			}
			err := stageCaddyHostDBPendingUnapplied(ctx, target, ring, input)
			if err == nil {
				accepted.Add(1)
			} else if !errors.Is(err, errCaddyHostDBReservationBlocked) {
				failures <- err
			}
		}(i)
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		t.Errorf("unexpected concurrent DB error: %v", err)
	}
	if accepted.Load() != 1 {
		t.Fatalf("expected exactly one durable winner, got %d", accepted.Load())
	}
	var saved meta.AdminCaddyHostApplyReservation
	if err := db.Where("name = ?", caddyHostDBReservationName).Take(&saved).Error; err != nil {
		t.Fatal(err)
	}
	if saved.State != "pending-unapplied" || saved.HTTPSRevision != 7 ||
		saved.CredentialRevision != 0 || saved.NonceSHA256 != input.NonceSHA256 ||
		saved.PlanSHA256 != input.PlanSHA256 {
		t.Fatalf("stored reservation not revision/hash bound: %+v", saved)
	}
	again := input
	again.OperationSHA256 = testCaddyDBPendingDigest("another-operation")
	if err := stageCaddyHostDBPendingUnapplied(ctx, second, ring, again); !errors.Is(err, errCaddyHostDBReservationBlocked) {
		t.Fatalf("replay/different operation must stay blocked: %v", err)
	}
	var count int64
	if err := db.Model(&meta.AdminCaddyHostApplyReservation{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("sticky reservation was lost or duplicated: %d %v", count, err)
	}
}

func TestCaddyHostDBPendingDomainRequiresDecryptableAliDNS(t *testing.T) {
	db, _, ring := testCaddyDBPendingFixture(t)
	if err := db.Model(&meta.AdminCaddyHTTPSSetting{}).
		Where("name = ?", caddyHTTPSSettingName).Updates(map[string]any{
		"revision": 8, "enabled": true, "domain": "drive.example.com",
		"lan_enabled": false, "lan_ip": "",
	}).Error; err != nil {
		t.Fatal(err)
	}
	plaintext := []byte(`{"access_key_id":"LTAITestValidExample","access_key_secret":"ValidSyntheticSecret123456"}`)
	version, ciphertext, err := ring.Seal(
		caddyAliDNSSecretAADID, caddyAliDNSSecretKind, plaintext)
	clear(plaintext)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.AdminServiceSecret{
		Name: caddyAliDNSSecretName, Revision: 3,
		Enabled: true, KeyVersion: version, Ciphertext: ciphertext,
	}).Error; err != nil {
		t.Fatal(err)
	}
	input := testCaddyDBPendingRequest(t, 8, 3, true, "drive.example.com", false, "")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := stageCaddyHostDBPendingUnapplied(ctx, db, nil, input); !errors.Is(err, errCaddyHostDBReservationBlocked) {
		t.Fatalf("no keyring must block domain plan: %v", err)
	}
	wrongRing, err := connectorsecret.NewKeyring(1, map[uint32]string{1: strings.Repeat("be", 32)})
	if err != nil {
		t.Fatal(err)
	}
	if err := stageCaddyHostDBPendingUnapplied(ctx, db, wrongRing, input); !errors.Is(err, errCaddyHostDBReservationBlocked) {
		t.Fatalf("wrong keyring must block domain plan: %v", err)
	}
	if err := stageCaddyHostDBPendingUnapplied(ctx, db, ring, input); err != nil {
		t.Fatalf("valid synthetic domain plan rejected: %v", err)
	}
	var saved meta.AdminCaddyHostApplyReservation
	if err := db.Where("name = ?", caddyHostDBReservationName).Take(&saved).Error; err != nil {
		t.Fatal(err)
	}
	if saved.CredentialRevision != 3 || saved.State != "pending-unapplied" {
		t.Fatalf("credential revision not reserved: %+v", saved)
	}
	// A DB-only pending row is NEVER an applied receipt. A future Host
	// controller must fence later desired/credential edits independently.
}
