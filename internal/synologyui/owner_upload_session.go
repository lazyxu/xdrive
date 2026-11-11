package synologyui

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

// Each CGI request carries at most one canonical 4 MiB Server UploadSession
// part; no native path, second CAS writer, arbitrary HTTP URL or Agent token.
func isDSMOwnerLargeUploadPath(path string) bool {
	switch path {
	case "/v1/cloud-upload-start", "/v1/cloud-upload-part",
		"/v1/cloud-upload-finish", "/v1/cloud-upload-abort":
		return true
	}
	return false
}
func dsmLargeUploadBodyMax(path string) int64 {
	if path == "/v1/cloud-upload-part" {
		return 6 << 20
	}
	return 2048
}

type OwnerLargeUploadAgent interface {
	OwnerLargeUploadStart(context.Context, uint64, string, int64) (localbackupipc.OwnerLargeUploadSession, error)
	OwnerLargeUploadPart(context.Context, string, int, string, []byte) (client.UploadPart, error)
	OwnerLargeUploadFinish(context.Context, string, uint64, string, int64) (localbackupipc.OwnerFileNode, error)
	OwnerLargeUploadAbort(context.Context, string) error
}
type dsmLargeUploadRequest struct {
	OwnerScope string `json:"owner_scope"`
	ParentID   uint64 `json:"parent_id,omitempty"`
	Name       string `json:"name,omitempty"`
	Size       int64  `json:"size,omitempty"`
	ID         string `json:"id,omitempty"`
	Index      int    `json:"index,omitempty"`
	SHA256     string `json:"sha256,omitempty"`
	Data       []byte `json:"data,omitempty"`
}

func parseDSMOwnerLargeUpload(r *http.Request) (dsmLargeUploadRequest, error) {
	var input dsmLargeUploadRequest
	if r == nil || r.URL == nil || r.URL.RawQuery != "" || r.Body == nil ||
		!isDSMOwnerLargeUploadPath(r.URL.Path) ||
		r.ContentLength < 2 || r.ContentLength > dsmLargeUploadBodyMax(r.URL.Path) {
		return input, errors.New("invalid Owner upload endpoint or length")
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, dsmLargeUploadBodyMax(r.URL.Path)+1))
	if err != nil || len(raw) != int(r.ContentLength) || int64(len(raw)) > dsmLargeUploadBodyMax(r.URL.Path) {
		return input, errors.New("invalid Owner upload bytes")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&input); err != nil {
		return input, err
	}
	var rest any
	if err = decoder.Decode(&rest); err != io.EOF {
		return input, errors.New("trailing Owner upload body")
	}
	if len(input.OwnerScope) != 64 || !nasSelectionID.MatchString(input.OwnerScope) {
		return input, errors.New("invalid Owner upload scope")
	}
	if input.ID != "" {
		parsed, err := uuid.Parse(input.ID)
		if err != nil || parsed.String() != input.ID {
			return input, errors.New("invalid Owner session ID")
		}
	}
	switch r.URL.Path {
	case "/v1/cloud-upload-start":
		if !localbackupipc.ValidOwnerFileID(input.ParentID) ||
			!localbackupipc.ValidOwnerFolderName(input.Name) ||
			input.Size <= 4<<20 || input.Size > 16<<30 || input.ID != "" ||
			input.Index != 0 || input.SHA256 != "" || input.Data != nil {
			return input, errors.New("invalid Owner upload start")
		}
	case "/v1/cloud-upload-part":
		if input.ID == "" || input.ParentID != 0 || input.Name != "" || input.Size != 0 ||
			input.Index < 0 || len(input.SHA256) != 64 || len(input.Data) == 0 || len(input.Data) > 4<<20 {
			return input, errors.New("invalid Owner upload part")
		}
	case "/v1/cloud-upload-finish":
		if input.ID == "" || !localbackupipc.ValidOwnerFileID(input.ParentID) ||
			!localbackupipc.ValidOwnerFolderName(input.Name) || input.Size <= 4<<20 ||
			input.Size > 16<<30 || input.Index != 0 || input.SHA256 != "" || input.Data != nil {
			return input, errors.New("invalid Owner upload finish")
		}
	case "/v1/cloud-upload-abort":
		if input.ID == "" || input.ParentID != 0 || input.Name != "" || input.Size != 0 ||
			input.Index != 0 || input.SHA256 != "" || input.Data != nil {
			return input, errors.New("invalid Owner upload abort")
		}
	}
	return input, nil
}

func serveDSMOwnerLargeUpload(w http.ResponseWriter, r *http.Request, ctx context.Context,
	agent Agent, key []byte, principal string,
) {
	input, err := parseDSMOwnerLargeUpload(r)
	if err != nil {
		http.Error(w, "invalid Owner UploadSession request", http.StatusBadRequest)
		return
	}
	operations, ok := agent.(OwnerLargeUploadAgent)
	login, loginOK := agent.(ServerLoginAgent)
	quota, quotaOK := agent.(OwnerQuotaReader)
	if !ok || !loginOK || !quotaOK {
		http.Error(w, "Owner upload capability unavailable", http.StatusNotImplemented)
		return
	}
	before, err := login.ServerConnection(ctx)
	if err != nil || !before.Configured || before.MustChangePassword {
		http.Error(w, "Owner session unavailable", http.StatusServiceUnavailable)
		return
	}
	expected := dsmOwnerScope(key, principal, r.Header.Get("Cookie"), r.Host, before.Server, before.Username)
	if expected == "" || expected != input.OwnerScope {
		http.Error(w, "Owner upload scope changed", http.StatusConflict)
		return
	}
	value, err := quota.OwnerQuota(ctx)
	if err != nil || !localbackupipc.ValidateOwnerQuota(value) {
		http.Error(w, "Owner quota proof unavailable", http.StatusServiceUnavailable)
		return
	}
	var output any
	switch r.URL.Path {
	case "/v1/cloud-upload-start":
		output, err = operations.OwnerLargeUploadStart(ctx, input.ParentID, input.Name, input.Size)
	case "/v1/cloud-upload-part":
		output, err = operations.OwnerLargeUploadPart(ctx, input.ID, input.Index, input.SHA256, input.Data)
	case "/v1/cloud-upload-finish":
		output, err = operations.OwnerLargeUploadFinish(ctx, input.ID, input.ParentID, input.Name, input.Size)
	case "/v1/cloud-upload-abort":
		err = operations.OwnerLargeUploadAbort(ctx, input.ID)
		output = map[string]bool{"aborted": err == nil}
	}
	if err != nil {
		http.Error(w, "Owner upload result not confirmed; check Files before retry", http.StatusConflict)
		return
	}
	after, err := login.ServerConnection(ctx)
	if err != nil || !after.Configured || after.MustChangePassword ||
		before.Server != after.Server || before.Username != after.Username {
		http.Error(w, "Owner session changed during upload; check Files", http.StatusConflict)
		return
	}
	sendJSON(w, output)
}
