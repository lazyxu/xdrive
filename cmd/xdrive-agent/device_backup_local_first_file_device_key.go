package main

import (
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// This in-process key only identifies an already authorized owning Agent job;
// loading a registered device never creates an enrollment or grants a writer.
// A changed or unavailable local registration fails closed before reading a
// prior in-memory job or joining its physical upload.
func localFirstFileKeyForRegistration(
	account userconfig.Config, sourceID uint64, registered func(string, string) (string, error),
) (localPushFirstFileJobKey, error) {
	var empty localPushFirstFileJobKey
	if registered == nil || sourceID == 0 || account.SessionInvalid ||
		account.Server == "" || account.Username == "" || account.SessionID == "" {
		return empty, errLocalBackupFirstFileUnavailable
	}
	deviceID, err := registered(account.Server, account.Username)
	if err != nil || !validLocalPushRequestUUID(deviceID) {
		return empty, errLocalBackupFirstFileUnavailable
	}
	return localPushFirstFileJobKey{
		server: account.Server, account: account.Username, sessionID: account.SessionID,
		sourceID: sourceID, deviceID: deviceID,
	}, nil
}

// Read-only OS registration retrieval: no remote account fallback, no
// registration mutation, no new Stage/key, and no secret included in IPC.
func currentLocalFirstFileDeviceKey(account userconfig.Config, sourceID uint64) (localPushFirstFileJobKey, error) {
	dir, err := userconfig.Dir()
	if err != nil {
		return localPushFirstFileJobKey{}, errLocalBackupFirstFileUnavailable
	}
	return localFirstFileKeyForRegistration(account, sourceID, func(server, username string) (string, error) {
		return localpush.LoadDeviceRegistration(dir, server, username)
	})
}
