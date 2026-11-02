package synologyui

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

// OwnerFolderCreator is the existing Server create-directory operation exposed
// through one typed same-user Backup-only Agent method, not a generic proxy.
type OwnerFolderCreator interface {
	OwnerCreateFolder(context.Context, uint64, string) (localbackupipc.OwnerFileNode, error)
}

type ownerFolderCreateInput struct {
	ParentID   uint64
	Name       string
	OwnerScope string
}

func parseDSMOwnerFolderCreate(r *http.Request) (ownerFolderCreateInput, error) {
	var input ownerFolderCreateInput
	if r == nil || r.URL == nil || r.URL.RawQuery != "" || r.Body == nil ||
		r.ContentLength < 2 || r.ContentLength > 1024 {
		return input, errors.New("invalid DSM Owner folder request")
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1025))
	if err != nil || len(body) > 1024 || int64(len(body)) != r.ContentLength {
		return input, errors.New("invalid DSM Owner folder body")
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	first, err := decoder.Token()
	if err != nil || first != json.Delim('{') {
		return input, errors.New("Owner folder request must be a JSON object")
	}
	seen := make(map[string]bool, 3)
	for decoder.More() {
		field, err := decoder.Token()
		key, ok := field.(string)
		if err != nil || !ok || seen[key] {
			return ownerFolderCreateInput{}, errors.New("invalid or duplicate Owner folder field")
		}
		seen[key] = true
		switch key {
		case "parent_id":
			err = decoder.Decode(&input.ParentID)
		case "name":
			err = decoder.Decode(&input.Name)
		case "owner_scope":
			err = decoder.Decode(&input.OwnerScope)
		default:
			return ownerFolderCreateInput{}, errors.New("unknown Owner folder field")
		}
		if err != nil {
			return ownerFolderCreateInput{}, errors.New("invalid Owner folder field")
		}
	}
	end, err := decoder.Token()
	if err != nil || end != json.Delim('}') || len(seen) != 3 {
		return ownerFolderCreateInput{}, errors.New("incomplete Owner folder request")
	}
	if _, err := decoder.Token(); err != io.EOF {
		return ownerFolderCreateInput{}, errors.New("trailing Owner folder payload")
	}
	if !localbackupipc.ValidOwnerFileID(input.ParentID) ||
		!localbackupipc.ValidOwnerFolderName(input.Name) ||
		!nasSelectionID.MatchString(input.OwnerScope) {
		return ownerFolderCreateInput{}, errors.New("invalid Owner folder selector")
	}
	return input, nil
}

func serveDSMOwnerFolderCreate(w http.ResponseWriter, r *http.Request, ctx context.Context,
	agent Agent, key []byte, principal string) {
	input, err := parseDSMOwnerFolderCreate(r)
	if err != nil {
		http.Error(w, "invalid Owner folder create request", http.StatusBadRequest)
		return
	}
	creator, canCreate := agent.(OwnerFolderCreator)
	login, canIdentify := agent.(ServerLoginAgent)
	quota, canVerify := agent.(OwnerQuotaReader)
	if !canCreate || !canIdentify || !canVerify {
		http.Error(w, "owning Agent folder creation unavailable", http.StatusNotImplemented)
		return
	}
	status, err := login.ServerConnection(ctx)
	if err != nil || !status.Configured {
		http.Error(w, "Server Owner session unavailable", http.StatusServiceUnavailable)
		return
	}
	expected := dsmOwnerScope(key, principal, r.Header.Get("Cookie"), r.Host,
		status.Server, status.Username)
	if expected == "" || expected != input.OwnerScope {
		http.Error(w, "Server Owner changed before folder creation", http.StatusConflict)
		return
	}
	ownerQuota, err := quota.OwnerQuota(ctx)
	if err != nil || !localbackupipc.ValidateOwnerQuota(ownerQuota) {
		http.Error(w, "Server Owner verification unavailable", http.StatusServiceUnavailable)
		return
	}
	before, err := login.ServerConnection(ctx)
	if err != nil || !before.Configured || before.Server != status.Server ||
		before.Username != status.Username {
		http.Error(w, "Server Owner changed before mutation", http.StatusConflict)
		return
	}
	created, err := creator.OwnerCreateFolder(ctx, input.ParentID, input.Name)
	if err != nil || !localbackupipc.ValidateOwnerCreatedFolder(created, input.ParentID, input.Name) {
		http.Error(w, "Server Owner folder creation failed or is unverified", http.StatusConflict)
		return
	}
	after, err := login.ServerConnection(ctx)
	if err != nil || !after.Configured || after.Server != status.Server ||
		after.Username != status.Username {
		http.Error(w, "Server Owner changed during folder creation; refresh before retry", http.StatusConflict)
		return
	}
	sendJSON(w, created)
}
