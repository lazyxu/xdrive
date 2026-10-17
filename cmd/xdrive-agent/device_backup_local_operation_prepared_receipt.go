package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strconv"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/secretstore"
)

const localPushPreparedReceiptVersion = 1
const localPushPreparedReceiptClaimContents = "xdrive-local-push-prepared-receipt-v1\n"

type localPushPrivatePreparedReceipt struct {
	operationID string
	generation  uint64
}

// The slot is stable for Server/account/Device/Source while the digest
// binds this record to the exact login, Root, Source revision and target.
func localPushPreparedReceiptNames(configDir string, scope localPushRequestKeyScope) (string, string, string, error) {
	id, _, digest, err := localPushRequestKeyNames(configDir, scope)
	if err != nil {
		return "", "", "", errLocalPushRequestKeyUnavailable
	}
	return id + "-prepared-receipt",
		filepath.Join(configDir, "localpush", "operation-receipts", id+".claim"),
		digest, nil
}

func localPushPreparedReceiptDigests(scopeDigest string, key localPushPrivateRequestKey, operationID string, generation uint64) (string, string) {
	requestDomain := sha256.Sum256(append([]byte("xdrive-localpush-receipt-request-v1\x00"), key.bytes[:]...))
	requestDigest := hex.EncodeToString(requestDomain[:])
	mac := hmac.New(sha256.New, key.bytes[:])
	_, _ = mac.Write([]byte("xdrive-localpush-prepared-receipt-v1\x00" +
		scopeDigest + "\x00" + operationID + "\x00" + strconv.FormatUint(generation, 10)))
	return requestDigest, hex.EncodeToString(mac.Sum(nil))
}

func localPushPrivateReceiptClaimValid(path string) bool {
	stat, err := os.Lstat(path)
	if err != nil || !stat.Mode().IsRegular() ||
		(runtime.GOOS != "windows" && stat.Mode().Perm()&0o077 != 0) ||
		stat.Size() != int64(len(localPushPreparedReceiptClaimContents)) {
		return false
	}
	contents, err := os.ReadFile(path)
	return err == nil && string(contents) == localPushPreparedReceiptClaimContents
}

// This correlation record is NOT a Server terminal receipt. Never infer a
// completed upload, release an OS handle or retire a request key from it.
func loadLocalPushPreparedReceipt(configDir string, scope localPushRequestKeyScope,
	key localPushPrivateRequestKey,
) (localPushPrivatePreparedReceipt, error) {
	var empty localPushPrivatePreparedReceipt
	id, claim, digest, err := localPushPreparedReceiptNames(configDir, scope)
	if err != nil || !localPushPrivateReceiptClaimValid(claim) {
		return empty, errLocalPushRequestKeyUnavailable
	}
	existingKey, err := loadLocalPushOperationRequestKey(configDir, scope)
	if err != nil || existingKey != key || key.bytes == [32]byte{} {
		return empty, errLocalPushRequestKeyUnavailable
	}
	creds, err := secretstore.Load(configDir, id)
	if err != nil || len(creds.OpaquePayload) == 0 || len(creds.OpaquePayload) > 2048 {
		return empty, errLocalPushRequestKeyUnavailable
	}
	var values map[string]json.RawMessage
	if err := json.Unmarshal([]byte(creds.OpaquePayload), &values); err != nil || len(values) != 6 {
		return empty, errLocalPushRequestKeyUnavailable
	}
	var version int
	var scopeSaved, keySaved, operationID, signature string
	var generation uint64
	if json.Unmarshal(values["version"], &version) != nil || version != localPushPreparedReceiptVersion ||
		json.Unmarshal(values["scope_digest"], &scopeSaved) != nil || scopeSaved != digest ||
		json.Unmarshal(values["request_digest"], &keySaved) != nil ||
		json.Unmarshal(values["operation_id"], &operationID) != nil ||
		json.Unmarshal(values["generation"], &generation) != nil ||
		json.Unmarshal(values["mac"], &signature) != nil ||
		!validLocalPushRequestUUID(operationID) || generation == 0 {
		return empty, errLocalPushRequestKeyUnavailable
	}
	expectedDigest, expectedMAC := localPushPreparedReceiptDigests(digest, key, operationID, generation)
	if subtle.ConstantTimeCompare([]byte(keySaved), []byte(expectedDigest)) != 1 ||
		subtle.ConstantTimeCompare([]byte(signature), []byte(expectedMAC)) != 1 {
		return empty, errLocalPushRequestKeyUnavailable
	}
	return localPushPrivatePreparedReceipt{operationID: operationID, generation: generation}, nil
}

