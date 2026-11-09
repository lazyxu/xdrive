package synologyui

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type OwnerClipboardAgent interface {
	OwnerClipboardVault(context.Context) (client.ClipboardVault, error)
	OwnerClipboardCheck(context.Context, client.ClipboardCheck) (client.ClipboardVault, error)
	OwnerClipboardList(context.Context, uint64) (client.ClipboardPage, error)
	OwnerClipboardCreate(context.Context, client.ClipboardWrite) (client.ClipboardItem, error)
	OwnerClipboardDelete(context.Context, uint64) error
	OwnerClipboardClear(context.Context) error
}

func isDSMClipboardRoute(path string) bool {
	switch path {
	case "/v1/cloud-clipboard-capability", "/v1/cloud-clipboard-vault",
		"/v1/cloud-clipboard-check", "/v1/cloud-clipboard-list",
		"/v1/cloud-clipboard-devices", "/v1/cloud-clipboard-enable-device",
		"/v1/cloud-clipboard-decrypt", "/v1/cloud-clipboard-create", "/v1/cloud-clipboard-delete",
		"/v1/cloud-clipboard-clear", "/v1/cloud-clipboard-revoke-device":
		return true
	}
	return false
}
func isDSMClipboardWrite(path string) bool {
	switch path {
	case "/v1/cloud-clipboard-check", "/v1/cloud-clipboard-create",
		"/v1/cloud-clipboard-delete", "/v1/cloud-clipboard-clear",
		"/v1/cloud-clipboard-enable-device", "/v1/cloud-clipboard-decrypt",
		"/v1/cloud-clipboard-revoke-device":
		return true
	}
	return false
}

const dsmClipboardBodyMax = 128 << 10

type dsmClipboardWrite struct {
	OwnerScope     string `json:"owner_scope"`
	Nonce          string `json:"nonce,omitempty"`
	Ciphertext     string `json:"ciphertext,omitempty"`
	Scope          string `json:"scope,omitempty"`
	ClientEventID  string `json:"client_event_id,omitempty"`
	Kind           string `json:"kind,omitempty"`
	TargetDeviceID string `json:"target_device_id,omitempty"`
	DeviceID       string `json:"device_id,omitempty"`
	EphemeralKey   string `json:"ephemeral_key,omitempty"`
	WrappedKey     string `json:"wrapped_key,omitempty"`
	NodeID         uint64 `json:"node_id,omitempty"`
	ID             uint64 `json:"id,omitempty"`
}

// DSM must not forward an arbitrary binary envelope from a CGI request.
// The canonical xDrive Server and Agent re-check the same E2EE metadata.
func dsmClipboardKeyExact(raw string, bytes int) bool {
	value, err := base64.StdEncoding.Strict().DecodeString(raw)
	return err == nil && len(value) == bytes &&
		base64.StdEncoding.EncodeToString(value) == raw
}

