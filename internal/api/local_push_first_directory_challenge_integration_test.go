package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type localDirectoryChallengeDBFixture struct {
	primary, replica           *gorm.DB
	owner                      meta.User
	device                     meta.ClientDevice
	source                     meta.Source
	rootID, fingerprint, token string
}

// Each test has an isolated PostgreSQL schema and TWO independent pools.
// Neither native OS evidence nor authentication can be inferred from the
// database: the Gin request below only simulates the existing middleware's
// independently checked owning-Agent credential and bound Root context.
func makeLocalDirectoryChallengeDBFixture(t *testing.T) localDirectoryChallengeDBFixture {
	t.Helper()
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("real isolated PostgreSQL required")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	rootSQL, err := root.DB()
	if err != nil {
		t.Fatal(err)
	}
	rootSQL.SetMaxOpenConns(2)
	t.Cleanup(func() { _ = rootSQL.Close() })
	schema := "local_directory_chal_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	connect := func() *gorm.DB {
		t.Helper()
		db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
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
	db, replica := connect(), connect()
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.Source{},
		&meta.ClientDevice{}, &meta.LocalSourceBinding{},
		&meta.LocalPushFirstDirectoryChallenge{}, &meta.SourceItem{},
		&meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"nonce", "device_token", "native_identity_key", "relative_directory", "local_path", "hmac_tag", "raw_error"} {
		if db.Migrator().HasColumn(&meta.LocalPushFirstDirectoryChallenge{}, forbidden) {
			t.Fatalf("challenge persists forbidden private material column: %s", forbidden)
		}
	}
	var count int64
	if err := replica.Model(&meta.LocalPushFirstDirectoryChallenge{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("migration issued a challenge: %d %v", count, err)
	}
	owner := meta.User{Username: "local-challenge-owner", PasswordHash: "test-only", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	token := "durable-private-owning-device-credential-for-tests"
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "Device A", Platform: "linux",
		CredentialHash: deviceCredentialDigest(token),
		CreatedAt:      time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	target := meta.Node{OwnerID: owner.ID, Name: "Target", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&target).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: owner.ID, Name: "Device A paused", Kind: meta.SourceKindLocalFolder,
		Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
		Status: meta.SourceStatusPaused, Revision: 7, TargetNodeID: &target.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	rootID, fingerprint := uuid.NewString(), strings.Repeat("a", 64)
	if err := db.Create(&meta.LocalSourceBinding{
		SourceID: source.ID, OwnerID: owner.ID, DeviceID: device.ID,
		RootID: rootID, RootFingerprint: fingerprint,
		CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}).Error; err != nil {
		t.Fatal(err)
	}
	return localDirectoryChallengeDBFixture{
		primary: db, replica: replica, owner: owner, device: device,
		source: source, rootID: rootID, fingerprint: fingerprint, token: token,
	}
}

func (f localDirectoryChallengeDBFixture) owningRequest() *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/__private-only-first-directory-challenge", nil)
	c.Set("userID", f.owner.ID)
	c.Set(localSourceExecutorContextKey, localSourceExecutorProof{
		DeviceID: f.device.ID, RootID: f.rootID, SourceRevision: f.source.Revision,
	})
	c.Request.Header.Set("X-XDrive-Device-Token", f.token)
	c.Request.Header.Set("X-XDrive-Local-Root-Fingerprint", f.fingerprint)
	return c
}

func (f localDirectoryChallengeDBFixture) issue(t *testing.T) localpush.LocalFirstDirectoryAdvisoryChallenge {
	t.Helper()
	challenge, err := (&Server{DB: f.primary}).issueBoundLocalPushFirstDirectoryChallenge(
		f.owningRequest(), f.source.ID, f.source.Revision,
	)
	if err != nil || challenge.Nonce == ([32]byte{}) {
		t.Fatalf("owning challenge issue failed: %v", err)
	}
	return challenge
}

