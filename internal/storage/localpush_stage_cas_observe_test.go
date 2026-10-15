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

func TestLocalPushPairedPhysicalObservationAcceptsExactBytesAndClosesPins(t *testing.T) {
	reader, writer, stageKey, casKey, body := makeLocalPushStageCASFixture(t)
	matched, err := reader.ObserveMatchingLocalPushStageAndCAS(
		context.Background(), stageKey, casKey, int64(len(body)),
	)
	if err != nil || !matched {
		t.Fatalf("exact private stage and CAS bytes rejected: matched=%t err=%v", matched, err)
	}
	if err := writer.DeleteStaging(context.Background(), stageKey); err != nil {
		t.Fatalf("successful observation leaked private stage lease: %v", err)
	}
	if err := writer.Delete(context.Background(), casKey); err != nil {
		t.Fatalf("successful observation leaked canonical CAS lease: %v", err)
	}
}

func TestLocalPushPairedPhysicalObservationRejectsIndependentSameSizeCorruption(t *testing.T) {
	for _, which := range []string{"stage", "cas"} {
		t.Run(which, func(t *testing.T) {
			reader, writer, stageKey, casKey, body := makeLocalPushStageCASFixture(t)
			key := stageKey
			if which == "cas" {
				key = casKey
			}
			path := filepath.Join(reader.FilesystemRoot(), filepath.FromSlash(key))
			modified := []byte(body)
			modified[len(modified)/2] ^= 0x40 // same length: metadata-only checks cannot detect
			if err := os.WriteFile(path, modified, 0o600); err != nil {
				t.Fatal(err)
			}
			matched, err := reader.ObserveMatchingLocalPushStageAndCAS(
				context.Background(), stageKey, casKey, int64(len(body)),
			)
			if matched || err == nil {
				t.Fatalf("same-size out-of-band %s corruption accepted: matched=%t err=%v", which, matched, err)
			}
			// Even a rejected observation closes both cross-process shard pins.
			if err := writer.DeleteStaging(context.Background(), stageKey); err != nil {
				t.Fatalf("stage lease leaked after %s corruption rejection: %v", which, err)
			}
			if err := writer.Delete(context.Background(), casKey); err != nil {
				t.Fatalf("CAS lease leaked after %s corruption rejection: %v", which, err)
			}
		})
	}
}