func parseDSMClipboardWrite(r *http.Request) (dsmClipboardWrite, error) {
	var v dsmClipboardWrite
	if r.ContentLength < 2 || r.ContentLength > dsmClipboardBodyMax {
		return v, errors.New("invalid Clipboard body length")
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, dsmClipboardBodyMax+1))
	if err != nil || len(raw) > dsmClipboardBodyMax || int64(len(raw)) != r.ContentLength {
		return v, errors.New("unbounded Clipboard body")
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&v); err != nil {
		return v, err
	}
	var tail any
	if err := dec.Decode(&tail); err != io.EOF {
		return v, errors.New("trailing Clipboard input")
	}
	if len(v.OwnerScope) != 64 || !nasSelectionID.MatchString(v.OwnerScope) {
		return v, errors.New("invalid Clipboard Owner scope")
	}
	switch r.URL.Path {
	case "/v1/cloud-clipboard-check":
		if len(v.Nonce) != 16 || len(v.Ciphertext) < 20 || len(v.Ciphertext) > 256 ||
			v.Scope == "" || len(v.Scope) > 512 || v.ID != 0 || v.ClientEventID != "" || v.Kind != "" ||
			v.TargetDeviceID != "" || v.DeviceID != "" || v.EphemeralKey != "" || v.WrappedKey != "" || v.NodeID != 0 {
			return v, errors.New("invalid Clipboard encrypted verifier")
		}
	case "/v1/cloud-clipboard-create":
		if len(v.Nonce) != 16 || len(v.Ciphertext) < 20 || len(v.Ciphertext) > 90000 ||
			uuid.Validate(v.ClientEventID) != nil || v.ID != 0 || v.Scope != "" || v.DeviceID != "" {
			return v, errors.New("invalid encrypted Clipboard")
		}
		switch v.Kind {
		case "text/plain", "text/uri-list":
			if v.NodeID != 0 {
				return v, errors.New("text Clipboard cannot grant file access")
			}
		case "image/x-xdrive-node-ref", "application/x-xdrive-node-ref":
			if v.NodeID == 0 || v.TargetDeviceID == "" {
				return v, errors.New("media Clipboard must target an existing Node")
			}
		default:
			return v, errors.New("invalid Clipboard authenticated kind")
		}
		if v.TargetDeviceID == "" {
			if v.EphemeralKey != "" || v.WrappedKey != "" {
				return v, errors.New("v1 Clipboard cannot carry targeted keys")
			}
		} else {
			id, err := uuid.Parse(v.TargetDeviceID)
			if err != nil || id.String() != v.TargetDeviceID ||
				!dsmClipboardKeyExact(v.EphemeralKey, 32) ||
				!dsmClipboardKeyExact(v.WrappedKey, 60) {
				return v, errors.New("invalid targeted Clipboard recipient")
			}
		}
	case "/v1/cloud-clipboard-enable-device", "/v1/cloud-clipboard-decrypt":
		if v.Nonce != "" || v.Ciphertext != "" || v.ClientEventID != "" ||
			v.Scope != "" || v.Kind != "" || v.TargetDeviceID != "" ||
			v.EphemeralKey != "" || v.WrappedKey != "" || v.NodeID != 0 || v.DeviceID != "" ||
			(r.URL.Path == "/v1/cloud-clipboard-enable-device" && v.ID != 0) ||
			(r.URL.Path == "/v1/cloud-clipboard-decrypt" && v.ID == 0) {
			return v, errors.New("invalid Clipboard device mutation")
		}
	case "/v1/cloud-clipboard-revoke-device":
		id, err := uuid.Parse(v.DeviceID)
		if err != nil || id.String() != v.DeviceID || v.ID != 0 ||
			v.Nonce != "" || v.Ciphertext != "" || v.ClientEventID != "" ||
			v.Scope != "" || v.Kind != "" || v.TargetDeviceID != "" ||
			v.EphemeralKey != "" || v.WrappedKey != "" || v.NodeID != 0 {
			return v, errors.New("invalid Clipboard recipient revocation")
		}
	case "/v1/cloud-clipboard-delete":
		if v.ID == 0 || v.DeviceID != "" || v.Nonce != "" || v.Ciphertext != "" || v.ClientEventID != "" ||
			v.Scope != "" || v.Kind != "" || v.TargetDeviceID != "" ||
			v.EphemeralKey != "" || v.WrappedKey != "" || v.NodeID != 0 {
			return v, errors.New("invalid Clipboard delete")
		}
	case "/v1/cloud-clipboard-clear":
		if v.ID != 0 || v.DeviceID != "" || v.Nonce != "" || v.Ciphertext != "" || v.ClientEventID != "" ||
			v.Scope != "" || v.Kind != "" || v.TargetDeviceID != "" ||
			v.EphemeralKey != "" || v.WrappedKey != "" || v.NodeID != 0 {
			return v, errors.New("invalid Clipboard clear")
		}
	default:
		return v, errors.New("unknown Clipboard mutation")
	}
	return v, nil
}
func serveDSMOwnerClipboard(w http.ResponseWriter, r *http.Request, ctx context.Context,
	agent Agent, key []byte, principal string) {
	operations, ok := agent.(OwnerClipboardAgent)
	capable, capableOK := agent.(interface{ OwnerClipboardAvailable() bool })
	login, loginOK := agent.(ServerLoginAgent)
	if !ok || !capableOK || !loginOK || !capable.OwnerClipboardAvailable() {
		http.Error(w, "Owner Clipboard unavailable", http.StatusNotImplemented)
		return
	}
	before, err := login.ServerConnection(ctx)
	if err != nil || !before.Configured || before.MustChangePassword {
		http.Error(w, "Owner Clipboard authorization unavailable", http.StatusServiceUnavailable)
		return
	}
	var input dsmClipboardWrite
	if isDSMClipboardWrite(r.URL.Path) {
		input, err = parseDSMClipboardWrite(r)
		if err != nil {
			http.Error(w, "invalid Owner Clipboard input", http.StatusBadRequest)
			return
		}
		expected := dsmOwnerScope(key, principal, r.Header.Get("Cookie"), r.Host, before.Server, before.Username)
		if expected == "" || expected != input.OwnerScope {
			http.Error(w, "Clipboard Owner changed", http.StatusConflict)
			return
		}
		quota, ok := agent.(OwnerQuotaReader)
		if !ok {
			http.Error(w, "Owner proof unavailable", http.StatusNotImplemented)
			return
		}
		value, quotaErr := quota.OwnerQuota(ctx)
		if quotaErr != nil || !localbackupipc.ValidateOwnerQuota(value) {
			http.Error(w, "Owner proof invalid", http.StatusServiceUnavailable)
			return
		}
	}
	var output any
	switch r.URL.Path {
	case "/v1/cloud-clipboard-capability":
		output = map[string]bool{"available": true}
	case "/v1/cloud-clipboard-vault":
		output, err = operations.OwnerClipboardVault(ctx)
	case "/v1/cloud-clipboard-check":
		output, err = operations.OwnerClipboardCheck(ctx, client.ClipboardCheck{
			Nonce: input.Nonce, Ciphertext: input.Ciphertext, Scope: input.Scope,
		})
	case "/v1/cloud-clipboard-devices":
		// An older DSM Agent does not acquire v2 through a generic proxy.
		directory, supported := agent.(interface {
			OwnerClipboardDevices(context.Context) (client.ClipboardDevices, error)
		})
		if !supported {
			http.Error(w, "Clipboard recipients unavailable", http.StatusNotImplemented)
			return
		}
		output, err = directory.OwnerClipboardDevices(ctx)
	case "/v1/cloud-clipboard-list":
		raw := r.URL.Query().Get("before")
		after := uint64(0)
		if raw != "" {
			after, err = strconv.ParseUint(raw, 10, 64)
			if err != nil || after == 0 {
				http.Error(w, "invalid Clipboard cursor", http.StatusBadRequest)
				return
			}
		}
		output, err = operations.OwnerClipboardList(ctx, after)
	case "/v1/cloud-clipboard-enable-device":
		lifecycle, supported := agent.(interface {
			OwnerClipboardEnableDevice(context.Context) (client.ClipboardDevice, error)
		})
		if !supported {
			http.Error(w, "device enrollment unsupported", http.StatusNotImplemented)
			return
		}
		output, err = lifecycle.OwnerClipboardEnableDevice(ctx)
	case "/v1/cloud-clipboard-decrypt":
		lifecycle, supported := agent.(interface {
			OwnerClipboardDecrypt(context.Context, uint64) (string, error)
		})
		if !supported {
			http.Error(w, "recipient decrypt unsupported", http.StatusNotImplemented)
			return
		}
		var clear string
		clear, err = lifecycle.OwnerClipboardDecrypt(ctx, input.ID)
		if err == nil {
			output = map[string]string{"text": clear}
		}
	case "/v1/cloud-clipboard-revoke-device":
		lifecycle, supported := agent.(interface {
			OwnerClipboardRevokeDevice(context.Context, string) error
		})
		if !supported {
			http.Error(w, "recipient revocation unsupported", http.StatusNotImplemented)
			return
		}
		err = lifecycle.OwnerClipboardRevokeDevice(ctx, input.DeviceID)
		output = map[string]bool{"revoked": err == nil}
	case "/v1/cloud-clipboard-create":
		output, err = operations.OwnerClipboardCreate(ctx, client.ClipboardWrite{
			ClientEventID: input.ClientEventID, Kind: input.Kind, Nonce: input.Nonce,
			Ciphertext: input.Ciphertext, TargetDeviceID: input.TargetDeviceID,
			EphemeralKey: input.EphemeralKey, WrappedKey: input.WrappedKey, NodeID: input.NodeID,
		})
	case "/v1/cloud-clipboard-delete":
		err = operations.OwnerClipboardDelete(ctx, input.ID)
		output = map[string]bool{"deleted": err == nil}
	case "/v1/cloud-clipboard-clear":
		err = operations.OwnerClipboardClear(ctx)
		output = map[string]bool{"cleared": err == nil}
	default:
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, "Owner Clipboard request not confirmed", http.StatusConflict)
		return
	}
	after, err := login.ServerConnection(ctx)
	if err != nil || !after.Configured || after.MustChangePassword ||
		before.Server != after.Server || before.Username != after.Username {
		http.Error(w, "Clipboard Owner changed during operation", http.StatusConflict)
		return
	}
	sendJSON(w, output)
}
