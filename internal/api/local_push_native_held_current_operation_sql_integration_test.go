//go:build linux || windows

package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/meta"
)

// This fixture does real native original -> owning authenticated HTTP Stage ->
// physical CAS/quota -> current SQL reservation, but never installs a normal
// production upload route or invokes any actual device backup SourceRun.
func makeHeldNativeOperationFirstLeafFixture(
	t *testing.T,
) (localNativeCanonicalFixture, []byte, meta.LocalPushOperationIntent) {
	t.Helper()
	f := makeLocalNativeCanonicalFixture(t)
	if !f.root.StrongIdentity {
		t.Skip("OS-backed strong original file identity unavailable")
	}
	f.prepareAndReserve(t)
	if err := f.server.DB.AutoMigrate(
		&meta.LocalPushOperationIntent{},
		&meta.LocalPushOperationTerminalReceipt{},
		&meta.LocalPushOperationStageBinding{},
	); err != nil {
		t.Fatal(err)
	}
	key := bytes.Repeat([]byte{0x7b}, localPushOperationRequestKeySize)
	op, err := f.server.reserveBoundLocalPushOperationIntentWithKey(
		f.request, f.source.ID, f.source.Revision, key,
	)
	if err != nil || op.ID == "" || op.Generation == 0 {
		t.Fatalf("real owning first-file reservation unavailable: %+v %v", op, err)
	}
	return f, key, op
}

func heldNativeFirstLeafCheckpoint(
	ctx context.Context, f localNativeCanonicalFixture,
	checkpoint func(context.Context, localpush.NativeHeldCurrentOriginal) error,
) (localpush.NativeHeldCurrentOriginal, error) {
	return localpush.WithHeldCurrentOriginalReadCheckpoint(
		ctx, f.configDir, f.root, f.stage.SnapshotSHA256,
		localPushFirstLeafFixtureName, f.stage.SHA256, f.stage.Size, checkpoint,
	)
}

func bindHeldNativeFirstLeafOperation(
	ctx context.Context, f localNativeCanonicalFixture, key []byte,
	op meta.LocalPushOperationIntent,
) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	f.request.Request = f.request.Request.WithContext(ctx)
	_, err := f.server.bindBoundLocalPushOperationStage(
		f.request, f.source.ID, f.source.Revision, f.sqlProof,
		f.stage.StageID, key, op.ID, op.Generation,
	)
	return err
}

func TestLocalPushRealHeldNativeOriginalAcrossBoundCASAndSQLCommit(t *testing.T) {
	f, key, op := makeHeldNativeOperationFirstLeafFixture(t)
	var first, replay localPushFirstFileCommitResult
	callbacks := 0
	held, err := heldNativeFirstLeafCheckpoint(context.Background(), f,
		func(ctx context.Context, observed localpush.NativeHeldCurrentOriginal) error {
			callbacks++
			if observed.SourceID != f.source.ID ||
				observed.DeviceID != f.device.ID ||
				observed.RootID != f.root.RootID ||
				observed.RelativePath != localPushFirstLeafFixtureName ||
				observed.PathKey != f.stage.CurrentPathKey ||
				observed.SnapshotSHA256 != f.stage.SnapshotSHA256 ||
				observed.ContentSHA256 != f.stage.SHA256 ||
				observed.Size != f.stage.Size || observed.NativeKey == "" {
				return fmt.Errorf("native held original changed from own staged bytes")
			}
			if err := bindHeldNativeFirstLeafOperation(ctx, f, key, op); err != nil {
				return err
			}
			var committed bool
			var err error
			first, committed, err = f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
				f.request, f.source.ID, f.source.Revision, f.sqlProof, f.stage.StageID,
				localPushFirstLeafFixtureName, key, op.ID, op.Generation,
			)
			if err != nil || !committed || first.Replayed ||
				first.NodeID == 0 || first.SourceItemID == 0 {
				return fmt.Errorf("private physical writer rejected native-held file: %v", err)
			}
			replay, committed, err = f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
				f.request, f.source.ID, f.source.Revision, f.sqlProof, f.stage.StageID,
				localPushFirstLeafFixtureName, key, op.ID, op.Generation,
			)
			if err != nil || !committed || !replay.Replayed ||
				replay.NodeID != first.NodeID ||
				replay.SourceItemID != first.SourceItemID {
				return fmt.Errorf("same operation replay duplicated native physical leaf: %v", err)
			}
			return ctx.Err()
		})
	if err != nil || callbacks != 1 ||
		held.ContentSHA256 != f.stage.SHA256 ||
		held.PathKey != f.stage.CurrentPathKey || held.NativeKey == "" {
		t.Fatalf("native original descriptor did not survive physical commit: %+v callbacks=%d %v",
			held, callbacks, err)
	}
	jsonBytes, marshalErr := json.Marshal(held)
	if marshalErr != nil || string(jsonBytes) != "{}" {
		t.Fatalf("native physical observation leaked to JSON: %s %v", jsonBytes, marshalErr)
	}
	var blob meta.ContentBlob
	if err := f.server.DB.Where("sha256 = ?", f.stage.SHA256).
		Take(&blob).Error; err != nil || blob.State != meta.ContentBlobStateReady ||
		blob.Size != f.stage.Size || blob.RefCount != 1 {
		t.Fatalf("one pinned physical CAS reference missing: %+v %v", blob, err)
	}
	reader, openErr := f.store.Open(context.Background(), blob.StorageKey)
	if openErr != nil {
		t.Fatal(openErr)
	}
	physical, readErr := io.ReadAll(reader)
	closeErr := reader.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(physical, f.body) {
		t.Fatalf("actual CAS bytes do not match original: %v %v", readErr, closeErr)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", first.SourceItemID).
		Take(&item).Error; err != nil ||
		item.State != meta.SourceItemStatePending ||
		item.LastSyncedAt != nil || item.LastSyncedRunID != "" {
		t.Fatalf("native in-process commit falsely completed backup: %+v %v", item, err)
	}
	var runs int64
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("private native commit invented a SourceRun: %d %v", runs, err)
	}
	var source meta.Source
	if err := f.server.DB.Where("id = ?", f.source.ID).
		Take(&source).Error; err != nil || source.Status != meta.SourceStatusPaused {
		t.Fatalf("private native commit activated local source: %+v %v", source, err)
	}
	if f.stagePUTs.Load() != 1 {
		t.Fatalf("native original uploaded more than once: PUTs=%d", f.stagePUTs.Load())
	}
}

