//go:build linux || windows

package main

import (
	"context"
	"strconv"

	"github.com/lazyxu/xdrive/internal/localpush"
)

const localPushAutoMaxNativeWatches = 16

type localPushAutoNativeWatch struct {
	key  string
	stop func()
}

// These are bounded advisory subscriptions, not a second durable task queue.
// The owner-scoped scheduler remains responsible for authenticated admission;
// the original per-file SQL Operation remains responsible for durable writes.
type localPushAutoWatchRegistry struct {
	ctx       context.Context
	wake      chan struct{}
	ownerKey  string
	entries   map[uint64]localPushAutoNativeWatch
	startRoot func(context.Context, localpush.RootGrant, func()) (func(), error)
}

func newLocalPushAutoWatchRegistry(ctx context.Context) *localPushAutoWatchRegistry {
	return &localPushAutoWatchRegistry{
		ctx: ctx, wake: make(chan struct{}, 1),
		entries:   make(map[uint64]localPushAutoNativeWatch),
		startRoot: localpush.WatchNativeRootChanges,
	}
}

func localPushAutoOwnerKey(server, account, session string) string {
	if server == "" || account == "" || session == "" {
		return ""
	}
	return server + "\x00" + account + "\x00" +
		localpush.CommonUploadOwnerSessionDigest(session)
}

func (r *localPushAutoWatchRegistry) signal() {
	if r == nil {
		return
	}
	select {
	case r.wake <- struct{}{}:
	default:
	}
}

func (r *localPushAutoWatchRegistry) forget(sourceID uint64) {
	if r == nil {
		return
	}
	if old, exists := r.entries[sourceID]; exists {
		old.stop()
		delete(r.entries, sourceID)
	}
}

func (r *localPushAutoWatchRegistry) close() {
	if r == nil {
		return
	}
	for id := range r.entries {
		r.forget(id)
	}
	r.ownerKey = ""
}

func (r *localPushAutoWatchRegistry) setOwner(server, account, session string) {
	if r == nil {
		return
	}
	key := localPushAutoOwnerKey(server, account, session)
	if key != r.ownerKey {
		r.close()
		r.ownerKey = key
	}
}

// Dropped/revoked Sources must not retain a native watcher indefinitely.
// This list comes only from the same paginated owning Device query.
func (r *localPushAutoWatchRegistry) retainSources(sourceIDs []uint64) {
	if r == nil {
		return
	}
	existing := make(map[uint64]struct{}, len(sourceIDs))
	for _, id := range sourceIDs {
		existing[id] = struct{}{}
	}
	for id := range r.entries {
		if _, allowed := existing[id]; !allowed {
			r.forget(id)
		}
	}
}

func (r *localPushAutoWatchRegistry) observe(
	grant localpush.RootGrant, session string, revision uint64,
) {
	if r == nil || r.ctx == nil || r.ctx.Err() != nil ||
		r.ownerKey == "" || !grant.StrongIdentity || grant.SourceID == 0 ||
		revision == 0 || r.startRoot == nil ||
		localPushAutoOwnerKey(grant.Server, grant.Account, session) != r.ownerKey {
		return
	}
	// Do not store raw session secrets, tokens or OS file paths in the key.
	key := r.ownerKey + "\x00" + strconv.FormatUint(grant.SourceID, 10) +
		"\x00" + strconv.FormatUint(revision, 10) +
		"\x00" + grant.DeviceID + "\x00" + grant.RootID +
		"\x00" + grant.Fingerprint
	if old, exists := r.entries[grant.SourceID]; exists {
		if old.key == key {
			return
		}
		r.forget(grant.SourceID)
	}
	// Huge multi-Source installations fall back to the existing periodic
	// reconciler. No unchecked extra goroutine/file descriptor is admitted.
	if len(r.entries) >= localPushAutoMaxNativeWatches {
		return
	}
	stop, err := r.startRoot(r.ctx, grant, r.signal)
	if err == nil && stop != nil {
		r.entries[grant.SourceID] = localPushAutoNativeWatch{key: key, stop: stop}
	}
}
