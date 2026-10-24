//go:build linux || windows

package main

import (
	"errors"
	"testing"
	"time"
)

func TestLocalPushAutoDiscoveryOfflineBackoffIsBoundedAndResets(t *testing.T) {
	start := time.Date(2026, 10, 24, 9, 0, 0, 0, time.UTC)
	var b localPushAutoDiscoveryBackoff
	b.setOwner("server\x00owner\x00hashed-session")
	if !b.ready(start) {
		t.Fatal("initial read-only discovery was blocked")
	}
	failure := errors.New("synthetic offline device discovery")
	now := start
	for i, delay := range []time.Duration{
		time.Minute, 2 * time.Minute, 4 * time.Minute,
		8 * time.Minute, 8 * time.Minute,
	} {
		b.complete(now, failure)
		if b.ready(now) || b.ready(now.Add(delay-time.Nanosecond)) {
			t.Fatalf("attempt %d did not honor delay %s", i, delay)
		}
		if !b.ready(now.Add(delay)) || b.nextAttempt.Sub(now) != delay {
			t.Fatalf("attempt %d exceeded bounded delay: %+v", i, b)
		}
		now = now.Add(delay)
	}
	b.complete(now, nil)
	if b.failures != 0 || !b.nextAttempt.IsZero() || !b.ready(now) {
		t.Fatalf("successful device discovery did not reset cooldown: %+v", b)
	}
	b.complete(now, failure)
	if b.nextAttempt.Sub(now) != time.Minute {
		t.Fatal("a future failure inherited an old exponential penalty")
	}
}

func TestLocalPushAutoDiscoveryOwnerRotationClearsOldOfflineCooldown(t *testing.T) {
	now := time.Date(2026, 10, 24, 10, 0, 0, 0, time.UTC)
	var b localPushAutoDiscoveryBackoff
	b.setOwner("old-owner")
	b.complete(now, errors.New("network down"))
	b.setOwner("old-owner")
	if b.ready(now) {
		t.Fatal("same owner accidentally bypassed offline delay")
	}
	b.setOwner("new-owner")
	if b.ownerKey != "new-owner" || b.failures != 0 || !b.ready(now) {
		t.Fatal("new Owner session inherited old owner's discovery penalty")
	}
	b.complete(now, errors.New("network still down"))
	b.setOwner("")
	if b.ownerKey != "" || !b.ready(now) {
		t.Fatal("logout did not clear the old owner's discovery throttle")
	}
	var missing *localPushAutoDiscoveryBackoff
	if missing.ready(now) {
		t.Fatal("nil discovery state unexpectedly granted readiness")
	}
}
