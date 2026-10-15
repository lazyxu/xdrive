package storage

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLocalPushPinnedInspectionKeepsBothCooperativeFilesUntilCallbackCompletes(t *testing.T) {
	reader, writer, stageKey, casKey, body := makeLocalPushStageCASFixture(t)
	entered := false
	matched, err := reader.InspectMatchingLocalPushStageAndCASPinned(
		context.Background(), stageKey, casKey, int64(len(body)),
		func(context.Context) error {
			entered = true
			for _, key := range []string{stageKey, casKey} {
				ctx, cancel := context.WithTimeout(context.Background(), 170*time.Millisecond)
				var writeErr error
				if key == stageKey {
					writeErr = writer.DeleteStaging(ctx, key)
				} else {
					writeErr = writer.Delete(ctx, key)
				}
				cancel()
				if !errors.Is(writeErr, context.DeadlineExceeded) {
					t.Fatalf("cooperating deletion bypassed active pinned %s: %v", key, writeErr)
				}
			}
			return nil
		},
	)
	if err != nil || !matched || !entered {
		t.Fatalf("valid paired inspection rejected: matched=%t err=%v entered=%t", matched, err, entered)
	}
	if err := writer.DeleteStaging(context.Background(), stageKey); err != nil {
		t.Fatalf("stage pin leaked after callback: %v", err)
	}
	if err := writer.Delete(context.Background(), casKey); err != nil {
		t.Fatalf("CAS pin leaked after callback: %v", err)
	}
}

func TestLocalPushPinnedInspectionRehashesAfterCallbackAndRejectsOutOfBandMutation(t *testing.T) {
	for _, which := range []string{"stage", "cas"} {
		t.Run(which, func(t *testing.T) {
			reader, writer, stageKey, casKey, body := makeLocalPushStageCASFixture(t)
			key := stageKey
			if which == "cas" {
				key = casKey
			}
			full := filepath.Join(reader.FilesystemRoot(), filepath.FromSlash(key))
			called := false
			matched, err := reader.InspectMatchingLocalPushStageAndCASPinned(
				context.Background(), stageKey, casKey, int64(len(body)),
				func(context.Context) error {
					called = true
					return os.WriteFile(full, bytes.Repeat([]byte{'z'}, len(body)), 0o600)
				},
			)
			if matched || err == nil || !called {
				t.Fatalf("post-inspection %s corruption accepted: matched=%t err=%v called=%t", which, matched, err, called)
			}
			if err := writer.DeleteStaging(context.Background(), stageKey); err != nil {
				t.Fatalf("stage pin leaked on invalid callback: %v", err)
			}
			if err := writer.Delete(context.Background(), casKey); err != nil {
				t.Fatalf("CAS pin leaked on invalid callback: %v", err)
			}
		})
	}
}

func TestLocalPushPinnedInspectionRejectsPreexistingCorruptionBeforeCallback(t *testing.T) {
	reader, writer, stageKey, casKey, body := makeLocalPushStageCASFixture(t)
	full := filepath.Join(reader.FilesystemRoot(), filepath.FromSlash(casKey))
	if err := os.WriteFile(full, bytes.Repeat([]byte{'w'}, len(body)), 0o600); err != nil {
		t.Fatal(err)
	}
	called := false
	matched, err := reader.InspectMatchingLocalPushStageAndCASPinned(
		context.Background(), stageKey, casKey, int64(len(body)),
		func(context.Context) error { called = true; return nil },
	)
	if matched || err == nil || called {
		t.Fatalf("bad physical CAS reached private callback: matched=%t err=%v called=%t", matched, err, called)
	}
	if err := writer.DeleteStaging(context.Background(), stageKey); err != nil {
		t.Fatal(err)
	}
	if err := writer.Delete(context.Background(), casKey); err != nil {
		t.Fatal(err)
	}
}

func TestLocalPushPinnedInspectionFailsClosedForCallbackErrorCancelAndScope(t *testing.T) {
	reader, writer, stageKey, casKey, body := makeLocalPushStageCASFixture(t)
	sentinel := errors.New("read-only observer rejected")
	matched, err := reader.InspectMatchingLocalPushStageAndCASPinned(
		context.Background(), stageKey, casKey, int64(len(body)),
		func(context.Context) error { return sentinel },
	)
	if matched || !errors.Is(err, sentinel) {
		t.Fatalf("observer failure became success: matched=%t err=%v", matched, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	matched, err = reader.InspectMatchingLocalPushStageAndCASPinned(
		ctx, stageKey, casKey, int64(len(body)),
		func(context.Context) error { cancel(); return nil },
	)
	if matched || !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled observer became success: matched=%t err=%v", matched, err)
	}
	called := false
	for _, tc := range []struct {
		name  string
		stage string
		cas   string
		size  int64
	}{
		{"bad stage", "outside/stage", casKey, int64(len(body))},
		{"bad CAS", stageKey, "outside/CAS", int64(len(body))},
		{"oversize", stageKey, casKey, localPushPhysicalObservationMaxBytes + 1},
		{"negative", stageKey, casKey, -1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, gotErr := reader.InspectMatchingLocalPushStageAndCASPinned(
				context.Background(), tc.stage, tc.cas, tc.size,
				func(context.Context) error { called = true; return nil },
			)
			if got || gotErr == nil || called {
				t.Fatalf("invalid %s entered callback: matched=%t err=%v called=%t", tc.name, got, gotErr, called)
			}
		})
	}
	if got, gotErr := reader.InspectMatchingLocalPushStageAndCASPinned(
		context.Background(), stageKey, casKey, int64(len(body)), nil,
	); got || gotErr == nil {
		t.Fatalf("nil read callback admitted: matched=%t err=%v", got, gotErr)
	}
	if err := writer.DeleteStaging(context.Background(), stageKey); err != nil {
		t.Fatal(err)
	}
	if err := writer.Delete(context.Background(), casKey); err != nil {
		t.Fatal(err)
	}
}
