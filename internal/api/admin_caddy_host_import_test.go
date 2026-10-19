package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func testCaddyHostImportDB(t *testing.T) (*gorm.DB, *gorm.DB, *connectorsecret.Keyring) {
	t.Helper()
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is required for a real PostgreSQL host adoption test")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "caddy_host_import_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	other, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.AdminCaddyHTTPSSetting{}, &meta.AdminCaddyHTTPSRevision{},
		&meta.AdminCaddyHostApplyReservation{}, &meta.AdminServiceSecret{},
		&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	ring, err := connectorsecret.NewKeyring(1, map[uint32]string{1: strings.Repeat("ef", 32)})
	if err != nil {
		t.Fatal(err)
	}
	return db, other, ring
}

func TestCaddyHostImportRejectsInsecureAndIncompleteInput(t *testing.T) {
	db, _, ring := testCaddyHostImportDB(t)
	for _, input := range []CaddyHostDeploymentImport{
		{},
		{LANIP: "8.8.8.8"},
		{LANIP: "192.168.02.5"},
		{Domain: "https://drive.example.com", AliDNSAccessKeyID: "ExampleValidAKID",
			AliDNSAccessSecret: "ExampleValidAKSecret"},
		{Domain: "drive.example.com", AliDNSAccessKeyID: "ExampleValidAKID"},
		{LANIP: "192.168.2.5", AliDNSAccessKeyID: "ExampleValidAKID",
			AliDNSAccessSecret: "ExampleValidAKSecret"},
	} {
		if _, err := ImportCaddyHostDeployment(context.Background(), db, ring, input); err == nil {
			t.Fatalf("accepted invalid host adoption input (values redacted)")
		}
	}
	var count int64
	if err := db.Model(&meta.AdminCaddyHTTPSSetting{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("invalid host import wrote desired state: %d %v", count, err)
	}
}

func TestCaddyHostImportAtomicallyAdoptsLegacyDomainLANAndEncryptedSecret(t *testing.T) {
	db, second, ring := testCaddyHostImportDB(t)
	const keyID = "ExampleHostAliDNSAK"
	const secret = "ExamplePrivateHostAliDNSSecret"
	input := CaddyHostDeploymentImport{
		Domain: "PHOTOS.EXAMPLE.COM", LANIP: "192.168.8.12",
		AliDNSAccessKeyID: keyID, AliDNSAccessSecret: secret,
	}
	var success atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			pool := db
			if n%2 == 1 {
				pool = second
			}
			status, err := ImportCaddyHostDeployment(context.Background(), pool, ring, input)
			if err != nil {
				t.Errorf("parallel adoption failed: %v", err)
				return
			}
			if status == "imported-unverified" {
				success.Add(1)
			} else if status != "already-managed" {
				t.Errorf("unexpected adoption status: %q", status)
			}
		}(i)
	}
	wg.Wait()
	if success.Load() != 1 {
		t.Fatalf("parallel imports committed %d times, want one", success.Load())
	}
	desired, err := readCaddyHTTPSDesiredDB(db)
	if err != nil {
		t.Fatal(err)
	}
	if desired.Source != caddyImportedHostOrigin || desired.Revision != 1 ||
		!desired.Enabled || desired.Domain != "photos.example.com" ||
		!desired.LANEnabled || desired.LANIP != "192.168.8.12" {
		t.Fatalf("unified imported desired state incorrect: %+v", desired)
	}
	var history []meta.AdminCaddyHTTPSRevision
	if err := db.Find(&history).Error; err != nil || len(history) != 1 ||
		history[0].Origin != caddyImportedHostOrigin {
		t.Fatalf("imported immutable history invalid: count=%d err=%v", len(history), err)
	}
	row, exists, err := readCaddyAliDNSSettingDB(db)
	if err != nil || !exists || !row.Enabled || row.Origin != caddyImportedHostOrigin ||
		row.Revision != 1 || row.KeyVersion != 1 {
		t.Fatalf("host credential metadata not safely adopted: exists=%t err=%v", exists, err)
	}
	if strings.Contains(string(row.Ciphertext), secret) || strings.Contains(string(row.Ciphertext), keyID) {
		t.Fatal("provider credentials stored in plaintext")
	}
	plaintext, err := ring.Open(caddyAliDNSSecretAADID, caddyAliDNSSecretKind, row.KeyVersion, row.Ciphertext)
	if err != nil {
		t.Fatal("adopted ciphertext could not be opened")
	}
	var pair caddyAliDNSSecretPair
	err = json.Unmarshal(plaintext, &pair)
	clear(plaintext)
	if err != nil || pair.AccessKeyID != keyID || pair.AccessKeySecret != secret {
		t.Fatal("adopted credentials did not decrypt to original host pair")
	}
	var events []meta.AuditEvent
	if err := db.Find(&events).Error; err != nil || len(events) != 1 {
		t.Fatalf("host import must commit exactly one audit: %d %v", len(events), err)
	}
	if strings.Contains(events[0].Metadata, secret) || strings.Contains(events[0].Metadata, keyID) ||
		strings.Contains(events[0].Metadata, input.Domain) ||
		events[0].Action != "system.caddy.host_adopt" {
		t.Fatal("host import audit leaked secret or missing provenance")
	}
	// A later regular upgrade must reuse persisted administrator state even
	// if host-side legacy secrets were deliberately retired from its input.
	// No secret rotation or keyring read is needed for an already-managed row.
	replayWithoutHostSecrets := CaddyHostDeploymentImport{
		Domain: "photos.example.com", LANIP: "192.168.8.12",
	}
	if state, err := ImportCaddyHostDeployment(context.Background(), second,
		nil, replayWithoutHostSecrets); err != nil || state != "already-managed" {
		t.Fatalf("managed Caddy replay required obsolete host credentials: %s %v", state, err)
	}
	changed := input
	changed.Domain = "other.example.com"
	changed.AliDNSAccessSecret = "ExampleOtherSecret"
	if status, err := ImportCaddyHostDeployment(context.Background(), db, ring, changed); err != nil ||
		status != "already-managed" {
		t.Fatalf("replay overwrote administrator-managed Caddy: %s %v", status, err)
	}
	final, _ := readCaddyHTTPSDesiredDB(db)
	if final.Domain != desired.Domain {
		t.Fatal("re-import rewrote already adopted HTTPS identity")
	}
}

