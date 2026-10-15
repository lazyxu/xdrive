package storage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func localPushNewCASFixture(t *testing.T, body []byte) (reader, peer *Local, stageKey, casKey string) {
	t.Helper()
	root := t.TempDir()
	var err error
	reader, err = NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	peer, err = NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	stageKey = localPushTestStageKey()
	sum := sha256.Sum256(body)
	casKey, err = ContentAddressedKey(hex.EncodeToString(sum[:]))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := peer.Put(context.Background(), stageKey, bytes.NewReader(body)); err != nil {
		t.Fatal(err)
	}
	return
}

func assertLocalPushNewCASStage(t *testing.T, l *Local, stageKey string, original []byte) {
	t.Helper()
	file, err := l.Open(context.Background(), stageKey)
	if err != nil {
		t.Fatalf("private stage vanished: %v", err)
	}
	got, readErr := io.ReadAll(file)
	closeErr := file.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(got, original) {
		t.Fatalf("private staged bytes changed: read=%v close=%v", readErr, closeErr)
	}
}

func TestLocalPushNewCASPhysicalMaterializationKeepsStageAndReusesImmutableBytes(t *testing.T) {
	body := bytes.Repeat([]byte("native-stage-original-"), 120)
	reader, peer, stageKey, casKey := localPushNewCASFixture(t, body)
	if file, err := reader.Open(context.Background(), casKey); err == nil {
		_ = file.Close()
		t.Fatal("fixture unexpectedly has a canonical CAS object")
	}
	created, admitted, err := reader.MaterializeLocalPushStageCAS(
		context.Background(), stageKey, casKey, int64(len(body)),
	)
	if err != nil || !created || !admitted {
		t.Fatalf("new physical CAS not materialized: created=%t admitted=%t err=%v", created, admitted, err)
	}
	assertLocalPushNewCASStage(t, reader, stageKey, body)
	casFile, err := reader.Open(context.Background(), casKey)
	if err != nil {
		t.Fatal(err)
	}
	got, readErr := io.ReadAll(casFile)
	closeErr := casFile.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(got, body) {
		t.Fatalf("first physical CAS contents differ: read=%v close=%v", readErr, closeErr)
	}
	casFull := filepath.Join(reader.FilesystemRoot(), filepath.FromSlash(casKey))
	first, err := os.Lstat(casFull)
	if err != nil {
		t.Fatal(err)
	}
	created, admitted, err = peer.MaterializeLocalPushStageCAS(
		context.Background(), stageKey, casKey, int64(len(body)),
	)
	if err != nil || created || !admitted {
		t.Fatalf("existing immutable CAS was overwritten/refused: created=%t admitted=%t err=%v", created, admitted, err)
	}
	second, err := os.Lstat(casFull)
	if err != nil || !os.SameFile(first, second) {
		t.Fatalf("canonical inode was replaced on replay: err=%v", err)
	}
	dir := filepath.Dir(casFull)
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".xdrive-upload-") {
			t.Fatalf("materialization left an active temporary file: %q", e.Name())
		}
	}
	if err := peer.DeleteStaging(context.Background(), stageKey); err != nil {
		t.Fatalf("successful new CAS leaked Stage OS lock: %v", err)
	}
	if err := peer.Delete(context.Background(), casKey); err != nil {
		t.Fatalf("successful new CAS leaked canonical CAS OS lock: %v", err)
	}
}

func TestLocalPushNewCASPhysicalMaterializationRejectsCorruptStageWithoutPublication(t *testing.T) {
	body := []byte("immutable-original-content")
	reader, peer, stageKey, casKey := localPushNewCASFixture(t, body)
	bad := bytes.Repeat([]byte{0x7a}, len(body))
	if _, err := peer.Put(context.Background(), stageKey, bytes.NewReader(bad)); err != nil {
		t.Fatal(err)
	}
	created, admitted, err := reader.MaterializeLocalPushStageCAS(
		context.Background(), stageKey, casKey, int64(len(body)),
	)
	if err == nil || created || admitted {
		t.Fatalf("wrong Stage digest published CAS: created=%t admitted=%t err=%v", created, admitted, err)
	}
	if f, err := reader.Open(context.Background(), casKey); err == nil {
		_ = f.Close()
		t.Fatal("corrupt Stage created a canonical CAS object")
	}
	assertLocalPushNewCASStage(t, reader, stageKey, bad)
	if err := peer.DeleteStaging(context.Background(), stageKey); err != nil {
		t.Fatalf("rejected physical Stage leaked shard lock: %v", err)
	}
}