func TestLocalPushPairedPhysicalObservationRejectsWrongLengthDigestAndKeys(t *testing.T) {
	reader, writer, stageKey, casKey, body := makeLocalPushStageCASFixture(t)
	wrong := sha256.Sum256([]byte("different-original"))
	wrongKey, err := ContentAddressedKey(hex.EncodeToString(wrong[:]))
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		label string
		stage string
		cas   string
		size  int64
	}{
		{"too short", stageKey, casKey, int64(len(body)) - 1},
		{"too long", stageKey, casKey, int64(len(body)) + 1},
		{"negative", stageKey, casKey, -1},
		{"larger than one stage", stageKey, casKey, localPushPhysicalObservationMaxBytes + 1},
		{"noncanonical stage", "outside/stage", casKey, int64(len(body))},
		{"noncanonical CAS", stageKey, "outside/cas", int64(len(body))},
		{"different missing CAS", stageKey, wrongKey, int64(len(body))},
	} {
		t.Run(tc.label, func(t *testing.T) {
			matched, err := reader.ObserveMatchingLocalPushStageAndCAS(
				context.Background(), tc.stage, tc.cas, tc.size,
			)
			if matched || err == nil {
				t.Fatalf("rejected case admitted: matched=%t err=%v", matched, err)
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	matched, err := reader.ObserveMatchingLocalPushStageAndCAS(ctx, stageKey, casKey, int64(len(body)))
	if matched || !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled observer admitted: matched=%t err=%v", matched, err)
	}
	matched, err = reader.ObserveMatchingLocalPushStageAndCAS(nil, stageKey, casKey, int64(len(body)))
	if matched || err == nil {
		t.Fatalf("nil context admitted: matched=%t err=%v", matched, err)
	}
	if err := writer.DeleteStaging(context.Background(), stageKey); err != nil {
		t.Fatalf("rejected observations leaked stage lease: %v", err)
	}
	if err := writer.Delete(context.Background(), casKey); err != nil {
		t.Fatalf("rejected observations leaked CAS lease: %v", err)
	}
}

func TestLocalPushPairedPhysicalObservationRejectsPathMetadataDrift(t *testing.T) {
	reader, writer, stageKey, casKey, body := makeLocalPushStageCASFixture(t)
	pair, acquired, err := reader.TryOpenPinnedLocalPushStageAndCAS(context.Background(), stageKey, casKey)
	if err != nil || !acquired || pair == nil {
		t.Fatalf("fixture pins not admitted: acquired=%t err=%v", acquired, err)
	}
	firstStage, firstCAS, err := pair.Stat()
	if err != nil {
		t.Fatal(err)
	}
	if err := reader.checkLocalPushPinnedPhysicalIdentity(stageKey, pair.stage, firstStage, int64(len(body))); err != nil {
		t.Fatal(err)
	}
	// An external writer can bypass cooperative locks. Simulate a metadata
	// change that must invalidate this observation even when size is equal.
	path := filepath.Join(reader.FilesystemRoot(), filepath.FromSlash(stageKey))
	changed := firstStage.ModTime().Add(-2 * time.Hour)
	if err := os.Chtimes(path, changed, changed); err != nil {
		t.Fatal(err)
	}
	if err := reader.checkLocalPushPinnedPhysicalIdentity(stageKey, pair.stage, firstStage, int64(len(body))); err == nil {
		t.Fatal("out-of-band stage metadata change was accepted")
	}
	if err := reader.checkLocalPushPinnedPhysicalIdentity(casKey, pair.cas, firstCAS, int64(len(body))); err != nil {
		t.Fatalf("untouched CAS was rejected: %v", err)
	}
	if err := pair.Close(); err != nil {
		t.Fatal(err)
	}
	if err := writer.DeleteStaging(context.Background(), stageKey); err != nil {
		t.Fatal(err)
	}
	if err := writer.Delete(context.Background(), casKey); err != nil {
		t.Fatal(err)
	}
}

// A reader that cancels after the first bounded chunk proves the shared
// context-aware copier cannot promote a partially hashed file to a match.
type cancelAfterFirstLocalPushRead struct {
	stop   context.CancelFunc
	called bool
}

func (r *cancelAfterFirstLocalPushRead) Read(p []byte) (int, error) {
	if r.called {
		return 0, io.EOF
	}
	r.called = true
	for i := range p {
		p[i] = 'a'
	}
	r.stop()
	return len(p), nil
}

func TestLocalPushPairedPhysicalHashCancelsMidStream(t *testing.T) {
	ctx, stop := context.WithCancel(context.Background())
	reader := &cancelAfterFirstLocalPushRead{stop: stop}
	digest := sha256.Sum256([]byte(strings.Repeat("a", 512*1024)))
	err := hashLocalPushPinnedExact(ctx, reader, 512*1024, hex.EncodeToString(digest[:]))
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("partially-read bytes did not propagate cancellation: %v", err)
	}
}

func TestLocalPushPairedPhysicalHashRejectsExtraBytes(t *testing.T) {
	body := "expected-bytes"
	digest := sha256.Sum256([]byte(body))
	if err := hashLocalPushPinnedExact(context.Background(), strings.NewReader(body+"X"), int64(len(body)), hex.EncodeToString(digest[:])); err == nil {
		t.Fatal("extra byte accepted without bounded size enforcement")
	}
	if err := hashLocalPushPinnedExact(context.Background(), strings.NewReader(body[:len(body)-1]), int64(len(body)), hex.EncodeToString(digest[:])); err == nil {
		t.Fatal("short read accepted")
	}
}
