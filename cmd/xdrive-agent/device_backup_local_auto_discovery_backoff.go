//go:build linux || windows

package main

import "time"

const (
	localPushAutoDiscoveryBaseDelay = time.Minute
	localPushAutoDiscoveryMaxDelay  = 8 * time.Minute
)

// Only throttles owning-Agent read-only discovery after an offline or
// otherwise failed device-folder query. This is NOT a file task, SQL receipt,
// upload retry permission, SourceRun checkpoint or replacement for the
// independently fsynced per-Source admission cooldown.
type localPushAutoDiscoveryBackoff struct {
	ownerKey    string
	failures    int
	nextAttempt time.Time
}

func (b *localPushAutoDiscoveryBackoff) setOwner(key string) {
	if b == nil {
		return
	}
	if b.ownerKey != key {
		*b = localPushAutoDiscoveryBackoff{ownerKey: key}
	}
}

func (b *localPushAutoDiscoveryBackoff) ready(now time.Time) bool {
	return b != nil && !now.IsZero() &&
		(b.nextAttempt.IsZero() || !now.Before(b.nextAttempt))
}

// A successful owning-device scan clears the penalty immediately. Failure
// delays future scheduler discovery 1, 2, 4, then at most 8 minutes across
// event storms. An explicit manual backup never consults this advisory state.
func (b *localPushAutoDiscoveryBackoff) complete(now time.Time, err error) {
	if b == nil || now.IsZero() {
		return
	}
	if err == nil {
		b.failures = 0
		b.nextAttempt = time.Time{}
		return
	}
	if b.failures < 4 {
		b.failures++
	}
	delay := localPushAutoDiscoveryBaseDelay << (b.failures - 1)
	if delay > localPushAutoDiscoveryMaxDelay {
		delay = localPushAutoDiscoveryMaxDelay
	}
	b.nextAttempt = now.Add(delay)
}