func TestLocalPushNewCASPhysicalMaterializationNeverRepairsCorruptCanonicalCAS(t *testing.T) {
	body := []byte("canonical-content-original")
	reader, peer, stageKey, casKey := localPushNewCASFixture(t, body)
	if _, err := peer.Put(context.Background(), casKey, bytes.NewReader(body)); err != nil {
		t.Fatal(err)
	}
	full := filepath.Join(reader.FilesystemRoot(), filepath.FromSlash(casKey))
	corrupt := bytes.Repeat([]byte{0x35}, len(body))
	if err := os.WriteFile(full, corrupt, 0o600); err != nil {
		t.Fatal(err)
	}
	created, admitted, err := reader.MaterializeLocalPushStageCAS(
		context.Background(), stageKey, casKey, int64(len(body)),
	)
	if err == nil || created || admitted {
		t.Fatalf("corrupt existing CAS silently repaired: created=%t admitted=%t err=%v", created, admitted, err)
	}
	got, err := os.ReadFile(full)
	if err != nil || !bytes.Equal(got, corrupt) {
		t.Fatalf("rejected existing CAS was modified: %v", err)
	}
	assertLocalPushNewCASStage(t, reader, stageKey, body)
	if err := peer.DeleteStaging(context.Background(), stageKey); err != nil {
		t.Fatal(err)
	}
	if err := peer.Delete(context.Background(), casKey); err != nil {
		t.Fatal(err)
	}
}

func TestLocalPushNewCASPhysicalMaterializationNonblockingCASStageAndTempLocks(t *testing.T) {
	body := []byte("nonblocking-native-stage")
	reader, peer, stageKey, casKey := localPushNewCASFixture(t, body)
	hash, ok := canonicalCASDigest(casKey)
	if !ok {
		t.Fatal("invalid fixture CAS key")
	}
	shard, managed, err := localPushStageShard(stageKey)
	if err != nil || !managed {
		t.Fatal("invalid fixture stage key")
	}
	deny := func(label string) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		defer cancel()
		created, admitted, err := reader.MaterializeLocalPushStageCAS(
			ctx, stageKey, casKey, int64(len(body)),
		)
		if err != nil || created || admitted || ctx.Err() != nil {
			t.Fatalf("%s OS contention blocked or admitted: created=%t admitted=%t err=%v ctx=%v",
				label, created, admitted, err, ctx.Err())
		}
	}
	releaseCAS, err := peer.casLifecycleLease(context.Background(), hash, true)
	if err != nil {
		t.Fatal(err)
	}
	deny("CAS")
	releaseCAS()

	releaseTemp, acquired, err := peer.TryExclusiveTempCleanup(context.Background())
	if err != nil || !acquired {
		t.Fatalf("cannot hold temp janitor lease: acquired=%t err=%v", acquired, err)
	}
	deny("temp cleanup")
	releaseTemp()

	releaseStage, err := peer.localPushStageShardLease(context.Background(), shard, true)
	if err != nil {
		t.Fatal(err)
	}
	deny("stage")
	// Failed second lock MUST release the first CAS exclusive lease.
	leaseCtx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	freeCAS, err := peer.casLifecycleLease(leaseCtx, hash, true)
	if err != nil || leaseCtx.Err() != nil {
		t.Fatalf("busy stage leaked prior CAS lock: err=%v ctx=%v", err, leaseCtx.Err())
	}
	freeCAS()
	cancel()
	releaseStage()

	created, admitted, err := reader.MaterializeLocalPushStageCAS(
		context.Background(), stageKey, casKey, int64(len(body)),
	)
	if err != nil || !created || !admitted {
		t.Fatalf("materialization did not recover after locks release: created=%t admitted=%t err=%v", created, admitted, err)
	}
	if err := peer.DeleteStaging(context.Background(), stageKey); err != nil {
		t.Fatal(err)
	}
	if err := peer.Delete(context.Background(), casKey); err != nil {
		t.Fatal(err)
	}
}

