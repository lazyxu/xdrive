package main

import (
	"errors"
	"os"

	"github.com/lazyxu/xdrive/internal/secretstore"
)

// requireFreshLocalPushOperationSlot is the Agent-private, READ-ONLY
// pre-admission fence for a NEW first-file operation. It checks the durable
// per-Server/account/Device/Source slot BEFORE a native file is scanned or
// any HTTP Stage is reserved. The slot intentionally excludes mutable login,
// Root, Source revision and target, so restart or a new session cannot silently
// bypass a previous, potentially SQL-committed operation.
//
// A claim with or without a secret, an orphaned secret without a claim,
// corrupt permissions, or any unreadable credential fails CLOSED. This
// helper NEVER deletes, expires, rotates, or recovers a key. O_EXCL during
// Prepare remains the authoritative cross-process local mint fence; this
// early check only prevents unnecessary native/Server work after a restart.
func requireFreshLocalPushOperationSlot(configDir string, scope localPushRequestKeyScope) error {
	id, claim, _, err := localPushRequestKeyNames(configDir, scope)
	if err != nil {
		return errLocalPushRequestKeyUnavailable
	}
	if _, err := os.Lstat(claim); err == nil || !errors.Is(err, os.ErrNotExist) {
		return errLocalPushRequestKeyUnavailable
	}
	if _, err := secretstore.Load(configDir, id); !errors.Is(err, secretstore.ErrNotFound) {
		return errLocalPushRequestKeyUnavailable
	}
	// Detect a different Agent process that claimed the same slot while
	// SecretStore was being inspected. Prepare independently uses O_EXCL,
	// so a later race is denied without overwriting a previous key.
	if _, err := os.Lstat(claim); err == nil || !errors.Is(err, os.ErrNotExist) {
		return errLocalPushRequestKeyUnavailable
	}
	return nil
}
