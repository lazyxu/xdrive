package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/lazyxu/xdrive/internal/secretstore"
)

// This is an Agent-private, deliberately unrouted request-key journal. It is
// NOT a Server operation, native OS handle lease or authorization to upload.
const localPushRequestKeyVersion = 1
const localPushRequestClaimContents = "xdrive-local-push-request-v1\n"

var errLocalPushRequestKeyUnavailable = errors.New("owning local backup request unavailable")

type localPushRequestKeyScope struct {
	server, account, sessionID        string
	deviceID, rootID, rootFingerprint string
	sourceID, revision, targetNodeID  uint64
}

// Unexported fields make accidental JSON serialization empty. In particular
// the request key may never be included in Agent IPC or a Renderer DTO.
type localPushPrivateRequestKey struct {
	bytes [32]byte
}

func validLocalPushRequestUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for i := 0; i < len(value); i++ {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if value[i] != '-' {
				return false
			}
			continue
		}
		if !((value[i] >= '0' && value[i] <= '9') || (value[i] >= 'a' && value[i] <= 'f')) {
			return false
		}
	}
	return true
}

func validLocalPushRequestScope(scope localPushRequestKeyScope) bool {
	for _, field := range []string{scope.server, scope.account, scope.sessionID} {
		if field == "" || strings.TrimSpace(field) != field || strings.ContainsAny(field, "\x00\r\n") || len(field) > 2048 {
			return false
		}
	}
	if scope.sourceID == 0 || scope.revision == 0 || scope.targetNodeID == 0 ||
		!validLocalPushRequestUUID(scope.deviceID) || !validLocalPushRequestUUID(scope.rootID) ||
		len(scope.rootFingerprint) != 64 {
		return false
	}
	for i := 0; i < len(scope.rootFingerprint); i++ {
		c := scope.rootFingerprint[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

// localPushStableClaimSlots is the single production derivation for both
// permanent Stage and Operation O_EXCL slots and the owning Agent restart
// observer. Login/Root/revision/target must NOT create replacement slots.
// This function is pure: it never reads keys or touches the filesystem.
func localPushStableClaimSlots(configDir, server, account, deviceID string, sourceID uint64) (string, string, string, error) {
	if !filepath.IsAbs(configDir) || filepath.Clean(configDir) != configDir ||
		sourceID == 0 || !validLocalPushRequestUUID(deviceID) {
		return "", "", "", errLocalPushRequestKeyUnavailable
	}
	for _, field := range []string{server, account} {
		if field == "" || strings.TrimSpace(field) != field ||
			strings.ContainsAny(field, "\x00\r\n") || len(field) > 2048 {
			return "", "", "", errLocalPushRequestKeyUnavailable
		}
	}
	slot := sha256.Sum256([]byte("xdrive-localpush-request-slot-v1\x00" + server + "\x00" +
		account + "\x00" + deviceID + "\x00" + strconv.FormatUint(sourceID, 10)))
	id := "local-push-request-" + hex.EncodeToString(slot[:16])
	root := filepath.Join(configDir, "localpush")
	return id, filepath.Join(root, "stage-admissions", id+".claim"),
		filepath.Join(root, "operation-requests", id+".claim"), nil
}

func localPushRequestKeyNames(configDir string, scope localPushRequestKeyScope) (string, string, string, error) {
	if !validLocalPushRequestScope(scope) {
		return "", "", "", errLocalPushRequestKeyUnavailable
	}
	id, _, claim, err := localPushStableClaimSlots(
		configDir, scope.server, scope.account, scope.deviceID, scope.sourceID)
	if err != nil {
		return "", "", "", errLocalPushRequestKeyUnavailable
	}
	identity := strings.Join([]string{
		"xdrive-localpush-request-scope-v1", scope.server, scope.account, scope.sessionID,
		scope.deviceID, scope.rootID, scope.rootFingerprint,
		strconv.FormatUint(scope.sourceID, 10), strconv.FormatUint(scope.revision, 10),
		strconv.FormatUint(scope.targetNodeID, 10),
	}, "\x00")
	digest := sha256.Sum256([]byte(identity))
	return id, claim, hex.EncodeToString(digest[:]), nil
}

func localPushRequestKeyClaimValid(path string) bool {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() ||
		(runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) ||
		info.Size() != int64(len(localPushRequestClaimContents)) {
		return false
	}
	data, err := os.ReadFile(path)
	return err == nil && string(data) == localPushRequestClaimContents
}

// mintLocalPushOperationRequestKey requires the verified owning Agent to
// serialize this operation and supply its exact current session, Root and
// Source scope. An O_EXCL nonsecret claim fences a second Agent process; a
// crash between claim creation and secret persistence fails CLOSED.
func mintLocalPushOperationRequestKey(configDir string, scope localPushRequestKeyScope) (localPushPrivateRequestKey, error) {
	var empty localPushPrivateRequestKey
	id, claim, digest, err := localPushRequestKeyNames(configDir, scope)
	if err != nil {
		return empty, errLocalPushRequestKeyUnavailable
	}
	dir := filepath.Dir(claim)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return empty, errLocalPushRequestKeyUnavailable
	}
	if info, err := os.Lstat(dir); err != nil || !info.IsDir() || (runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
		return empty, errLocalPushRequestKeyUnavailable
	}
	f, err := os.OpenFile(claim, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return empty, errLocalPushRequestKeyUnavailable
	}
	// Never delete the claim on an ambiguous failure: the key may have
	// reached Secret Service/DPAPI even if its acknowledgment was lost.
	if _, err := f.Write([]byte(localPushRequestClaimContents)); err != nil {
		_ = f.Close()
		return empty, errLocalPushRequestKeyUnavailable
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return empty, errLocalPushRequestKeyUnavailable
	}
	if err := f.Close(); err != nil {
		return empty, errLocalPushRequestKeyUnavailable
	}
	// A lost marker is NOT permission to overwrite a surviving secret.
	if _, err := secretstore.Load(configDir, id); err == nil || !errors.Is(err, secretstore.ErrNotFound) {
		return empty, errLocalPushRequestKeyUnavailable
	}
	var result localPushPrivateRequestKey
	if _, err := rand.Read(result.bytes[:]); err != nil {
		return empty, errLocalPushRequestKeyUnavailable
	}
	var nonzero byte
	for _, b := range result.bytes {
		nonzero |= b
	}
	if nonzero == 0 {
		return empty, errLocalPushRequestKeyUnavailable
	}
	payload, err := json.Marshal(map[string]any{
		"version":      localPushRequestKeyVersion,
		"scope_digest": digest,
		"request_key":  base64.RawURLEncoding.EncodeToString(result.bytes[:]),
	})
	if err != nil || secretstore.Save(configDir, id, "xDrive private local backup request", secretstore.Credentials{
		OpaquePayload: string(payload),
	}) != nil {
		return empty, errLocalPushRequestKeyUnavailable
	}
	verified, err := loadLocalPushOperationRequestKey(configDir, scope)
	if err != nil || verified != result {
		return empty, errLocalPushRequestKeyUnavailable
	}
	return result, nil
}

// loadLocalPushOperationRequestKey is exclusively for an explicit owning-Agent
// recovery. A new session, Root, revision, target, device or account must
// never reuse the old key or create an alternative key implicitly.
func loadLocalPushOperationRequestKey(configDir string, scope localPushRequestKeyScope) (localPushPrivateRequestKey, error) {
	var empty localPushPrivateRequestKey
	id, claim, digest, err := localPushRequestKeyNames(configDir, scope)
	if err != nil || !localPushRequestKeyClaimValid(claim) {
		return empty, errLocalPushRequestKeyUnavailable
	}
	creds, err := secretstore.Load(configDir, id)
	if err != nil || len(creds.OpaquePayload) > 4096 {
		return empty, errLocalPushRequestKeyUnavailable
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal([]byte(creds.OpaquePayload), &envelope); err != nil || len(envelope) != 3 {
		return empty, errLocalPushRequestKeyUnavailable
	}
	var version int
	var storedDigest, encoded string
	if json.Unmarshal(envelope["version"], &version) != nil || version != localPushRequestKeyVersion ||
		json.Unmarshal(envelope["scope_digest"], &storedDigest) != nil || storedDigest != digest ||
		json.Unmarshal(envelope["request_key"], &encoded) != nil {
		return empty, errLocalPushRequestKeyUnavailable
	}
	key, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(key) != len(empty.bytes) {
		return empty, errLocalPushRequestKeyUnavailable
	}
	var nonzero byte
	for _, b := range key {
		nonzero |= b
	}
	if nonzero == 0 {
		return empty, errLocalPushRequestKeyUnavailable
	}
	copy(empty.bytes[:], key)
	return empty, nil
}
