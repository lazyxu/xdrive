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

type OwnerNodeMover interface {
	OwnerMoveNode(context.Context, uint64, uint64, uint64, uint64, string, string) (localbackupipc.OwnerFileNode, error)
}

type ownerNodeMoveInput struct {
	ID           uint64
	Revision     uint64
	ParentID     uint64
	TargetParent uint64
	Kind         string
	Name         string
	OwnerScope   string
}

// Fixed same-origin DSM Owner operation. No caller can choose a NAS path,
// Agent endpoint, general RPC, or a batch of files.
func parseDSMOwnerNodeMove(r *http.Request) (ownerNodeMoveInput, error) {
	var input ownerNodeMoveInput
	if r == nil || r.URL == nil || r.URL.RawQuery != "" || r.Body == nil ||
		r.ContentLength < 2 || r.ContentLength > 1024 {
		return input, errors.New("invalid DSM Owner move request")
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1025))
	if err != nil || len(body) > 1024 || int64(len(body)) != r.ContentLength {
		return input, errors.New("invalid DSM Owner move body")
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	first, err := decoder.Token()
	if err != nil || first != json.Delim('{') {
		return input, errors.New("Owner move requires JSON object")
	}
	seen := make(map[string]bool, 7)
	for decoder.More() {
		token, err := decoder.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] {
			return ownerNodeMoveInput{}, errors.New("invalid or duplicate Owner move field")
		}
		seen[key] = true
		switch key {
		case "id":
			err = decoder.Decode(&input.ID)
		case "revision":
			err = decoder.Decode(&input.Revision)
		case "parent_id":
			err = decoder.Decode(&input.ParentID)
		case "target_parent_id":
			err = decoder.Decode(&input.TargetParent)
		case "type":
			err = decoder.Decode(&input.Kind)
		case "name":
			err = decoder.Decode(&input.Name)
		case "owner_scope":
			err = decoder.Decode(&input.OwnerScope)
		default:
			return ownerNodeMoveInput{}, errors.New("unknown Owner move field")
		}
		if err != nil {
			return ownerNodeMoveInput{}, errors.New("invalid Owner move field value")
		}
	}
	end, err := decoder.Token()
	if err != nil || end != json.Delim('}') || len(seen) != 7 {
		return ownerNodeMoveInput{}, errors.New("incomplete Owner move")
	}
	if _, err := decoder.Token(); err != io.EOF {
		return ownerNodeMoveInput{}, errors.New("trailing Owner move payload")
	}
	if !localbackupipc.ValidOwnerFileID(input.ID) ||
		!localbackupipc.ValidOwnerFileID(input.Revision) ||
		!localbackupipc.ValidOwnerFileID(input.ParentID) ||
		!localbackupipc.ValidOwnerFileID(input.TargetParent) ||
		input.ParentID == input.TargetParent || input.ID == input.TargetParent ||
		(input.Kind != "file" && input.Kind != "dir") ||
		!localbackupipc.ValidOwnerFolderName(input.Name) ||
		!nasSelectionID.MatchString(input.OwnerScope) {
		return input, errors.New("invalid Owner move selector")
	}
	return input, nil
}

func serveDSMOwnerNodeMove(w http.ResponseWriter, r *http.Request, ctx context.Context,
	agent Agent, key []byte, principal string,
) {
	input, err := parseDSMOwnerNodeMove(r)
	if err != nil {
		http.Error(w, "invalid Owner move request", http.StatusBadRequest)
		return
	}
	mover, canMove := agent.(OwnerNodeMover)
	login, canIdentify := agent.(ServerLoginAgent)
	quota, canVerify := agent.(OwnerQuotaReader)
	if !canMove || !canIdentify || !canVerify {
		http.Error(w, "Owner move capability unavailable", http.StatusNotImplemented)
		return
	}
	before, err := login.ServerConnection(ctx)
	if err != nil || !before.Configured || before.MustChangePassword {
		http.Error(w, "Server Owner session unavailable", http.StatusServiceUnavailable)
		return
	}
	expected := dsmOwnerScope(key, principal, r.Header.Get("Cookie"), r.Host, before.Server, before.Username)
	if expected == "" || expected != input.OwnerScope {
		http.Error(w, "Server Owner changed before move", http.StatusConflict)
		return
	}
	ownerQuota, err := quota.OwnerQuota(ctx)
	if err != nil || !localbackupipc.ValidateOwnerQuota(ownerQuota) {
		http.Error(w, "Server Owner verification unavailable", http.StatusServiceUnavailable)
		return
	}
	check, err := login.ServerConnection(ctx)
	if err != nil || !check.Configured || check.MustChangePassword ||
		check.Server != before.Server || check.Username != before.Username {
		http.Error(w, "Server Owner changed before move", http.StatusConflict)
		return
	}
	node, err := mover.OwnerMoveNode(ctx, input.ID, input.Revision,
		input.ParentID, input.TargetParent, input.Kind, input.Name)
	if err != nil || !localbackupipc.ValidateOwnerMovedNode(node, input.ID, input.Revision,
		input.ParentID, input.TargetParent, input.Kind, input.Name) {
		http.Error(w, "Owner move failed or result uncertain; refresh before retry", http.StatusConflict)
		return
	}
	after, err := login.ServerConnection(ctx)
	if err != nil || !after.Configured || after.Server != before.Server ||
		after.Username != before.Username {
		http.Error(w, "Owner changed during move; refresh before retry", http.StatusConflict)
		return
	}
	sendJSON(w, node)
}