func TestLocalPushHeldNativeOriginalRevocationBeforeSQLCommitDenies(t *testing.T) {
	f, key, op := makeHeldNativeOperationFirstLeafFixture(t)
	callbacks := 0
	_, err := heldNativeFirstLeafCheckpoint(context.Background(), f,
		func(ctx context.Context, observed localpush.NativeHeldCurrentOriginal) error {
			callbacks++
			if observed.NativeKey == "" ||
				observed.ContentSHA256 != f.stage.SHA256 {
				return fmt.Errorf("original identity unavailable")
			}
			if err := bindHeldNativeFirstLeafOperation(ctx, f, key, op); err != nil {
				return err
			}
			revoked := time.Now().UTC()
			if err := f.server.DB.Model(&meta.ClientDevice{}).
				Where("id = ?", f.device.ID).Update("revoked_at", &revoked).Error; err != nil {
				return err
			}
			_, admitted, writeErr := f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
				f.request, f.source.ID, f.source.Revision, f.sqlProof, f.stage.StageID,
				localPushFirstLeafFixtureName, key, op.ID, op.Generation,
			)
			if writeErr == nil || admitted {
				return fmt.Errorf("revoked device committed while original still held")
			}
			return writeErr
		})
	if err == nil || callbacks != 1 {
		t.Fatalf("revoked owning device was treated as a safe native commit: %v calls=%d", err, callbacks)
	}
	var items, runs, blobs int64
	if err := f.server.DB.Model(&meta.SourceItem{}).
		Where("source_id = ?", f.source.ID).Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("revoked writer published SourceItem: %d %v", items, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("revoked writer fabricated SourceRun: %d %v", runs, err)
	}
	if err := f.server.DB.Model(&meta.ContentBlob{}).
		Count(&blobs).Error; err != nil || blobs != 0 {
		t.Fatalf("revoked writer retained canonical CAS metadata: %d %v", blobs, err)
	}
}

func TestLocalPushHeldNativePostcommitMutationIsAmbiguousNotRollback(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("in-place concurrent writes to open native file are Linux-specific")
	}
	f, key, op := makeHeldNativeOperationFirstLeafFixture(t)
	var committed localPushFirstFileCommitResult
	native, err := heldNativeFirstLeafCheckpoint(context.Background(), f,
		func(ctx context.Context, original localpush.NativeHeldCurrentOriginal) error {
			if original.NativeKey == "" {
				return fmt.Errorf("missing original fd identity")
			}
			if err := bindHeldNativeFirstLeafOperation(ctx, f, key, op); err != nil {
				return err
			}
			var ok bool
			var writeErr error
			committed, ok, writeErr = f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
				f.request, f.source.ID, f.source.Revision, f.sqlProof, f.stage.StageID,
				localPushFirstLeafFixtureName, key, op.ID, op.Generation,
			)
			if writeErr != nil || !ok || committed.NodeID == 0 {
				return fmt.Errorf("physical SQL commit did not happen: %v", writeErr)
			}
			// Make the already-committed native original change WHILE its
			// descriptor is still held, after Server COMMIT. The native
			// rehash MUST deny even though the SQL/CAS transaction cannot
			// now be rolled back. Never retire the original secret key.
			changed := bytes.Clone(f.body)
			changed[len(changed)/2] ^= 0xff
			return os.WriteFile(
				filepath.Join(f.root.Path, localPushFirstLeafFixtureName),
				changed, 0o600,
			)
		})
	if err == nil || native.ContentSHA256 != "" || committed.NodeID == 0 {
		t.Fatalf("postcommit changed native file falsely accepted as backup: %+v committed=%+v err=%v",
			native, committed, err)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", committed.SourceItemID).
		Take(&item).Error; err != nil ||
		item.State != meta.SourceItemStatePending ||
		item.LastSyncedAt != nil || item.LastSyncedRunID != "" {
		t.Fatalf("postcommit ambiguity fabricated success/rollback: %+v %v", item, err)
	}
	var blob meta.ContentBlob
	if err := f.server.DB.Where("sha256 = ?", f.stage.SHA256).
		Take(&blob).Error; err != nil || blob.RefCount != 1 ||
		blob.State != meta.ContentBlobStateReady {
		t.Fatalf("physical CAS receipt was silently rolled back: %+v %v", blob, err)
	}
	var runs int64
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("postcommit native drift invented a SourceRun: %d %v", runs, err)
	}
}
