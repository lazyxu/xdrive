package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/secretstore"
)

func localPushPreparedReceiptTestScope(f *heldOperationTestScope) localPushRequestKeyScope {
	return localPushRequestKeyScope{
		server: f.account.Server, account: f.account.Username, sessionID: f.account.SessionID,
		deviceID: f.proof.DeviceID, rootID: f.proof.RootID,
		rootFingerprint: f.proof.RootFingerprint,
		sourceID:        f.source.ID, revision: f.source.Revision,
		targetNodeID: *f.source.TargetNodeID,
	}
}

func localPushPreparedReceiptCandidate(f *heldOperationTestScope, operationID string) client.LocalPushPreparedOperation {
	return client.LocalPushPreparedOperation{
		SourceID: f.source.ID, Revision: f.source.Revision,
		OperationID: operationID, Generation: 1, State: "reserved",
	}
}

func TestLocalPushPreparedReceiptDurableAndScopedWithoutBackupAuthority(t *testing.T) {
	f := newHeldOperationTestScope(t)
	scope := localPushPreparedReceiptTestScope(f)
	key, err := mintLocalPushOperationRequestKey(f.configDir, scope)
	if err != nil {
		t.Fatal(err)
	}
	candidate := localPushPreparedReceiptCandidate(f, uuid.NewString())
	if err := persistLocalPushPreparedReceipt(f.configDir, scope, key, candidate); err != nil {
		t.Fatalf("cannot persist a verified reservation identity: %v", err)
	}
	got, err := loadLocalPushPreparedReceipt(f.configDir, scope, key)
	if err != nil || got.operationID != candidate.OperationID || got.generation != candidate.Generation {
		t.Fatalf("Agent restart lost exact correlation: %+v %v", got, err)
	}
	if err := persistLocalPushPreparedReceipt(f.configDir, scope, key, candidate); err != nil {
		t.Fatal("exact same reservation cannot replay safely")
	}
	public, err := json.Marshal(got)
	if err != nil || string(public) != "{}" {
		t.Fatalf("private receipt reached Renderer JSON: %s %v", public, err)
	}
	id, claim, _, err := localPushPreparedReceiptNames(f.configDir, scope)
	if err != nil {
		t.Fatal(err)
	}
	creds, err := secretstore.Load(f.configDir, id)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{f.account.Server, f.account.Username,
		f.proof.DeviceToken, f.proof.RootID, f.proof.RootFingerprint,
		string(key.bytes[:])} {
		if forbidden != "" && strings.Contains(creds.OpaquePayload, forbidden) {
			t.Fatal("receipt persisted a raw owner/Root/credential/key value")
		}
	}
	if stat, err := os.Stat(claim); err != nil || !stat.Mode().IsRegular() {
		t.Fatalf("nonsecret claim missing: %v", err)
	}
	wrongReceipt := candidate
	wrongReceipt.OperationID = uuid.NewString()
	if err := persistLocalPushPreparedReceipt(f.configDir, scope, key, wrongReceipt); err == nil {
		t.Fatal("different operation replaced still-pending correlation")
	}
	wrongReceipt = candidate
	wrongReceipt.Generation++
	if err := persistLocalPushPreparedReceipt(f.configDir, scope, key, wrongReceipt); err == nil {
		t.Fatal("different generation replaced still-pending correlation")
	}
	wrongReceipt = candidate
	wrongReceipt.State = "aborted"
	if err := persistLocalPushPreparedReceipt(f.configDir, scope, key, wrongReceipt); err == nil {
		t.Fatal("aborted observation pretended to be a prepared receipt")
	}
	for i, mutate := range []func(*localPushRequestKeyScope){
		func(s *localPushRequestKeyScope) { s.server = "https://different.test" },
		func(s *localPushRequestKeyScope) { s.account = "foreign-user" },
		func(s *localPushRequestKeyScope) { s.sessionID = "rotated-login" },
		func(s *localPushRequestKeyScope) { s.deviceID = uuid.NewString() },
		func(s *localPushRequestKeyScope) { s.rootID = uuid.NewString() },
		func(s *localPushRequestKeyScope) { s.rootFingerprint = strings.Repeat("b", 64) },
		func(s *localPushRequestKeyScope) { s.sourceID++ },
		func(s *localPushRequestKeyScope) { s.revision++ },
		func(s *localPushRequestKeyScope) { s.targetNodeID++ },
	} {
		changed := scope
		mutate(&changed)
		if result, err := loadLocalPushPreparedReceipt(f.configDir, changed, key); err == nil ||
			result != (localPushPrivatePreparedReceipt{}) {
			t.Fatalf("foreign/stale scope %d recovered a prepared operation: %+v", i, result)
		}
		if err := persistLocalPushPreparedReceipt(f.configDir, changed, key, candidate); err == nil {
			t.Fatalf("foreign/stale scope %d wrote another prepared receipt", i)
		}
	}
	wrongKey := key
	wrongKey.bytes[0] ^= 0xFF
	if _, err := loadLocalPushPreparedReceipt(f.configDir, scope, wrongKey); err == nil {
		t.Fatal("different random request key recovered a Server UUID")
	}
}

