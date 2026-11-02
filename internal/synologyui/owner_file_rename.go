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

// One explicit, revision-checked authenticated Owner file operation.
// The DSM CGI never accepts a filesystem path or arbitrary upstream URL.
type OwnerNodeRenamer interface {
	OwnerRenameNode(context.Context, uint64, uint64, uint64, string, string) (localbackupipc.OwnerFileNode, error)
}

type ownerNodeRenameInput struct {
	ID         uint64
	Revision   uint64
	ParentID   uint64
	Kind       string
	Name       string
	OwnerScope string
}

func parseDSMOwnerNodeRename(r *http.Request) (ownerNodeRenameInput, error) {
	var input ownerNodeRenameInput
	if r == nil || r.URL == nil || r.URL.RawQuery != "" || r.Body == nil ||
		r.ContentLength < 2 || r.ContentLength > 1024 {
		return input, errors.New("invalid DSM Owner rename request")
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1025))
	if err != nil || len(body) > 1024 || int64(len(body)) != r.ContentLength {
		return input, errors.New("invalid DSM Owner rename body")
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	first, err := decoder.Token()
	if err != nil || first != json.Delim('{') {
		return input, errors.New("Owner rename request must be a JSON object")
	}
	seen := make(map[string]bool, 6)
	for decoder.More() {
		field, err := decoder.Token()
		key, ok := field.(string)
		if err != nil || !ok || seen[key] {
			return ownerNodeRenameInput{}, errors.New("invalid or duplicate Owner rename field")
		}
		seen[key] = true
		switch key {
		case "id":
			err = decoder.Decode(&input.ID)
		case "revision":
			err = decoder.Decode(&input.Revision)
		case "parent_id":
			err = decoder.Decode(&input.ParentID)
		case "type":
			err = decoder.Decode(&input.Kind)
		case "name":
			err = decoder.Decode(&input.Name)
		case "owner_scope":
			err = decoder.Decode(&input.OwnerScope)
		default:
			return ownerNodeRenameInput{}, errors.New("unknown Owner rename field")
		}
		if err != nil {
			return ownerNodeRenameInput{}, errors.New("invalid Owner rename field")
		}
	}
	end, err := decoder.Token()
	if err != nil || end != json.Delim('}') || len(seen) != 6 {
		return ownerNodeRenameInput{}, errors.New("incomplete Owner rename request")
	}
	if _, err := decoder.Token(); err != io.EOF {
		return ownerNodeRenameInput{}, errors.New("trailing Owner rename payload")
	}
	if !localbackupipc.ValidOwnerFileID(input.ID) ||
		!localbackupipc.ValidOwnerFileID(input.Revision) ||
		!localbackupipc.ValidOwnerFileID(input.ParentID) ||
		!localbackupipc.ValidOwnerFolderName(input.Name) ||
		(input.Kind != "file" && input.Kind != "dir") ||
		!nasSelectionID.MatchString(input.OwnerScope) {
		return ownerNodeRenameInput{}, errors.New("invalid Owner rename selector")
	}
	return input, nil
}

func serveDSMOwnerNodeRename(w http.ResponseWriter, r *http.Request, ctx context.Context,
	agent Agent, key []byte, principal string) {
	input, err := parseDSMOwnerNodeRename(r)
	if err != nil {
		http.Error(w, "invalid Owner node rename request", http.StatusBadRequest)
		return
	}
	renamer, canRename := agent.(OwnerNodeRenamer)
	login, canIdentify := agent.(ServerLoginAgent)
	quota, canVerify := agent.(OwnerQuotaReader)
	if !canRename || !canIdentify || !canVerify {
		http.Error(w, "owning Agent rename unavailable", http.StatusNotImplemented)
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
		http.Error(w, "Server Owner changed before rename", http.StatusConflict)
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
	renamed, err := renamer.OwnerRenameNode(ctx,
		input.ID, input.Revision, input.ParentID, input.Kind, input.Name)
	if err != nil || !localbackupipc.ValidateOwnerRenamedNode(renamed,
		input.ID, input.Revision, input.ParentID, input.Kind, input.Name) {
		http.Error(w, "Server Owner rename failed or is unverified; refresh before retry", http.StatusConflict)
		return
	}
	after, err := login.ServerConnection(ctx)
	if err != nil || !after.Configured || after.Server != status.Server ||
		after.Username != status.Username {
		http.Error(w, "Server Owner changed during rename; refresh before retry", http.StatusConflict)
		return
	}
	sendJSON(w, renamed)
}
