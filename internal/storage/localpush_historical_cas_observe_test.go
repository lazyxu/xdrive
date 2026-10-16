package storage

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLocalPushHistoricalCASPinnedObservationWorksAfterStageRemoved(t *testing.T) {
	reader, writer, stageKey, casKey, data := makeLocalPushStageCASFixture(t)
	if err := writer.DeleteStaging(context.Background(), stageKey); err != nil {
		t.Fatal(err)
	}
	called := false
	matched, err := reader.InspectPinnedLocalPushHistoricalCAS(
		context.Background(), casKey, int64(len(data)),
		func(context.Context) error {
			called = true
			// A second cooperating instance cannot delete this CAS while
			// the read-only receipt callback has the shared shard pinned.
			ctx, cancel := context.WithTimeout(context.Background(), 160*time.Millisecond)
			defer cancel()
			if err := writer.Delete(ctx, casKey); !errors.Is(err, context.DeadlineExceeded) {
				t.Fatalf("cooperating CAS deletion was not blocked: %v", err)
			}
			return nil
		},
	)
	if err != nil || !matched || !called {
		t.Fatalf("historical CAS inspection failed: matched=%t err=%v called=%t", matched, err, called)
	}
	if err := writer.Delete(context.Background(), casKey); err != nil {
		t.Fatalf("historical CAS pin leaked: %v", err)
	}
}

func TestLocalPushHistoricalCASPinnedObservationDetectsSameSizeMutation(t *testing.T) {
	for _, phase := range []string{"before", "after"} {
		t.Run(phase, func(t *testing.T) {
			reader, writer, stageKey, casKey, data := makeLocalPushStageCASFixture(t)
			if err := writer.DeleteStaging(context.Background(), stageKey); err != nil {
				t.Fatal(err)
			}
			full := filepath.Join(reader.FilesystemRoot(), filepath.FromSlash(casKey))
			corrupt := []byte(data)
			corrupt[len(corrupt)/2] ^= 0x20
			if phase == "before" {
				if err := os.WriteFile(full, corrupt, 0o600); err != nil {
					t.Fatal(err)
				}
			}
			called := false
			matched, err := reader.InspectPinnedLocalPushHistoricalCAS(
				context.Background(), casKey, int64(len(data)),
				func(context.Context) error {
					called = true
					if phase == "after" {
						return os.WriteFile(full, corrupt, 0o600)
					}
					return nil
				},
			)
			if matched || err == nil || called != (phase == "after") {
				t.Fatalf("corrupt %s CAS accepted: matched=%t err=%v callback=%t", phase, matched, err, called)
			}
			if err := writer.Delete(context.Background(), casKey); err != nil {
				t.Fatalf("failed observation leaked CAS shard: %v", err)
			}
		})
	}
}

func TestLocalPushHistoricalCASPinnedObservationBusyCancelAndInvalidScope(t *testing.T) {
	reader, writer, stageKey, casKey, data := makeLocalPushStageCASFixture(t)
	if err := writer.DeleteStaging(context.Background(), stageKey); err != nil {
		t.Fatal(err)
	}
	digest, ok := canonicalCASDigest(casKey)
	if !ok {
		t.Fatal("fixture CAS not canonical")
	}
	release, err := writer.casLifecycleLease(context.Background(), digest, true)
	if err != nil {
		t.Fatal(err)
	}
	called := false
	matched, err := reader.InspectPinnedLocalPushHistoricalCAS(
		context.Background(), casKey, int64(len(data)),
		func(context.Context) error { called = true; return nil },
	)
	release()
	if matched || err != nil || called {
		t.Fatalf("busy CAS shard entered callback: matched=%t err=%v called=%t", matched, err, called)
	}
	ctx, cancel := context.WithCancel(context.Background())
	matched, err = reader.InspectPinnedLocalPushHistoricalCAS(
		ctx, casKey, int64(len(data)),
		func(context.Context) error { cancel(); return nil },
	)
	if matched || !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled CAS observation accepted: matched=%t err=%v", matched, err)
	}
	sentinel := errors.New("read-only SQL rejected")
	matched, err = reader.InspectPinnedLocalPushHistoricalCAS(
		context.Background(), casKey, int64(len(data)),
		func(context.Context) error { return sentinel },
	)
	if matched || !errors.Is(err, sentinel) {
		t.Fatalf("callback error swallowed: matched=%t err=%v", matched, err)
	}
	for _, tc := range []struct {
		name string
		key  string
		size int64
	}{
		{"noncanonical", "outside/cas", int64(len(data))},
		{"too-small", casKey, int64(len(data)) - 1},
		{"too-large", casKey, int64(len(data)) + 1},
		{"negative", casKey, -1},
		{"over-bound", casKey, localPushPhysicalObservationMaxBytes + 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			entered := false
			got, gotErr := reader.InspectPinnedLocalPushHistoricalCAS(
				context.Background(), tc.key, tc.size,
				func(context.Context) error { entered = true; return nil },
			)
			if got || gotErr == nil || entered {
				t.Fatalf("invalid %s admitted: match=%t err=%v entered=%t", tc.name, got, gotErr, entered)
			}
		})
	}
	if matched, err := reader.InspectPinnedLocalPushHistoricalCAS(
		context.Background(), casKey, int64(len(data)), nil,
	); matched || err == nil {
		t.Fatalf("nil callback admitted: match=%t err=%v", matched, err)
	}
	if err := writer.Delete(context.Background(), casKey); err != nil {
		t.Fatalf("rejected CAS observation retained a shard: %v", err)
	}
}