func TestLocalPushPreparedReceiptCorruptionAndOrphanFailClosed(t *testing.T) {
	t.Run("corrupted-mac", func(t *testing.T) {
		f := newHeldOperationTestScope(t)
		scope := localPushPreparedReceiptTestScope(f)
		key, err := mintLocalPushOperationRequestKey(f.configDir, scope)
		if err != nil {
			t.Fatal(err)
		}
		p := localPushPreparedReceiptCandidate(f, uuid.NewString())
		if err := persistLocalPushPreparedReceipt(f.configDir, scope, key, p); err != nil {
			t.Fatal(err)
		}
		id, _, _, err := localPushPreparedReceiptNames(f.configDir, scope)
		if err != nil {
			t.Fatal(err)
		}
		creds, err := secretstore.Load(f.configDir, id)
		if err != nil {
			t.Fatal(err)
		}
		creds.OpaquePayload = strings.Replace(creds.OpaquePayload, p.OperationID, uuid.NewString(), 1)
		if err := secretstore.Save(f.configDir, id, "tampered-test", creds); err != nil {
			t.Fatal(err)
		}
		if _, err := loadLocalPushPreparedReceipt(f.configDir, scope, key); err == nil {
			t.Fatal("tampered UUID bypassed MAC")
		}
		if err := persistLocalPushPreparedReceipt(f.configDir, scope, key, p); err == nil {
			t.Fatal("corrupt receipt was silently overwritten")
		}
	})
	t.Run("orphan-claim", func(t *testing.T) {
		f := newHeldOperationTestScope(t)
		scope := localPushPreparedReceiptTestScope(f)
		key, err := mintLocalPushOperationRequestKey(f.configDir, scope)
		if err != nil {
			t.Fatal(err)
		}
		_, claim, _, err := localPushPreparedReceiptNames(f.configDir, scope)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Dir(claim), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(claim, []byte(localPushPreparedReceiptClaimContents), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := loadLocalPushPreparedReceipt(f.configDir, scope, key); err == nil {
			t.Fatal("claim without an OS secret was accepted")
		}
		if err := persistLocalPushPreparedReceipt(f.configDir, scope, key,
			localPushPreparedReceiptCandidate(f, uuid.NewString())); err == nil {
			t.Fatal("orphan claim was replaced after ambiguous credential write")
		}
	})
	t.Run("lost-marker", func(t *testing.T) {
		f := newHeldOperationTestScope(t)
		scope := localPushPreparedReceiptTestScope(f)
		key, err := mintLocalPushOperationRequestKey(f.configDir, scope)
		if err != nil {
			t.Fatal(err)
		}
		candidate := localPushPreparedReceiptCandidate(f, uuid.NewString())
		if err := persistLocalPushPreparedReceipt(f.configDir, scope, key, candidate); err != nil {
			t.Fatal(err)
		}
		_, claim, _, err := localPushPreparedReceiptNames(f.configDir, scope)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.Remove(claim); err != nil {
			t.Fatal(err)
		}
		if _, err := loadLocalPushPreparedReceipt(f.configDir, scope, key); err == nil {
			t.Fatal("lost nonsecret marker recovered an arbitrary receipt")
		}
		if err := persistLocalPushPreparedReceipt(f.configDir, scope, key, candidate); err == nil {
			t.Fatal("surviving OS secret with lost marker was overwritten")
		}
	})
}

func TestLocalPushPreparedReceiptConcurrentDifferentUUIDExclusive(t *testing.T) {
	f := newHeldOperationTestScope(t)
	scope := localPushPreparedReceiptTestScope(f)
	key, err := mintLocalPushOperationRequestKey(f.configDir, scope)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	type result struct {
		id  string
		err error
	}
	results := make(chan result, 16)
	ids := []string{uuid.NewString(), uuid.NewString()}
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			p := localPushPreparedReceiptCandidate(f, ids[n%2])
			results <- result{id: p.OperationID, err: persistLocalPushPreparedReceipt(f.configDir, scope, key, p)}
		}(i)
	}
	wg.Wait()
	close(results)
	accepted := make(map[string]int)
	for r := range results {
		if r.err == nil {
			accepted[r.id]++
		}
	}
	if len(accepted) != 1 {
		t.Fatalf("concurrent Agent processes admitted %d different generations", len(accepted))
	}
	loaded, err := loadLocalPushPreparedReceipt(f.configDir, scope, key)
	if err != nil || accepted[loaded.operationID] == 0 {
		t.Fatalf("winner's exact UUID not durable: %+v %v", loaded, err)
	}
}

