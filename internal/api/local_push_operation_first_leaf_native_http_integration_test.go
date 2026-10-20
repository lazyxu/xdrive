//go:build linux || windows

package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/meta"
)

// REAL owning native file -> enrolled-Agent authenticated HTTP Stage ->
// physically prepared canonical CAS -> immutable keyed Operation/Stage ->
// PostgreSQL Node/File/PENDING SourceItem. The operation's native fd remains
// open across the HTTP COMMIT and is independently rehashed afterwards.
// Neither the HTTP receipt nor this ephemeral descriptor is a completed Run.
func TestLocalPushRealNativeHeldAgentHTTPFirstLeafCanonicalCommit(t *testing.T) {
	f := makeLocalNativeCanonicalFixture(t)
	if !f.root.StrongIdentity {
		t.Skip("native original strong file identity unavailable on this installation")
	}
	if err := f.server.DB.AutoMigrate(
		&meta.LocalPushOperationIntent{},
		&meta.LocalPushOperationTerminalReceipt{},
		&meta.LocalPushOperationStageBinding{},
		&meta.LocalPushFirstLeafOperationCommit{}, &meta.LocalPushFileTerminal{},
	); err != nil {
		t.Fatal(err)
	}
	key := bytes.Repeat([]byte{0x5a}, localPushOperationRequestKeySize)
	op, err := f.server.reserveBoundLocalPushOperationIntentWithKey(
		f.request, f.source.ID, f.source.Revision, key,
	)
	if err != nil || op.ID == "" || op.Generation == 0 {
		t.Fatalf("native HTTP first-leaf operation not admitted: %+v %v", op, err)
	}
	var beforeCAS, beforeHolds, beforeBindings int64
	for _, row := range []struct {
		model any
		count *int64
	}{
		{&meta.ContentBlob{}, &beforeCAS},
		{&meta.LocalPushQuotaHold{}, &beforeHolds},
		{&meta.LocalPushOperationStageBinding{}, &beforeBindings},
	} {
		if err := f.server.DB.Model(row.model).Count(row.count).Error; err != nil || *row.count != 0 {
			t.Fatalf("test is not starting from native-only temporary Stage: %d %v", *row.count, err)
		}
	}
	var originalKey [32]byte
	copy(originalKey[:], key)
	var first, replay client.LocalPushFirstLeafCanonicalReceipt
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	held, err := localpush.WithHeldCurrentOriginalReadCheckpoint(
		ctx, f.configDir, f.root, f.stage.SnapshotSHA256,
		localPushFirstLeafFixtureName, f.stage.SHA256, f.stage.Size,
		func(checkCtx context.Context, original localpush.NativeHeldCurrentOriginal) error {
			if original.SourceID != f.source.ID || original.DeviceID != f.device.ID ||
				original.RootID != f.root.RootID ||
				original.RelativePath != localPushFirstLeafFixtureName ||
				original.PathKey != f.stage.CurrentPathKey ||
				original.SnapshotSHA256 != f.stage.SnapshotSHA256 ||
				original.ContentSHA256 != f.stage.SHA256 ||
				original.Size != f.stage.Size || original.NativeKey == "" {
				return fmt.Errorf("native original did not match current sealed inventory")
			}
			var writeErr error
			first, writeErr = f.nativeClient.CommitLocalPushFirstLeafWithOperation(
				checkCtx, f.source.ID, f.source.Revision, f.nativeProof,
				f.stage.StageID, localPushFirstLeafFixtureName, originalKey,
				op.ID, op.Generation,
			)
			return writeErr
		},
	)
	if err != nil || held.NativeKey == "" || held.ContentSHA256 != f.stage.SHA256 ||
		first.NodeID == 0 || first.SourceItemID == 0 || first.Replayed {
		t.Fatalf("real held-native HTTP physical CAS/SQL commit failed: %+v %+v %v", held, first, err)
	}
	// The SAME private request key can retry the same immutable SQL commit
	// while the original reservation is live. No repeat Stage upload or CAS
	// object reference may be created.
	_, err = localpush.WithHeldCurrentOriginalReadCheckpoint(
		ctx, f.configDir, f.root, f.stage.SnapshotSHA256,
		localPushFirstLeafFixtureName, f.stage.SHA256, f.stage.Size,
		func(checkCtx context.Context, original localpush.NativeHeldCurrentOriginal) error {
			if original.NativeKey == "" || original.ContentSHA256 != f.stage.SHA256 {
				return fmt.Errorf("native file changed during idempotent retry")
			}
			var writeErr error
			replay, writeErr = f.nativeClient.CommitLocalPushFirstLeafWithOperation(
				checkCtx, f.source.ID, f.source.Revision, f.nativeProof,
				f.stage.StageID, localPushFirstLeafFixtureName, originalKey,
				op.ID, op.Generation,
			)
			return writeErr
		},
	)
	if err != nil || !replay.Replayed || replay.NodeID != first.NodeID ||
		replay.SourceItemID != first.SourceItemID || f.stagePUTs.Load() != 1 {
		t.Fatalf("real native HTTP replay duplicated stage/canonical file: %+v %v", replay, err)
	}
	var outcome meta.LocalPushFirstLeafOperationCommit
	if err := f.server.DB.Where("operation_id = ?", op.ID).Take(&outcome).Error; err != nil ||
		outcome.NodeID != first.NodeID || outcome.SourceItemID != first.SourceItemID ||
		outcome.StageID != f.stage.StageID {
		t.Fatalf("missing exactly keyed immutable commit after HTTP: %+v %v", outcome, err)
	}
	var blob meta.ContentBlob
	if err := f.server.DB.Where("sha256 = ?", f.stage.SHA256).Take(&blob).Error; err != nil ||
		blob.State != meta.ContentBlobStateReady || blob.Size != int64(len(f.body)) ||
		blob.RefCount != 1 {
		t.Fatalf("real native bytes not physically canonical: %+v %v", blob, err)
	}
	r, err := f.store.Open(ctx, blob.StorageKey)
	if err != nil {
		t.Fatal(err)
	}
	raw, readErr := io.ReadAll(r)
	closeErr := r.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(raw, f.body) {
		t.Fatalf("canonical CAS differs from pinned native original: %v %v", readErr, closeErr)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", first.SourceItemID).Take(&item).Error; err != nil ||
		item.State != meta.SourceItemStatePending ||
		item.LastSyncedAt != nil || item.LastSyncedRunID != "" {
		t.Fatalf("native held commit falsely marked SourceItem synced: %+v %v", item, err)
	}
	var runs int64
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("native first-file upload invented backup SourceRun: %d %v", runs, err)
	}
	var source meta.Source
	if err := f.server.DB.Where("id = ?", f.source.ID).Take(&source).Error; err != nil ||
		source.Status != meta.SourceStatusPaused {
		t.Fatalf("single-file HTTP prototype activated local backup Source: %+v %v", source, err)
	}
	wire, marshalErr := json.Marshal(first)
	if marshalErr != nil || string(wire) != "{}" {
		t.Fatalf("private canonical receipt leaked into JSON: %s %v", wire, marshalErr)
	}
}