func (f localDirectoryChallengeDBFixture) seal(t *testing.T, challenge localpush.LocalFirstDirectoryAdvisoryChallenge) localpush.LocalFirstDirectoryAdvisorySeal {
	t.Helper()
	pathKey, err := localpush.LocalInventoryPathKey(
		localpush.RootGrant{SourceID: f.source.ID, RootID: f.rootID}, "directory", "Camera Roll",
	)
	if err != nil {
		t.Fatal(err)
	}
	observed := localpush.LocalFirstDirectoryNativeObservation{
		SourceID: f.source.ID, SourceRevision: f.source.Revision,
		DeviceID: f.device.ID, RootID: f.rootID,
		RelativeDirectory: "Camera Roll", CurrentPathKey: pathKey,
		NativeIdentityKey:      strings.Repeat("b", 64),
		PreviousSnapshotSHA256: strings.Repeat("c", 64),
		CurrentSnapshotSHA256:  strings.Repeat("d", 64),
		NativeObserved:         true,
	}
	seal, err := localpush.SealLocalFirstDirectoryAdvisoryObservation(
		context.Background(), observed, challenge, f.token, time.Now().UTC(),
	)
	if err != nil {
		t.Fatalf("private synthetic advisory seal failed: %v", err)
	}
	return seal
}

func TestLocalPushDurableFirstDirectoryChallengeAcrossPostgresReplicas(t *testing.T) {
	f := makeLocalDirectoryChallengeDBFixture(t)
	a, b := &Server{DB: f.primary}, &Server{DB: f.replica}
	challenge := f.issue(t)
	seal := f.seal(t, challenge)
	var row meta.LocalPushFirstDirectoryChallenge
	if err := f.replica.Where("source_id = ?", f.source.ID).Take(&row).Error; err != nil ||
		row.OwnerID != f.owner.ID || row.OwnerSession != f.owner.SessionVersion ||
		row.DeviceID != f.device.ID || row.RootID != f.rootID ||
		row.State != meta.LocalPushFirstDirectoryChallengeIssued || row.ConsumedAt != nil ||
		!privateFirstDirectoryChallengeMatches(row, challenge, f.owner.SessionVersion) {
		t.Fatalf("incorrect persisted private challenge scope: %v", err)
	}
	for _, payload := range []any{challenge, seal, row} {
		body, err := json.Marshal(payload)
		if err != nil || string(body) != "{}" {
			t.Fatalf("private challenge leaked through JSON: %s %v", body, err)
		}
	}
	// A second issuer cannot silently rotate an outstanding challenge.
	if _, err := b.issueBoundLocalPushFirstDirectoryChallenge(f.owningRequest(), f.source.ID, f.source.Revision); err == nil {
		t.Fatal("active challenge replaced without first being consumed or expiring")
	}
	var allowed, denied atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			server := a
			if i%2 == 1 {
				server = b
			}
			ok, err := server.consumeBoundLocalPushFirstDirectoryChallenge(f.owningRequest(), challenge, seal)
			if ok && err == nil {
				allowed.Add(1)
			} else if !ok && errors.Is(err, errLocalPushFirstDirectoryChallengeDenied) {
				denied.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if allowed.Load() != 1 || denied.Load() != 11 {
		t.Fatalf("two-pool one-time consumption was not exclusive: success=%d denied=%d", allowed.Load(), denied.Load())
	}
	if err := f.replica.Where("source_id = ?", f.source.ID).Take(&row).Error; err != nil ||
		row.State != meta.LocalPushFirstDirectoryChallengeConsumed || row.ConsumedAt == nil {
		t.Fatalf("challenge not durably consumed across pools: %+v %v", row, err)
	}
	if ok, err := a.consumeBoundLocalPushFirstDirectoryChallenge(f.owningRequest(), challenge, seal); ok || err == nil {
		t.Fatal("consumed MAC replayed")
	}
	// Explicit fresh issuance after consumption supersedes the former nonce.
	fresh, err := b.issueBoundLocalPushFirstDirectoryChallenge(f.owningRequest(), f.source.ID, f.source.Revision)
	if err != nil || fresh.Nonce == challenge.Nonce {
		t.Fatal("fresh challenge did not rotate the one-use nonce", err)
	}
	if ok, err := b.consumeBoundLocalPushFirstDirectoryChallenge(f.owningRequest(), challenge, seal); ok || err == nil {
		t.Fatal("superseded nonce retained authority")
	}
	if ok, err := a.consumeBoundLocalPushFirstDirectoryChallenge(f.owningRequest(), fresh, f.seal(t, fresh)); !ok || err != nil {
		t.Fatal("new explicit challenge not consumable", err)
	}
	var nodes, items, runs int64
	if err := f.replica.Model(&meta.Node{}).Count(&nodes).Error; err != nil || nodes != 1 {
		t.Fatalf("challenge consumed or created cloud Node: %d %v", nodes, err)
	}
	if err := f.replica.Model(&meta.SourceItem{}).Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("challenge created SourceItem: %d %v", items, err)
	}
	if err := f.replica.Model(&meta.SyncRun{}).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("challenge invented SourceRun: %d %v", runs, err)
	}
}

