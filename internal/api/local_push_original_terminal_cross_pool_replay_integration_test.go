package api

import (
	"bytes"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// This test uses a synthetic native witness ONLY to seed the existing
// UNROUTED terminal writer. It proves durable read-only SQL/CAS replay
// across independent PostgreSQL pools, not a production Agent attestation.
func TestLocalPushPinnedTerminalReplayAfterOriginalPostgresPoolClosed(t *testing.T) {
	f, key, op, first := makeLocalPushCommittedHistoricalOperationFixture(t)
	var committed meta.LocalPushFirstLeafOperationCommit
	if err := f.server.DB.Where("operation_id = ?", op.ID).
		Take(&committed).Error; err != nil {
		t.Fatal(err)
	}
	witness := testLocalPushHeldNativeCommitWitness(committed)
	selector := &localPushHistoricalOperationPhysicalSelector{}
	selector.requestKey = append([]byte(nil), key...)
	selector.operationID = op.ID
	selector.generation = op.Generation
	selector.requireFileTerminalVacant = true
	if _, err := f.server.observeBoundLocalPushPhysicalCommitWithHeldNative(
		f.ctx, f.source.ID, f.source.Revision, f.proof,
		f.stage.StageID, localPushFirstLeafFixtureName, selector, witness,
	); err != nil {
		t.Fatalf("synthetic fixture could not create original terminal: %v", err)
	}

	// The fixture already isolates its schema. Open an actual independent
	// PostgreSQL connection pool against that exact schema, not NewDB() on
	// the same GORM connection pool.
	var schema string
	if err := f.server.DB.Raw("SELECT current_schema()").Scan(&schema).Error; err != nil ||
		!strings.HasPrefix(schema, "file_properties_") {
		t.Fatalf("unexpected original PostgreSQL test schema %q: %v", schema, err)
	}
	parsed, err := url.Parse(os.Getenv("XD_TEST_DATABASE_URL"))
	if err != nil || parsed == nil || parsed.Scheme == "" {
		t.Fatalf("missing PostgreSQL test URL for independent replay pool: %v", err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	replicaDB, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	replicaSQL, err := replicaDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = replicaSQL.Close() })
	restarted := &Server{DB: replicaDB, Store: f.local}

	readBack := func() (meta.LocalPushFileTerminal, error) {
		return restarted.readBoundLocalPushOriginalPhysicalTerminalPinned(
			f.ctx, f.source.ID, f.source.Revision, f.stage.StageID,
			key, op.ID, op.Generation,
		)
	}
	got, err := readBack()
	if err != nil || got.State != meta.LocalPushFileTerminalPhysicalCommit ||
		got.OperationID != op.ID || got.Generation != op.Generation ||
		got.NodeID != first.NodeID || got.SourceItemID != first.SourceItemID ||
		got.NativeWitnessSHA256 != witness.nativeWitnessSHA256 {
		t.Fatalf("independent PostgreSQL pool lost original immutable terminal: %+v %v", got, err)
	}

	// Simulate loss of the original Server's PostgreSQL connections. Its
	// read-only replica must still verify the physical Local CAS under its
	// own SQL locks, without inserting a second terminal or SourceRun.
	originalSQL, err := f.server.DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := originalSQL.Close(); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		other, err := readBack()
		if err != nil || other.OperationID != got.OperationID ||
			other.Generation != got.Generation || other.StageID != got.StageID ||
			other.NodeID != got.NodeID || other.SourceItemID != got.SourceItemID ||
			other.NativeWitnessSHA256 != got.NativeWitnessSHA256 ||
			!other.RecordedAt.Equal(got.RecordedAt) {
			t.Fatalf("restarted pool replay %d changed durable terminal: %+v %v", i, other, err)
		}
	}
	wrongKey := bytes.Clone(key)
	wrongKey[0] ^= 0x20
	if forged, err := restarted.readBoundLocalPushOriginalPhysicalTerminalPinned(
		f.ctx, f.source.ID, f.source.Revision, f.stage.StageID,
		wrongKey, op.ID, op.Generation,
	); err == nil || forged.OperationID != "" {
		t.Fatalf("restarted pool accepted wrong original request key: %+v %v", forged, err)
	}

	var count, runs int64
	if err := restarted.DB.Model(&meta.LocalPushFileTerminal{}).
		Where("source_id = ?", f.source.ID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("read-only restart duplicated or lost terminal: %d %v", count, err)
	}
	if err := restarted.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("read-only restart fabricated SourceRun: %d %v", runs, err)
	}
	var item meta.SourceItem
	if err := restarted.DB.Where("id = ?", first.SourceItemID).
		Take(&item).Error; err != nil ||
		item.State != meta.SourceItemStatePending || item.LastSyncedAt != nil {
		t.Fatalf("terminal replay falsely completed first file: %+v %v", item, err)
	}

	// Current owning Device revocation must be observed by the NEW pool,
	// despite a historical immutable positive terminal still being present.
	if err := restarted.DB.Model(&meta.ClientDevice{}).
		Where("id = ?", f.device.ID).
		Update("revoked_at", time.Now().UTC()).Error; err != nil {
		t.Fatal(err)
	}
	if revoked, err := readBack(); err == nil || revoked.OperationID != "" {
		t.Fatalf("restarted pool ignored Device revocation: %+v %v", revoked, err)
	}
	if err := restarted.DB.Model(&meta.LocalPushFileTerminal{}).
		Where("source_id = ?", f.source.ID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("revoked recovery changed terminal history: %d %v", count, err)
	}
}