// persistLocalPushPreparedReceipt is Agent-only and deliberately unrouted.
// One Source may have only ONE correlation receipt. Exclusive nonsecret
// claim creation guards concurrent Agent processes, while SecretStore keeps
// the UUID/generation and key-bound MAC in Windows DPAPI, Linux Secret
// Service or the existing 0600-only Linux fallback. An uncertain write
// leaves the claim in place and fails CLOSED; no silent overwrite or expiry.
func persistLocalPushPreparedReceipt(configDir string, scope localPushRequestKeyScope,
	key localPushPrivateRequestKey, prepared client.LocalPushPreparedOperation,
) error {
	id, claim, digest, err := localPushPreparedReceiptNames(configDir, scope)
	if err != nil || prepared.SourceID != scope.sourceID ||
		prepared.Revision != scope.revision ||
		!validLocalPushRequestUUID(prepared.OperationID) ||
		prepared.Generation == 0 || prepared.State != "reserved" {
		return errLocalPushRequestKeyUnavailable
	}
	existingKey, err := loadLocalPushOperationRequestKey(configDir, scope)
	if err != nil || existingKey != key || key.bytes == [32]byte{} {
		return errLocalPushRequestKeyUnavailable
	}
	expected := localPushPrivatePreparedReceipt{
		operationID: prepared.OperationID, generation: prepared.Generation,
	}
	dir := filepath.Dir(claim)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return errLocalPushRequestKeyUnavailable
	}
	if stat, err := os.Lstat(dir); err != nil || !stat.IsDir() ||
		(runtime.GOOS != "windows" && stat.Mode().Perm()&0o077 != 0) {
		return errLocalPushRequestKeyUnavailable
	}
	claimFile, err := os.OpenFile(claim, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		// Same exact already-persisted receipt is a safe idempotent replay.
		// Any incomplete claim, conflicting generation or bad marker denies.
		existing, loadErr := loadLocalPushPreparedReceipt(configDir, scope, key)
		if loadErr == nil && existing == expected {
			return nil
		}
		return errLocalPushRequestKeyUnavailable
	}
	// Never remove this claim if the write is uncertain: the OS credential
	// backend might have accepted a record before its ACK was lost.
	if _, err := claimFile.Write([]byte(localPushPreparedReceiptClaimContents)); err != nil {
		_ = claimFile.Close()
		return errLocalPushRequestKeyUnavailable
	}
	if err := claimFile.Sync(); err != nil {
		_ = claimFile.Close()
		return errLocalPushRequestKeyUnavailable
	}
	if err := claimFile.Close(); err != nil {
		return errLocalPushRequestKeyUnavailable
	}
	// A surviving secret without its marker is NOT permission to replace it.
	if _, err := secretstore.Load(configDir, id); err == nil || !errors.Is(err, secretstore.ErrNotFound) {
		return errLocalPushRequestKeyUnavailable
	}
	requestDigest, signature := localPushPreparedReceiptDigests(
		digest, key, prepared.OperationID, prepared.Generation)
	payload, err := json.Marshal(map[string]any{
		"version":      localPushPreparedReceiptVersion,
		"scope_digest": digest, "request_digest": requestDigest,
		"operation_id": prepared.OperationID, "generation": prepared.Generation,
		"mac": signature,
	})
	if err != nil || secretstore.Save(configDir, id, "xDrive private local backup prepared receipt",
		secretstore.Credentials{OpaquePayload: string(payload)}) != nil {
		return errLocalPushRequestKeyUnavailable
	}
	verified, err := loadLocalPushPreparedReceipt(configDir, scope, key)
	if err != nil || verified != expected {
		return errLocalPushRequestKeyUnavailable
	}
	return nil
}
