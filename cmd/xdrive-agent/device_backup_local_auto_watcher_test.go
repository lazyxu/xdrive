//go:build linux || windows

package main

import (
	"context"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/localpush"
)

func TestLocalPushAutoWatchRegistryOwnerIsolationAndBoundedWake(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := newLocalPushAutoWatchRegistry(ctx)
	var started, stopped int
	var send func()
	r.startRoot = func(_ context.Context, _ localpush.RootGrant, wake func()) (func(), error) {
		started++
		send = wake
		return func() { stopped++ }, nil
	}
	grant := localpush.RootGrant{
		Server: "https://private.example", Account: "owner",
		SourceID: 42, DeviceID: "device", RootID: "root",
		Fingerprint: strings.Repeat("a", 64), StrongIdentity: true,
	}
	r.setOwner(grant.Server, grant.Account, "owner-session-secret")
	r.observe(grant, "wrong-session", 7)
	if started != 0 {
		t.Fatal("foreign Owner session started a local filesystem watcher")
	}
	r.observe(grant, "owner-session-secret", 7)
	r.observe(grant, "owner-session-secret", 7)
	if started != 1 || len(r.entries) != 1 {
		t.Fatalf("same Root watcher duplicated: started=%d entries=%d", started, len(r.entries))
	}
	if strings.Contains(r.entries[42].key, "owner-session-secret") {
		t.Fatal("session secret escaped into watcher key")
	}
	for i := 0; i < 32; i++ {
		send()
	}
	if len(r.wake) != 1 {
		t.Fatal("notification storm bypassed bounded wake channel")
	}
	r.observe(grant, "owner-session-secret", 8)
	if started != 2 || stopped != 1 {
		t.Fatalf("new Source revision failed to replace watcher: started=%d stopped=%d", started, stopped)
	}
	r.retainSources([]uint64{99})
	if stopped != 2 || len(r.entries) != 0 {
		t.Fatal("removed Source retained a native watch")
	}
	r.observe(grant, "owner-session-secret", 8)
	r.setOwner(grant.Server, grant.Account, "rotated-session")
	if stopped != 3 || len(r.entries) != 0 {
		t.Fatal("rotated Owner session retained an old watch")
	}
	r.close()
	if stopped != 3 {
		t.Fatal("closing registry stopped a watch twice")
	}
	cancel()
	r.observe(grant, "rotated-session", 8)
	if started != 3 {
		t.Fatal("cancelled Agent started a watcher")
	}
}

func TestLocalPushAutoWatchOwnerKeyHasNoRawSession(t *testing.T) {
	key := localPushAutoOwnerKey("server", "owner", "do-not-persist-this-session")
	if key == "" || strings.Contains(key, "do-not-persist-this-session") {
		t.Fatalf("unsafe owner watcher scope: %q", key)
	}
	if localPushAutoOwnerKey("server", "owner", "") != "" {
		t.Fatal("missing session enabled a native watcher")
	}
}
