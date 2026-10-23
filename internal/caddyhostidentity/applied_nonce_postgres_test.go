package caddyhostidentity

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
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

func appliedNonceTestPins() AppliedPins {
	digest := func(c string) string { return strings.Repeat(c, 64) }
	return AppliedPins{
		PublicKeyDER_SHA256: digest("a"),
		CollectorID:         digest("b"), HostID: digest("c"), ServerID: digest("d"),
		OperationID: strings.Repeat("1", 24), EnvSHA: digest("e"),
		GenerationSHA: digest("f"), ConfigSHA: digest("2"),
	}
}

func TestDurableAppliedNonceConsumerRefusesUntrustedInputs(t *testing.T) {
	pins := appliedNonceTestPins()
	nonce := strings.Repeat("3", 32)
	for _, invalid := range []string{"", strings.Repeat("3", 31), strings.Repeat("3", 33),
		strings.Repeat("G", 32), strings.Repeat("A", 32), "not-a-nonce"} {
		if validAppliedNonceInput(invalid, pins) {
			t.Fatalf("accepted invalid nonce %q", invalid)
		}
	}
	if !validAppliedNonceInput(nonce, pins) {
		t.Fatal("valid trusted nonce/pins rejected")
	}
	for _, invalid := range []AppliedPins{
		func() AppliedPins { p := pins; p.OperationID = "wrong"; return p }(),
		func() AppliedPins { p := pins; p.OperationID = strings.Repeat("F", 24); return p }(),
		func() AppliedPins { p := pins; p.CollectorID = strings.Repeat("0", 64); return p }(),
		func() AppliedPins { p := pins; p.PublicKeyDER_SHA256 = "bad"; return p }(),
	} {
		if validAppliedNonceInput(nonce, invalid) {
			t.Fatal("invalid collector/operation identity admitted")
		}
	}
	if err := DurableAppliedNonceConsumer(context.Background(), nil, pins)(nonce); !errors.Is(err, errAppliedUntrusted) {
		t.Fatal("nil DB unexpectedly consumed a nonce")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := DurableAppliedNonceConsumer(ctx, nil, pins)(nonce); !errors.Is(err, errAppliedUntrusted) {
		t.Fatal("cancelled consumer did not fail closed")
	}
	if err := DurableAppliedNonceConsumer(nil, nil, pins)(nonce); !errors.Is(err, errAppliedUntrusted) {
		t.Fatal("nil context consumer did not fail closed")
	}
}

func openAppliedNonceReplicaDB(t *testing.T) (*gorm.DB, *gorm.DB) {
	t.Helper()
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured: real PostgreSQL required")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "caddy_applied_nonce_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error })
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	open := func() *gorm.DB {
		db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		return db
	}
	first, second := open(), open()
	if err := first.AutoMigrate(&meta.AdminCaddyAppliedNonce{}); err != nil {
		t.Fatal(err)
	}
	return first, second
}

func TestDurableAppliedNonceConsumerPostgresReplicaAndRestart(t *testing.T) {
	first, second := openAppliedNonceReplicaDB(t)
	pins := appliedNonceTestPins()
	nonce := strings.Repeat("3", 32)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var accepted atomic.Int32
	var wg sync.WaitGroup
	failures := make(chan error, 24)
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			db := first
			if index%2 == 1 {
				db = second
			}
			err := DurableAppliedNonceConsumer(ctx, db, pins)(nonce)
			if err == nil {
				accepted.Add(1)
			} else if !errors.Is(err, errAppliedUntrusted) {
				failures <- err
			}
		}(i)
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		t.Errorf("unexpected replay result: %v", err)
	}
	if got := accepted.Load(); got != 1 {
		t.Fatalf("expected one global nonce consumer, got %d", got)
	}
	var persisted meta.AdminCaddyAppliedNonce
	if err := second.First(&persisted).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.OperationID != pins.OperationID ||
		persisted.ConfigSHA != pins.ConfigSHA ||
		persisted.CollectorID != pins.CollectorID ||
		persisted.HostID != pins.HostID || persisted.ServerID != pins.ServerID ||
		persisted.ConsumedAt.IsZero() || strings.Contains(persisted.NonceSHA256, nonce) {
		t.Fatalf("nonce ledger stored the wrong identity or raw nonce: %+v", persisted)
	}
	if err := DurableAppliedNonceConsumer(ctx, second, pins)(nonce); !errors.Is(err, errAppliedUntrusted) {
		t.Fatal("nonce replay after connection/replica switch was accepted")
	}
	otherPins := pins
	otherPins.OperationID = strings.Repeat("9", 24)
	if err := DurableAppliedNonceConsumer(ctx, first, otherPins)(nonce); !errors.Is(err, errAppliedUntrusted) {
		t.Fatal("same nonce replay with different operation was accepted")
	}
	if err := DurableAppliedNonceConsumer(ctx, second, pins)(strings.Repeat("4", 32)); err != nil {
		t.Fatalf("a different nonce must remain usable: %v", err)
	}
	var total int64
	if err := first.Model(&meta.AdminCaddyAppliedNonce{}).Count(&total).Error; err != nil || total != 2 {
		t.Fatalf("expected two retained nonce hashes, got %d: %v", total, err)
	}
}

func TestAppliedReceiptVerifiedSignatureUsesPostgresDurableNonce(t *testing.T) {
	first, second := openAppliedNonceReplicaDB(t)
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	keySHA := sha256.Sum256(der)
	pins := appliedNonceTestPins()
	pins.PublicKeyDER_SHA256 = hex.EncodeToString(keySHA[:])
	now := time.Now().UTC().Truncate(time.Second)
	receipt := AppliedReceipt{
		Schema: 1, Scope: "xdrive.caddy.applied-receipt.v1",
		CollectorID: pins.CollectorID, HostID: pins.HostID, ServerID: pins.ServerID,
		OperationID: pins.OperationID, EnvSHA: pins.EnvSHA,
		GenerationSHA: pins.GenerationSHA, ConfigSHA: pins.ConfigSHA,
		DomainState: appliedPositive, DomainProof: strings.Repeat("5", 64),
		LANState: appliedNegative, LANProof: strings.Repeat("6", 64),
		Nonce:      strings.Repeat("7", 32),
		ObservedAt: now.Format(time.RFC3339),
		ExpiresAt:  now.Add(25 * time.Second).Format(time.RFC3339),
	}
	raw, err := json.Marshal(receipt)
	if err != nil {
		t.Fatal(err)
	}
	sig := ed25519.Sign(priv, append([]byte(appliedDomain), raw...))
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if _, err := VerifyAppliedReceipt(raw, sig, der, pins, now,
		DurableAppliedNonceConsumer(ctx, first, pins)); err != nil {
		t.Fatalf("original signature did not consume nonce: %v", err)
	}
	if _, err := VerifyAppliedReceipt(raw, sig, der, pins, now,
		DurableAppliedNonceConsumer(ctx, second, pins)); !errors.Is(err, errAppliedUntrusted) {
		t.Fatal("original signed receipt replay succeeded on independent Server DB connection")
	}
	forged := append([]byte(nil), sig...)
	forged[0] ^= 1
	if _, err := VerifyAppliedReceipt(raw, forged, der, pins, now,
		DurableAppliedNonceConsumer(ctx, second, pins)); !errors.Is(err, errAppliedUntrusted) {
		t.Fatal("tampered signature was admitted")
	}
}
