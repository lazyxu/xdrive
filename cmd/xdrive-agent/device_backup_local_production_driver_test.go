package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushrunner"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

func localPushFirstLeafDriverFixture(t *testing.T) (*localPushFirstLeafDriver, localpushrunner.Scope) {
	t.Helper()
	const device = "11111111-1111-4111-8111-111111111111"
	account := userconfig.Config{Server: "https://server.test", Username: "alice", SessionID: "login-a"}
	config := t.TempDir()
	root := t.TempDir()
	grant, err := localpush.PrepareRootGrant(account.Server, account.Username, 42, device, root)
	if err != nil {
		t.Fatal(err)
	}
	if !grant.StrongIdentity {
		t.Skip("strong native Root identity not available")
	}
	if err := localpush.SaveRootGrant(config, grant); err != nil {
		t.Fatal(err)
	}
	target := uint64(9)
	source := client.Source{ID: 42, Revision: 3, Kind: meta.SourceKindLocalFolder,
		Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
		Status: meta.SourceStatusPaused, TargetNodeID: &target}
	proof := client.LocalBoundSourceProof{DeviceID: device, DeviceToken: "native-device-secret",
		RootID: grant.RootID, RootFingerprint: grant.Fingerprint}
	scope := localpushrunner.Scope{Server: account.Server, Account: account.Username,
		SessionID: account.SessionID, DeviceID: device, RootID: grant.RootID,
		RootFingerprint: grant.Fingerprint, SourceID: 42, Revision: 3, TargetNodeID: 9,
		RelativePath: "original.jpg", ContentSHA256: strings.Repeat("a", 64), Size: 4}
	d := &localPushFirstLeafDriver{configDir: config, account: account, grant: grant,
		source: source, proof: proof, api: client.New(account.Server, "token"), scope: scope,
		requestScope: localPushRequestKeyScope{server: account.Server, account: account.Username,
			sessionID: account.SessionID, deviceID: device, rootID: grant.RootID,
			rootFingerprint: grant.Fingerprint, sourceID: 42, revision: 3, targetNodeID: 9},
		currentSession: func() (userconfig.Config, error) { return account, nil },
		readBound: func(context.Context, uint64) (client.Source, client.LocalBoundSourceProof, error) {
			return source, proof, nil
		},
	}
	return d, scope
}

func TestLocalPushFirstLeafDriverFailClosedScopeAndRoot(t *testing.T) {
	d, s := localPushFirstLeafDriverFixture(t)
	if err := d.Check(context.Background(), s); err != nil {
		t.Fatalf("genuine owning scope refused: %v", err)
	}
	for _, tc := range []struct {
		name   string
		mutate func(*localpushrunner.Scope)
	}{
		{"other-account", func(s *localpushrunner.Scope) { s.Account = "bob" }},
		{"other-server", func(s *localpushrunner.Scope) { s.Server = "https://other.test" }},
		{"other-login", func(s *localpushrunner.Scope) { s.SessionID = "login-b" }},
		{"other-device", func(s *localpushrunner.Scope) { s.DeviceID = "22222222-2222-4222-8222-222222222222" }},
		{"other-root", func(s *localpushrunner.Scope) { s.RootID = "22222222-2222-4222-8222-222222222222" }},
		{"other-target", func(s *localpushrunner.Scope) { s.TargetNodeID++ }},
		{"other-revision", func(s *localpushrunner.Scope) { s.Revision++ }},
		{"nested-not-yet-supported", func(s *localpushrunner.Scope) { s.RelativePath = "nested/original.jpg" }},
		{"new-leaf", func(s *localpushrunner.Scope) { s.RelativePath = "other.jpg" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			v := s
			tc.mutate(&v)
			if err := d.Check(context.Background(), v); !errors.Is(err, errLocalPushDriverDenied) {
				t.Fatalf("foreign scope accepted: %v", err)
			}
		})
	}
	d.currentSession = func() (userconfig.Config, error) { v := d.account; v.SessionID = "login-b"; return v, nil }
	if err := d.Check(context.Background(), s); err == nil {
		t.Fatal("session switch admitted")
	}
	d.currentSession = func() (userconfig.Config, error) { return d.account, nil }
	d.readBound = func(context.Context, uint64) (client.Source, client.LocalBoundSourceProof, error) {
		source := d.source
		source.Revision++
		return source, d.proof, nil
	}
	if err := d.Check(context.Background(), s); err == nil {
		t.Fatal("stale server revision admitted")
	}
	d.readBound = func(context.Context, uint64) (client.Source, client.LocalBoundSourceProof, error) {
		return d.source, d.proof, nil
	}
	d.source.SyncMode = meta.SourceSyncModeMirror
	if err := d.Check(context.Background(), s); err == nil {
		t.Fatal("mirror deletion scope admitted")
	}
	d.source.SyncMode = meta.SourceSyncModeBackup
	if err := localpush.RemoveRootGrant(d.configDir, d.grant.Server, d.grant.Account, d.grant.RootID); err != nil {
		t.Fatal(err)
	}
	if err := d.Check(context.Background(), s); err == nil {
		t.Fatal("revoked native Root admitted")
	}
}

