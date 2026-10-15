package storage

import (
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

func makeLocalPushStageCASFixture(t *testing.T) (reader, writer *Local, stageKey, casKey, body string) {
	t.Helper()
	root := t.TempDir()
	var err error
	reader, err = NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	writer, err = NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	body = "paired-native-local-original-bytes"
	stageKey = localPushTestStageKey()
	sum := sha256.Sum256([]byte(body))
	casKey, err = ContentAddressedKey(hex.EncodeToString(sum[:]))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Put(context.Background(), stageKey, strings.NewReader(body)); err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Put(context.Background(), casKey, strings.NewReader(body)); err != nil {
		t.Fatal(err)
	}
	return
}

func TestLocalPushStageCASPairPinsBothWritersAndClosesOnce(t *testing.T) {
	reader, writer, stageKey, casKey, body := makeLocalPushStageCASFixture(t)
	pair, acquired, err := reader.TryOpenPinnedLocalPushStageAndCAS(context.Background(), stageKey, casKey)
	if err != nil || !acquired || pair == nil {
		t.Fatalf("both canonical handles not admitted: pair=%v acquired=%t err=%v", pair, acquired, err)
	}
	defer pair.Close()
	stageInfo, casInfo, err := pair.Stat()
	if err != nil || !stageInfo.Mode().IsRegular() || !casInfo.Mode().IsRegular() ||
		stageInfo.Size() != int64(len(body)) || casInfo.Size() != int64(len(body)) {
		t.Fatalf("paired read metadata mismatch: stage=%v cas=%v err=%v", stageInfo, casInfo, err)
	}
	stageBytes, stageErr := io.ReadAll(pair.StageReader())
	casBytes, casErr := io.ReadAll(pair.CASReader())
	if stageErr != nil || casErr != nil || string(stageBytes) != body || string(casBytes) != body {
		t.Fatalf("test fixture readers differ: stage=%q cas=%q stageErr=%v casErr=%v", stageBytes, casBytes, stageErr, casErr)
	}
	for _, tc := range []struct {
		name   string
		remove func(context.Context) error
	}{
		{"stage", func(ctx context.Context) error { return writer.DeleteStaging(ctx, stageKey) }},
		{"CAS", func(ctx context.Context) error { return writer.Delete(ctx, casKey) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, stop := context.WithTimeout(context.Background(), 140*time.Millisecond)
			defer stop()
			if err := tc.remove(ctx); !errors.Is(err, context.DeadlineExceeded) {
				t.Fatalf("cooperating writer bypassed shared paired pin: %v", err)
			}
		})
	}
	if err := pair.Close(); err != nil {
		t.Fatal(err)
	}
	if err := pair.Close(); err != nil {
		t.Fatalf("paired Close must be idempotent: %v", err)
	}
	if err := writer.DeleteStaging(context.Background(), stageKey); err != nil {
		t.Fatalf("staging lease leaked after Close: %v", err)
	}
	if err := writer.Delete(context.Background(), casKey); err != nil {
		t.Fatalf("CAS lease leaked after Close: %v", err)
	}
}

func TestLocalPushStageCASPairBusyEitherShardCannotLeakFirstLease(t *testing.T) {
	reader, writer, stageKey, casKey, _ := makeLocalPushStageCASFixture(t)
	hash, ok := canonicalCASDigest(casKey)
	if !ok {
		t.Fatal("noncanonical CAS fixture")
	}
	shard, ok, err := localPushStageShard(stageKey)
	if err != nil || !ok {
		t.Fatalf("noncanonical staging fixture: %v", err)
	}

	casRelease, err := writer.casLifecycleLease(context.Background(), hash, true)
	if err != nil {
		t.Fatal(err)
	}
	ctx, stop := context.WithTimeout(context.Background(), 700*time.Millisecond)
	pair, acquired, err := reader.TryOpenPinnedLocalPushStageAndCAS(ctx, stageKey, casKey)
	if err != nil || acquired || pair != nil || ctx.Err() != nil {
		t.Fatalf("busy CAS lock admitted or blocked: pair=%v acquired=%t err=%v ctx=%v", pair, acquired, err, ctx.Err())
	}
	stop()
	casRelease()

	stageRelease, err := writer.localPushStageShardLease(context.Background(), shard, true)
	if err != nil {
		t.Fatal(err)
	}
	held := true
	defer func() {
		if held {
			stageRelease()
		}
	}()
	ctx, stop = context.WithTimeout(context.Background(), 700*time.Millisecond)
	pair, acquired, err = reader.TryOpenPinnedLocalPushStageAndCAS(ctx, stageKey, casKey)
	if err != nil || acquired || pair != nil || ctx.Err() != nil {
		t.Fatalf("busy stage lock admitted or blocked: pair=%v acquired=%t err=%v ctx=%v", pair, acquired, err, ctx.Err())
	}
	stop()

	// The CAS lease acquired first must already be released even though
	// another process is still holding the stage OS shard exclusively.
	lockCtx, stopLock := context.WithTimeout(context.Background(), 700*time.Millisecond)
	freeCAS, err := writer.casLifecycleLease(lockCtx, hash, true)
	if err != nil || lockCtx.Err() != nil {
		t.Fatalf("partial paired admission leaked CAS shard: %v ctx=%v", err, lockCtx.Err())
	}
	freeCAS()
	stopLock()
	stageRelease()
	held = false

	pair, acquired, err = reader.TryOpenPinnedLocalPushStageAndCAS(context.Background(), stageKey, casKey)
	if err != nil || !acquired || pair == nil {
		t.Fatalf("pair did not recover after contention: pair=%v acquired=%t err=%v", pair, acquired, err)
	}
	if err := pair.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestLocalPushStageCASPairInvalidMissingOrCanceledFailsClosed(t *testing.T) {
	reader, writer, stageKey, casKey, _ := makeLocalPushStageCASFixture(t)
	cases := []struct{ stage, cas string }{
		{"", casKey},
		{"../../private", casKey},
		{UploadStagingDir + "/localpush/not-uuid.part", casKey},
		{stageKey, "ordinary-upload"},
		{stageKey, casKey + "/extra"},
	}
	for _, tc := range cases {
		if p, ok, err := reader.TryOpenPinnedLocalPushStageAndCAS(context.Background(), tc.stage, tc.cas); p != nil || ok || err == nil {
			if p != nil {
				_ = p.Close()
			}
			t.Fatalf("invalid paired keys admitted: stage=%q cas=%q acquired=%t err=%v", tc.stage, tc.cas, ok, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if p, ok, err := reader.TryOpenPinnedLocalPushStageAndCAS(ctx, stageKey, casKey); p != nil || ok || !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled pair admitted: pair=%v acquired=%t err=%v", p, ok, err)
	}
	if p, ok, err := reader.TryOpenPinnedLocalPushStageAndCAS(nil, stageKey, casKey); p != nil || ok || err == nil {
		t.Fatalf("nil context admitted: pair=%v acquired=%t err=%v", p, ok, err)
	}
	if p, ok, err := reader.TryOpenPinnedLocalPushStageAndCAS(context.Background(), localPushTestStageKey(), casKey); p != nil || ok || err == nil {
		t.Fatalf("missing stage admitted: pair=%v acquired=%t err=%v", p, ok, err)
	}
	// Failed second acquisition must not leave a CAS shard pinned.
	if err := writer.Delete(context.Background(), casKey); err != nil {
		t.Fatalf("missing stage leaked canonical CAS lease: %v", err)
	}
	if p, ok, err := reader.TryOpenPinnedLocalPushStageAndCAS(context.Background(), stageKey, casKey); p != nil || ok || err == nil {
		t.Fatalf("missing CAS admitted: pair=%v acquired=%t err=%v", p, ok, err)
	}
}

func TestLocalPushStageCASPairRejectsSymlinkedCanonicalCAS(t *testing.T) {
	reader, writer, stageKey, casKey, body := makeLocalPushStageCASFixture(t)
	full := filepath.Join(reader.FilesystemRoot(), filepath.FromSlash(casKey))
	outside := filepath.Join(t.TempDir(), "untrusted-object")
	if err := os.WriteFile(outside, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(full); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, full); err != nil {
		t.Skipf("OS disallows symlink test fixture: %v", err)
	}
	if p, ok, err := reader.TryOpenPinnedLocalPushStageAndCAS(context.Background(), stageKey, casKey); p != nil || ok || err == nil {
		t.Fatalf("symlinked CAS was accepted: pair=%v acquired=%t err=%v", p, ok, err)
	}
	if err := writer.DeleteStaging(context.Background(), stageKey); err != nil {
		t.Fatalf("CAS symlink rejection leaked stage lease: %v", err)
	}
	if err := writer.Delete(context.Background(), casKey); err != nil {
		t.Fatalf("CAS symlink rejection leaked CAS lease: %v", err)
	}
}