func TestCaddyHostImportLANOnlySkipsAliDNSAndNeverOverwritesManualIntent(t *testing.T) {
	db, _, ring := testCaddyHostImportDB(t)
	first := CaddyHostDeploymentImport{LANIP: "10.2.3.4"}
	state, err := ImportCaddyHostDeployment(context.Background(), db, ring, first)
	if err != nil || state != "imported-unverified" {
		t.Fatalf("LAN-only host import: %s %v", state, err)
	}
	var rows int64
	if err := db.Model(&meta.AdminServiceSecret{}).Count(&rows).Error; err != nil || rows != 0 {
		t.Fatalf("LAN-only adoption generated unnecessary credential: %d %v", rows, err)
	}
	// A later host env drift can never replace an existing administrator row.
	if _, err := ImportCaddyHostDeployment(context.Background(), db, ring,
		CaddyHostDeploymentImport{LANIP: "10.2.3.5"}); err != nil {
		t.Fatal(err)
	}
	var got meta.AdminCaddyHTTPSSetting
	if err := db.First(&got).Error; err != nil || got.LANIP != "10.2.3.4" {
		t.Fatalf("host drift rewrote desired settings: %+v %v", got, err)
	}
}

func TestCaddyHostImportMissingPendingSchemaFailsClosed(t *testing.T) {
	db, _, ring := testCaddyHostImportDB(t)
	if err := db.Migrator().DropTable(&meta.AdminCaddyHostApplyReservation{}); err != nil {
		t.Fatal(err)
	}
	_, err := ImportCaddyHostDeployment(context.Background(), db, ring,
		CaddyHostDeploymentImport{LANIP: "192.168.2.4"})
	if err == nil {
		t.Fatal("missing sticky pending schema permitted unmanaged host import")
	}
	var count int64
	if err := db.Model(&meta.AdminCaddyHTTPSSetting{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("failed import persisted desired row: %d %v", count, err)
	}
}

func TestCaddyHostImportKeepsPreviouslySavedProviderCredential(t *testing.T) {
	db, _, _ := testCaddyHostImportDB(t)
	original := meta.AdminServiceSecret{
		Name: caddyAliDNSSecretName, Revision: 5, Enabled: true,
		KeyVersion: 1, Ciphertext: []byte("fixture-existing-encrypted-credential"),
		Origin: "saved",
	}
	if err := db.Create(&original).Error; err != nil {
		t.Fatal(err)
	}
	// The administrator's encrypted key is authoritative. An adopted host
	// ingress must never overwrite/reveal it, even when host credentials are
	// absent or host-side encryption is not available.
	state, err := ImportCaddyHostDeployment(context.Background(), db, nil,
		CaddyHostDeploymentImport{Domain: "photos.example.com", LANIP: "192.168.2.4"})
	if err != nil || state != "imported-unverified" {
		t.Fatalf("existing credential prevented ingress adoption: %s %v", state, err)
	}
	var row meta.AdminServiceSecret
	if err := db.Where("name = ?", caddyAliDNSSecretName).Take(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Revision != original.Revision || row.Origin != "saved" ||
		string(row.Ciphertext) != string(original.Ciphertext) {
		t.Fatal("host adoption modified existing encrypted administrator credential")
	}
}
