package api

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestManagedJSAPI4InternalKeysRequireProtectedDatabaseAndRoot(t *testing.T) {
	if err := (&Server{}).EnsureBaiduJSAPI4InternalKeys(context.Background()); !errors.Is(err, errManagedInternalKeysUnavailable) {
		t.Fatalf("nil root/database unexpectedly initialized internal keys: %v", err)
	}
	if err := (*Server)(nil).EnsureBaiduJSAPI4InternalKeys(context.Background()); !errors.Is(err, errManagedInternalKeysUnavailable) {
		t.Fatalf("nil server initialized internal keys: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := (&Server{}).EnsureBaiduJSAPI4InternalKeys(ctx); !errors.Is(err, errManagedInternalKeysUnavailable) {
		t.Fatalf("cancelled context initialized internal keys: %v", err)
	}
}

func TestManagedJSAPI4InternalKeysTwoReplicaPersistenceAndRecovery(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL not configured")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "managed_jsapi4_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	uri, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := uri.Query()
	query.Set("search_path", schema)
	uri.RawQuery = query.Encode()

	dbA, err := gorm.Open(postgres.Open(uri.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	dbB, err := gorm.Open(postgres.Open(uri.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := dbA.AutoMigrate(&meta.AdminServiceSecret{}, &meta.InternalServiceKeyAnchor{}); err != nil {
		t.Fatal(err)
	}
	keyring, err := connectorsecret.NewKeyring(1, map[uint32]string{1: strings.Repeat("ab", 32)})
	if err != nil {
		t.Fatal(err)
	}
	serverA := &Server{DB: dbA, ConnectorSecrets: keyring, BaiduMapEnabled: true, BaiduMapAK: "static-map-kept-private"}
	serverB := &Server{DB: dbB, ConnectorSecrets: keyring}
	servers := []*Server{serverA, serverB}

	// All contenders race the SAME two PostgreSQL pools and must serialize the
	// initial three-row transaction. No second independent identity is allowed.
	const contenders = 8
	begin := make(chan struct{})
	results := make(chan error, contenders)
	var wg sync.WaitGroup
	for i := 0; i < contenders; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-begin
			results <- servers[i%len(servers)].EnsureBaiduJSAPI4InternalKeys(context.Background())
		}(i)
	}
	close(begin)
	wg.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatalf("a replica did not recover the same initialized identity: %v", err)
		}
	}
	var anchor meta.InternalServiceKeyAnchor
	if err := dbA.Where("name = ?", managedJSAPI4AnchorName).Take(&anchor).Error; err != nil {
		t.Fatal(err)
	}
	if len(anchor.Fingerprint) != sha256.Size || anchor.Revision != 1 {
		t.Fatal("invalid initial nonsecret identity fingerprint")
	}
	var keys []meta.AdminServiceSecret
	if err := dbB.Where("name IN ?", []string{managedJSAPI4SignName, managedJSAPI4CookieName}).Find(&keys).Error; err != nil {
		t.Fatal(err)
	}
	if len(keys) != 2 {
		t.Fatalf("expected exactly two encrypted service keys, got %d", len(keys))
	}
	ciphertext := make(map[string][]byte, 2)
	for _, key := range keys {
		if key.Revision != 1 || key.KeyVersion != 1 || !key.Enabled || len(key.Ciphertext) < 40 {
			t.Fatal("internal keys must be authenticated-encrypted, versioned and enabled")
		}
		ciphertext[key.Name] = append([]byte(nil), key.Ciphertext...)
	}
	var signKey meta.AdminServiceSecret
	if err := dbA.Where("name = ?", managedJSAPI4SignName).Take(&signKey).Error; err != nil {
		t.Fatal(err)
	}
	private, err := keyring.Open(managedJSAPI4SignAADID, managedJSAPI4SignKind,
		signKey.KeyVersion, signKey.Ciphertext)
	if err != nil || len(private) != ed25519.PrivateKeySize {
		t.Fatal("stored internal identity cannot be authenticated or opened")
	}
	fingerprint := sha256.Sum256(private[ed25519.SeedSize:])
	if !bytes.Equal(fingerprint[:], anchor.Fingerprint) ||
		bytes.Contains(signKey.Ciphertext, private) {
		t.Fatal("signing material was stored openly or has the wrong public fingerprint")
	}
	clear(private)

	// Simulated restart with the same protected keyring must not rewrite even
	// the randomized ciphertext, fingerprint, key versions or static map AK.
	third := &Server{DB: dbB, ConnectorSecrets: keyring}
	if err := third.EnsureBaiduJSAPI4InternalKeys(context.Background()); err != nil {
		t.Fatal(err)
	}
	for name, before := range ciphertext {
		var row meta.AdminServiceSecret
		if err := dbB.Where("name = ?", name).Take(&row).Error; err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(before, row.Ciphertext) {
			t.Fatal("restart regenerated or resealed an existing internal key")
		}
	}
	static, err := serverA.effectiveBaiduMapConfig(context.Background())
	if err != nil || static.AK != "static-map-kept-private" || !static.Enabled {
		t.Fatal("internal signing key initialization changed Static Map configuration")
	}
	if !serverA.baiduJSAPI4ManagedSignerReady() || baidumapjsapi.JSAPI4ChildInventoryComplete() {
		t.Fatal("auto-managed signing identity is missing or unreviewed resources were admitted")
	}

	// The root encryption material is externally held. A mismatch MUST NOT
	// replace an existing key with a fresh internally-valid identity.
	wrongRoot, err := connectorsecret.NewKeyring(1, map[uint32]string{1: strings.Repeat("cd", 32)})
	if err != nil {
		t.Fatal(err)
	}
	if err := (&Server{DB: dbB, ConnectorSecrets: wrongRoot}).EnsureBaiduJSAPI4InternalKeys(context.Background()); !errors.Is(err, errManagedInternalKeysUnavailable) {
		t.Fatal("lost encryption root did not fail closed")
	}
	if err := third.EnsureBaiduJSAPI4InternalKeys(context.Background()); err != nil {
		t.Fatal("original keyring stopped working after a mismatched replica")
	}

	// Independent anchor survives one missing ciphertext. Missing identity
	// pieces are recovery failures and MUST NOT trigger a new key generation.
	if err := dbB.Where("name = ?", managedJSAPI4CookieName).Delete(&meta.AdminServiceSecret{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := third.EnsureBaiduJSAPI4InternalKeys(context.Background()); !errors.Is(err, errManagedInternalKeysUnavailable) {
		t.Fatal("deleted cookie key was silently regenerated")
	}
	var stillMissing int64
	if err := dbB.Model(&meta.AdminServiceSecret{}).Where("name = ?", managedJSAPI4CookieName).Count(&stillMissing).Error; err != nil || stillMissing != 0 {
		t.Fatal("failed recovery recreated the deleted key")
	}
	if err := dbB.Where("name = ?", managedJSAPI4AnchorName).Delete(&meta.InternalServiceKeyAnchor{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := third.EnsureBaiduJSAPI4InternalKeys(context.Background()); !errors.Is(err, errManagedInternalKeysUnavailable) {
		t.Fatal("orphaned signing ciphertext was treated as a brand-new installation")
	}
}