func TestLocalPushNewCASPhysicalMaterializationFailsClosedForInvalidScope(t *testing.T) {
	body := []byte("bound-original")
	reader, peer, stageKey, casKey := localPushNewCASFixture(t, body)
	for _, tc := range []struct {
		stage string
		cas   string
		size  int64
	}{
		{"", casKey, int64(len(body))},
		{"../../../escape", casKey, int64(len(body))},
		{UploadStagingDir + "/localpush/not-a-uuid.part", casKey, int64(len(body))},
		{stageKey, "other/not-CAS", int64(len(body))},
		{stageKey, casKey + "/bad", int64(len(body))},
		{stageKey, casKey, -1},
		{stageKey, casKey, localPushNewCASMaxBytes + 1},
		{stageKey, casKey, int64(len(body)) - 1},
		{stageKey, casKey, int64(len(body)) + 1},
		{localPushTestStageKey(), casKey, int64(len(body))},
	} {
		created, admitted, err := reader.MaterializeLocalPushStageCAS(
			context.Background(), tc.stage, tc.cas, tc.size,
		)
		if created || admitted || err == nil {
			t.Fatalf("invalid materialization admitted: stage=%q cas=%q size=%d created=%t admitted=%t err=%v",
				tc.stage, tc.cas, tc.size, created, admitted, err)
		}
	}
	cancelCtx, stop := context.WithCancel(context.Background())
	stop()
	if created, admitted, err := reader.MaterializeLocalPushStageCAS(
		cancelCtx, stageKey, casKey, int64(len(body)),
	); created || admitted || !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled materialization admitted: created=%t admitted=%t err=%v", created, admitted, err)
	}
	if created, admitted, err := reader.MaterializeLocalPushStageCAS(
		nil, stageKey, casKey, int64(len(body)),
	); created || admitted || err == nil {
		t.Fatalf("nil context admitted: created=%t admitted=%t err=%v", created, admitted, err)
	}
	if f, err := reader.Open(context.Background(), casKey); err == nil {
		_ = f.Close()
		t.Fatal("invalid materialization published canonical CAS bytes")
	}
	assertLocalPushNewCASStage(t, reader, stageKey, body)
	if err := peer.DeleteStaging(context.Background(), stageKey); err != nil {
		t.Fatal(err)
	}
}

func TestLocalPushNewCASPhysicalMaterializationRejectsSymlinkCAS(t *testing.T) {
	body := []byte("native-payload-for-link")
	reader, peer, stageKey, casKey := localPushNewCASFixture(t, body)
	full := filepath.Join(reader.FilesystemRoot(), filepath.FromSlash(casKey))
	if err := os.MkdirAll(filepath.Dir(full), 0o750); err != nil {
		t.Fatal(err)
	}
	external := filepath.Join(t.TempDir(), "external")
	if err := os.WriteFile(external, body, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(external, full); err != nil {
		t.Skipf("platform disallows symlink fixture: %v", err)
	}
	created, admitted, err := reader.MaterializeLocalPushStageCAS(
		context.Background(), stageKey, casKey, int64(len(body)),
	)
	if err == nil || created || admitted {
		t.Fatalf("symlink canonical CAS accepted: created=%t admitted=%t err=%v", created, admitted, err)
	}
	if externalData, err := os.ReadFile(external); err != nil || !bytes.Equal(externalData, body) {
		t.Fatal("unsafe materialization modified external symlink target")
	}
	if err := peer.DeleteStaging(context.Background(), stageKey); err != nil {
		t.Fatal(err)
	}
	if err := peer.Delete(context.Background(), casKey); err != nil {
		t.Fatal(err)
	}
}

func TestLocalPushNewCASPhysicalMaterializationZeroByteObject(t *testing.T) {
	reader, peer, stageKey, casKey := localPushNewCASFixture(t, nil)
	created, admitted, err := reader.MaterializeLocalPushStageCAS(context.Background(), stageKey, casKey, 0)
	if err != nil || !created || !admitted {
		t.Fatalf("empty file CAS not published: created=%t admitted=%t err=%v", created, admitted, err)
	}
	assertLocalPushNewCASStage(t, reader, stageKey, nil)
	if err := peer.DeleteStaging(context.Background(), stageKey); err != nil {
		t.Fatal(err)
	}
	if err := peer.Delete(context.Background(), casKey); err != nil {
		t.Fatal(err)
	}
}