func TestLocalPushDurableFirstDirectoryChallengeRevocationAndDrift(t *testing.T) {
	for _, scenario := range []string{"wrong-token", "wrong-owner", "wrong-root", "tampered-tag", "tampered-nonce", "revoke-device", "source-revision", "target-moved", "owner-session", "expired-db", "cancelled"} {
		t.Run(scenario, func(t *testing.T) {
			f := makeLocalDirectoryChallengeDBFixture(t)
			challenge := f.issue(t)
			seal := f.seal(t, challenge)
			c := f.owningRequest()
			switch scenario {
			case "wrong-token":
				c.Request.Header.Set("X-XDrive-Device-Token", "foreign-token-credential-is-not-the-owner")
			case "wrong-owner":
				c.Set("userID", f.owner.ID+99)
			case "wrong-root":
				c.Request.Header.Set("X-XDrive-Local-Root-Fingerprint", strings.Repeat("e", 64))
			case "tampered-tag":
				seal.Tag[0] ^= 1
			case "tampered-nonce":
				challenge.Nonce[0] ^= 1
			case "revoke-device":
				now := time.Now().UTC()
				if err := f.primary.Model(&meta.ClientDevice{}).Where("id = ?", f.device.ID).Update("revoked_at", &now).Error; err != nil {
					t.Fatal(err)
				}
			case "source-revision":
				if err := f.primary.Model(&meta.Source{}).Where("id = ?", f.source.ID).Update("revision", 8).Error; err != nil {
					t.Fatal(err)
				}
			case "target-moved":
				other := meta.Node{OwnerID: f.owner.ID, Name: "Another Target", Type: meta.NodeTypeDir, Revision: 1}
				if err := f.primary.Create(&other).Error; err != nil {
					t.Fatal(err)
				}
				if err := f.primary.Model(&meta.Source{}).Where("id = ?", f.source.ID).Update("target_node_id", other.ID).Error; err != nil {
					t.Fatal(err)
				}
			case "owner-session":
				if err := f.primary.Model(&meta.User{}).Where("id = ?", f.owner.ID).Update("session_version", 2).Error; err != nil {
					t.Fatal(err)
				}
			case "expired-db":
				if err := f.primary.Model(&meta.LocalPushFirstDirectoryChallenge{}).
					Where("source_id = ?", f.source.ID).
					Update("expires_at", time.Now().UTC().Add(-time.Second)).Error; err != nil {
					t.Fatal(err)
				}
			case "cancelled":
				ctx, cancel := context.WithCancel(c.Request.Context())
				cancel()
				c.Request = c.Request.WithContext(ctx)
			}
			if ok, err := (&Server{DB: f.replica}).consumeBoundLocalPushFirstDirectoryChallenge(c, challenge, seal); ok || !errors.Is(err, errLocalPushFirstDirectoryChallengeDenied) {
				t.Fatalf("%s crossed private challenge fence: ok=%t err=%v", scenario, ok, err)
			}
			var row meta.LocalPushFirstDirectoryChallenge
			if err := f.primary.Where("source_id = ?", f.source.ID).Take(&row).Error; err != nil ||
				row.State != meta.LocalPushFirstDirectoryChallengeIssued || row.ConsumedAt != nil {
				t.Fatalf("%s consumed or deleted challenged state: %+v err=%v", scenario, row, err)
			}
		})
	}
}

func TestLocalPushDurableFirstDirectoryChallengeFailClosedInputs(t *testing.T) {
	var empty localpush.LocalFirstDirectoryAdvisoryChallenge
	if _, err := (&Server{}).issueBoundLocalPushFirstDirectoryChallenge(nil, 1, 1); err == nil {
		t.Fatal("nil Gin context authorized issue")
	}
	if ok, err := (&Server{}).consumeBoundLocalPushFirstDirectoryChallenge(nil, empty, localpush.LocalFirstDirectoryAdvisorySeal{}); ok || err == nil {
		t.Fatal("nil Gin context consumed a challenge")
	}
}