func TestLocalPushFirstLeafDriverNeverInventsOperationOrCommit(t *testing.T) {
	d, s := localPushFirstLeafDriverFixture(t)
	st := localpushrunner.Staged{StageID: "33333333-3333-4333-8333-333333333333", SourceID: s.SourceID,
		Revision: s.Revision, Size: s.Size, ContentSHA256: s.ContentSHA256}
	op := localpushrunner.Operation{ID: "44444444-4444-4444-8444-444444444444", Generation: 1,
		SourceID: s.SourceID, Revision: s.Revision}
	if _, err := d.Prepare(context.Background(), s, st); err == nil {
		t.Fatal("created operation without physical staged receipt")
	}
	if _, err := loadLocalPushOperationRequestKey(d.configDir, d.requestScope); err == nil {
		t.Fatal("prematurely minted a durable native request key")
	}
	if err := d.Commit(context.Background(), s, st, op); err == nil {
		t.Fatal("committed without private prepare/bind")
	}
	if _, err := d.Reconcile(context.Background(), s, st, op); err == nil {
		t.Fatal("forged physical SQL/CAS proof")
	}
	if got, err := json.Marshal(d.key); err != nil || string(got) != "{}" {
		t.Fatalf("request key reached public JSON: %s %v", got, err)
	}
	if got, err := json.Marshal(d.prepared); err != nil || string(got) != "{}" {
		t.Fatalf("operation receipt reached public JSON: %s %v", got, err)
	}
}

func TestLocalPushFirstLeafRunnerRemainsOffPublicIPC(t *testing.T) {
	for _, v := range []string{"", ".", "..", "nested/leaf", "nested\\leaf", " spaced ",
		strings.Repeat("a", 256), "C:\\leaf", "evil\x00leaf"} {
		if localPushFirstLeafNameValid(v) {
			t.Fatalf("unsafe first leaf accepted %q", v)
		}
	}
	if !localPushFirstLeafNameValid("安全文件.jpg") {
		t.Fatal("ordinary UTF-8 basename rejected")
	}
	for _, file := range []string{"desktop_ipc.go", "desktop_ipc_device_backup_config.go"} {
		raw, err := os.ReadFile(filepath.Clean(file))
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(raw), "runLocalPushFirstLeafPrivate") {
			t.Fatalf("Agent IPC %s accidentally exposes first-file writer", file)
		}
	}
}

// Test the real Agent source contract, not an inert mock: the canonical
// writer path must never regain a READ-ONLY native checkpoint alias.
func TestFirstLeafRunnerCommitUsesExplicitNativeWriteWindow(t *testing.T) {
	source, err := os.ReadFile("device_backup_local_production_driver.go")
	if err != nil {
		t.Fatal(err)
	}
	code := string(source)
	begin := strings.Index(code, "func (d *localPushFirstLeafDriver) Commit(")
	end := strings.Index(code, "func (d *localPushFirstLeafDriver) Reconcile(")
	if begin < 0 || end <= begin {
		t.Fatal("original production Driver Commit and Reconcile boundaries unavailable")
	}
	commit := code[begin:end]
	if !strings.Contains(commit, "WithHeldCurrentOriginalFirstLeafCommitWindow(") ||
		strings.Contains(commit, "WithHeldCurrentOriginalReadCheckpoint(") {
		t.Fatal("canonical Agent HTTP writer bypasses explicit native write-window contract")
	}
}
