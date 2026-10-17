package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"

	"github.com/lazyxu/xdrive/internal/secretstore"
)

func localPushRequestFixture() localPushRequestKeyScope {
	return localPushRequestKeyScope{
		server: "https://server.test", account: "alice", sessionID: "session-a",
		deviceID:        "11111111-1111-4111-8111-111111111111",
		rootID:          "22222222-2222-4222-8222-222222222222",
		rootFingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		sourceID:        42, revision: 3, targetNodeID: 9,
	}
}

func TestLocalPushNativeRequestKeyDurableAndScopeIsolated(t *testing.T) {
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	dir := t.TempDir()
	scope := localPushRequestFixture()
	first, err := mintLocalPushOperationRequestKey(dir, scope)
	if err != nil || first.bytes == [32]byte{} {
		t.Fatalf("owning native mint failed: %v", err)
	}
	recovered, err := loadLocalPushOperationRequestKey(dir, scope)
	if err != nil || recovered != first {
		t.Fatalf("ambiguous retry did not reuse exact key: %v", err)
	}
	wire, err := json.Marshal(first)
	if err != nil || string(wire) != "{}" {
		t.Fatalf("private key reached JSON: %s %v", wire, err)
	}
	if _, err := mintLocalPushOperationRequestKey(dir, scope); err == nil {
		t.Fatal("second operation silently replaced pending key")
	}
	id, claim, _, err := localPushRequestKeyNames(dir, scope)
	if err != nil || id == "" {
		t.Fatal("missing private operation scope")
	}
	marker, err := os.ReadFile(claim)
	if err != nil || bytes.Contains(marker, first.bytes[:]) {
		t.Fatal("claim marker missing or stored raw secret")
	}
	if err := os.WriteFile(claim, bytes.Repeat([]byte{'x'}, len(localPushRequestClaimContents)), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadLocalPushOperationRequestKey(dir, scope); err == nil {
		t.Fatal("altered claim accepted a durable key")
	}
	if err := os.WriteFile(claim, []byte(localPushRequestClaimContents), 0o600); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(claim)
		if err != nil || info.Mode().Perm()&0o077 != 0 {
			t.Fatal("private marker permissions are too broad")
		}
	}
	changes := []func(*localPushRequestKeyScope){
		func(s *localPushRequestKeyScope) { s.sessionID = "session-b" },
		func(s *localPushRequestKeyScope) { s.revision++ },
		func(s *localPushRequestKeyScope) { s.targetNodeID++ },
		func(s *localPushRequestKeyScope) { s.rootID = "33333333-3333-4333-8333-333333333333" },
		func(s *localPushRequestKeyScope) {
			s.rootFingerprint = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
		},
		func(s *localPushRequestKeyScope) { s.account = "bob" },
		func(s *localPushRequestKeyScope) { s.server = "https://other.test" },
		func(s *localPushRequestKeyScope) { s.deviceID = "44444444-4444-4444-8444-444444444444" },
	}
	for i, change := range changes {
		other := scope
		change(&other)
		if got, err := loadLocalPushOperationRequestKey(dir, other); err == nil || got != (localPushPrivateRequestKey{}) {
			t.Fatalf("scope change %d recovered a foreign/stale request", i)
		}
	}
	// Independent Source gets its own slot, while the old one stays pending.
	otherSource := scope
	otherSource.sourceID++
	second, err := mintLocalPushOperationRequestKey(dir, otherSource)
	if err != nil || second == first {
		t.Fatalf("independent Source failed to obtain a distinct key: %v", err)
	}
}

func TestLocalPushNativeRequestKeyOrphanAndCorruptionFailClosed(t *testing.T) {
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	dir := t.TempDir()
	scope := localPushRequestFixture()
	id, claim, _, err := localPushRequestKeyNames(dir, scope)
	if err != nil {
		t.Fatal(err)
	}
	// A claim from a crashed process that never saved the credential cannot
	// be mistaken for permission to mint another key.
	if err := os.MkdirAll(filepath.Dir(claim), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(claim, []byte("crashed"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadLocalPushOperationRequestKey(dir, scope); err == nil {
		t.Fatal("orphan claim recovered a key")
	}
	if _, err := mintLocalPushOperationRequestKey(dir, scope); err == nil {
		t.Fatal("orphan claim replaced an ambiguous request")
	}
	// A missing claim does not allow overwriting an OS-held key.
	if err := secretstore.Save(dir, id, "test", secretstore.Credentials{OpaquePayload: "unrelated"}); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(claim); err != nil {
		t.Fatal(err)
	}
	if _, err := mintLocalPushOperationRequestKey(dir, scope); err == nil {
		t.Fatal("orphaned secret was overwritten")
	}
	if _, err := loadLocalPushOperationRequestKey(dir, scope); err == nil {
		t.Fatal("malformed stored request was accepted")
	}
	if err := secretstore.Delete(dir, id); err != nil {
		t.Fatal(err)
	}
	if _, err := mintLocalPushOperationRequestKey(dir, scope); err == nil {
		t.Fatal("missing secret silently cleared an existing claim")
	}
}

func TestLocalPushNativeRequestKeyConcurrentExclusive(t *testing.T) {
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	dir := t.TempDir()
	scope := localPushRequestFixture()
	var wg sync.WaitGroup
	results := make(chan error, 16)
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := mintLocalPushOperationRequestKey(dir, scope)
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	wins := 0
	for err := range results {
		if err == nil {
			wins++
		} else if !errors.Is(err, errLocalPushRequestKeyUnavailable) {
			t.Fatalf("unredacted mint failure: %v", err)
		}
	}
	if wins != 1 {
		t.Fatalf("expected one exclusive claim, got %d", wins)
	}
	if _, err := loadLocalPushOperationRequestKey(dir, scope); err != nil {
		t.Fatalf("winning request is not durable: %v", err)
	}
}

func TestLocalPushNativeRequestKeyInvalidScope(t *testing.T) {
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	dir := t.TempDir()
	invalid := []func(*localPushRequestKeyScope){
		func(s *localPushRequestKeyScope) { s.server = "" },
		func(s *localPushRequestKeyScope) { s.sessionID = "bad\nsecret" },
		func(s *localPushRequestKeyScope) { s.sourceID = 0 },
		func(s *localPushRequestKeyScope) { s.revision = 0 },
		func(s *localPushRequestKeyScope) { s.targetNodeID = 0 },
		func(s *localPushRequestKeyScope) { s.deviceID = "not-a-device" },
		func(s *localPushRequestKeyScope) { s.rootFingerprint = "not-a-fingerprint" },
	}
	for i, mutate := range invalid {
		scope := localPushRequestFixture()
		mutate(&scope)
		if _, err := mintLocalPushOperationRequestKey(dir, scope); err == nil {
			t.Fatalf("invalid scope %d created a key", i)
		}
	}
}
