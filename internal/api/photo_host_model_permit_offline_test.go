package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"github.com/lazyxu/xdrive/internal/sourceaccount"
)

const offlineTestPermitKey = "abababababababababababababababababababababababababababababababab"
const offlineTestPermitEpoch = "0123456789abcdef0123456789abcdef"

func testOfflineIssuer(
	ctx context.Context, lease *photoHostAdmissionLease,
) (photointelligence.PhotoModelPermitV1, string, error) {
	return lease.issueOfflinePhotoModelPermitV1(
		ctx, offlineTestPermitKey, offlineTestPermitEpoch,
		strings.Repeat("1", 32), strings.Repeat("2", 32),
		"POST", "/v1/semantic-text", []byte("{\"text\":\"hello\"}"),
		time.Unix(1700000000, 0),
	)
}

func TestOfflinePhotoPermitLiveSQLLeaseAndRevisionPostgres(t *testing.T) {
	db := photoHostAdmissionWorkloadTestDB(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	lease, ok, err := tryAcquirePhotoHostAdmission(ctx, db)
	if err != nil || !ok || lease == nil {
		t.Fatalf("legacy migrated admission unavailable: %v / %v", ok, err)
	}
	// Existing deployments without any gate revision still run ordinary
	// scheduled tasks, but must NEVER mint a revision-scoped model permit.
	if _, _, err := testOfflineIssuer(ctx, lease); err == nil {
		lease.Close()
		t.Fatal("missing positive revision produced a signed claim")
	}
	lease.Close()
	if err := db.Create(&meta.PhotoHostAdmissionGate{
		Name: photoHostAdmissionSettingName, Revision: 17, Frozen: false,
	}).Error; err != nil {
		t.Fatal(err)
	}
	lease, ok, err = tryAcquirePhotoHostAdmission(ctx, db)
	if err != nil || !ok || lease == nil {
		t.Fatalf("unfrozen positive admission unavailable: %v / %v", ok, err)
	}
	claim, mac, err := testOfflineIssuer(ctx, lease)
	if err != nil {
		lease.Close()
		t.Fatalf("valid shared session cannot prepare test claim: %v", err)
	}
	digest := sha256.Sum256([]byte("{\"text\":\"hello\"}"))
	if claim.Revision != 17 || claim.ExpiresAt-claim.IssuedAt != 10 ||
		claim.BodySHA256 != hex.EncodeToString(digest[:]) ||
		!regexp.MustCompile("^[0-9a-f]{32}$").MatchString(claim.Nonce) {
		lease.Close()
		t.Fatalf("invalid revision-scoped claim: %+v", claim)
	}
	same, err := photointelligence.SignPhotoModelPermitV1(offlineTestPermitKey, claim)
	if err != nil || same != mac {
		lease.Close()
		t.Fatal("test claim MAC cannot be verified in Go")
	}
	if _, _, err := lease.issueOfflinePhotoModelPermitV1(
		ctx, offlineTestPermitKey, offlineTestPermitEpoch,
		strings.Repeat("1", 32), strings.Repeat("2", 32),
		"GET", "/v1/face-detector-canary", []byte("not-empty"),
		time.Unix(1700000000, 0),
	); err == nil {
		lease.Close()
		t.Fatal("GET canary with nonempty body obtained a permit")
	}
	if _, _, err := lease.issueOfflinePhotoModelPermitV1(
		ctx, offlineTestPermitKey, offlineTestPermitEpoch,
		strings.Repeat("1", 32), strings.Repeat("2", 32),
		"POST", "/v1/host-apply-ack", nil,
		time.Unix(1700000000, 0),
	); err == nil {
		lease.Close()
		t.Fatal("Host Apply ACK obtained a model permit")
	}
	lease.Close()
	if _, _, err := testOfflineIssuer(ctx, lease); err == nil {
		t.Fatal("released shared SQL session continued issuing")
	}
	// Exactly one DB pool connection must suffice for issue and reuse.
	if err := db.Model(&meta.PhotoHostAdmissionGate{}).
		Where("name = ?", photoHostAdmissionSettingName).
		Update("frozen", true).Error; err != nil {
		t.Fatal(err)
	}
	if next, admitted, err := tryAcquirePhotoHostAdmission(ctx, db); err != nil || admitted {
		if next != nil {
			next.Close()
		}
		t.Fatalf("frozen admission row permitted new task: %v / %v", admitted, err)
	}
}

func TestOfflinePhotoPermitRejectsFakeConnAndExclusiveWriterPostgres(t *testing.T) {
	db := photoHostAdmissionWorkloadTestDB(t)
	if err := db.Create(&meta.PhotoHostAdmissionGate{
		Name: photoHostAdmissionSettingName, Revision: 8,
	}).Error; err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(4)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := sqlDB.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// A fabricated lease with the correct key, conn and revision but no
	// actual pg_locks ShareLock must be rejected.
	fake := &photoHostAdmissionLease{conn: conn, key: photoHostAdmissionLockID()}
	if _, _, err := testOfflineIssuer(ctx, fake); err == nil {
		conn.Close()
		t.Fatal("unlocked backend session issued a permit")
	}
	if err := conn.Close(); err != nil {
		t.Fatal(err)
	}
	writer, allowed, err := sourceaccount.TryAcquire(ctx, db, photoHostAdmissionLockName)
	if err != nil || !allowed {
		t.Fatalf("test exclusive maintenance lock unavailable: %v / %v", allowed, err)
	}
	if lease, admitted, err := tryAcquirePhotoHostAdmission(ctx, db); err != nil || admitted {
		writer.Close()
		if lease != nil {
			lease.Close()
		}
		t.Fatalf("new admission bypassed exclusive maintenance writer: %v / %v", admitted, err)
	}
	writer.Close()
	lease, admitted, err := tryAcquirePhotoHostAdmission(ctx, db)
	if err != nil || !admitted {
		t.Fatalf("shared admission did not resume: %v / %v", admitted, err)
	}
	if _, _, err := testOfflineIssuer(ctx, lease); err != nil {
		lease.Close()
		t.Fatalf("valid shared session denied test permit: %v", err)
	}
	lease.Close()
	if _, _, err := testOfflineIssuer(ctx, lease); err == nil {
		t.Fatal("closed lease issued signed model claim")
	}
	cancel()
	if _, _, err := testOfflineIssuer(ctx, lease); err == nil {
		t.Fatal("canceled context issued signed model claim")
	}
}