func TestHeldLocalPushPreparedWindowPersistsPrivateReceiptBeforeFinalServerRead(t *testing.T) {
	f := newHeldOperationTestScope(t)
	operationID := uuid.NewString()
	written := false
	prepare := func(_ context.Context, _, _ uint64, _ client.LocalBoundSourceProof,
		_ [32]byte,
	) (client.LocalPushPreparedOperation, error) {
		if !f.held || f.reads != 2 {
			t.Fatal("prepare escaped native held OS window")
		}
		return localPushPreparedReceiptCandidate(f, operationID), nil
	}
	observe := func(_ context.Context, _, _ uint64, _ client.LocalBoundSourceProof,
		_ string, _ uint64,
	) (client.LocalPushOperationStatus, error) {
		if !f.held || f.reads != 2 {
			t.Fatal("observe escaped native held OS window")
		}
		return sampleHeldPreparedObservation(f, operationID), nil
	}
	writer := func(dir string, scope localPushRequestKeyScope,
		key localPushPrivateRequestKey, prepared client.LocalPushPreparedOperation,
	) error {
		if !f.held || f.reads != 2 {
			t.Fatal("durable receipt written only after handle release")
		}
		if err := persistLocalPushPreparedReceipt(dir, scope, key, prepared); err != nil {
			return err
		}
		written = true
		return nil
	}
	first, err := withBoundLocalPushPreparedOperation(context.Background(), f.configDir,
		f.account, f.source.ID, f.request, true, f.session, f.bound, f.native,
		prepare, observe, writer)
	if err != nil || !written || first.OperationID != operationID || f.reads != 3 {
		t.Fatalf("prepared operation receipt was not held and durable: %+v %v", first, err)
	}
	scope := localPushPreparedReceiptTestScope(f)
	key, err := loadLocalPushOperationRequestKey(f.configDir, scope)
	if err != nil {
		t.Fatal(err)
	}
	durable, err := loadLocalPushPreparedReceipt(f.configDir, scope, key)
	if err != nil || durable.operationID != operationID || durable.generation != 1 {
		t.Fatalf("Agent restart cannot inspect exact durable UUID: %+v %v", durable, err)
	}
	f.reads = 0
	replayed, err := withBoundLocalPushPreparedOperation(context.Background(), f.configDir,
		f.account, f.source.ID, f.request, false, f.session, f.bound, f.native,
		prepare, observe, writer)
	if err != nil || replayed != first || f.reads != 3 {
		t.Fatalf("held restart retry changed durable operation: %+v %v", replayed, err)
	}
}
