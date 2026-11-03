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

type OwnerNodeDeleter interface {
	OwnerDeleteNode(context.Context, uint64, uint64, uint64, string, string) error
}

type ownerNodeDeleteInput struct {
	ID         uint64
	Revision   uint64
	ParentID   uint64
	Kind       string
	Name       string
	OwnerScope string
}

// JSON intentionally permits exactly one literal Owner node with a verified
// parent and revision. The user never supplies an Agent endpoint, local path,
// deletion mode or arbitrary batch operation.
func parseDSMOwnerNodeDelete(r *http.Request) (ownerNodeDeleteInput, error) {
	var input ownerNodeDeleteInput
	if r == nil || r.URL == nil || r.URL.RawQuery != "" || r.Body == nil ||
		r.ContentLength < 2 || r.ContentLength > 1024 {
		return input, errors.New("invalid DSM Owner delete request")
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1025))
	if err != nil || len(body) > 1024 || int64(len(body)) != r.ContentLength {
		return input, errors.New("invalid Owner delete body")
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	first, err := decoder.Token()
	if err != nil || first != json.Delim('{') {
		return input, errors.New("Owner delete requires a JSON object")
	}
	seen := make(map[string]bool, 6)
	for decoder.More() {
		token, err := decoder.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] {
			return ownerNodeDeleteInput{}, errors.New("invalid or duplicate Owner delete field")
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
			return ownerNodeDeleteInput{}, errors.New("unknown Owner delete field")
		}
		if err != nil {
			return ownerNodeDeleteInput{}, errors.New("invalid Owner delete field value")
		}
	}
	last, err := decoder.Token()
	if err != nil || last != json.Delim('}') || len(seen) != 6 {
		return ownerNodeDeleteInput{}, errors.New("incomplete Owner delete")
	}
	if _, err := decoder.Token(); err != io.EOF {
		return ownerNodeDeleteInput{}, errors.New("trailing Owner delete payload")
	}
	if !localbackupipc.ValidOwnerDeleteNode(
		input.ID, input.Revision, input.ParentID, input.Kind, input.Name,
	) || !nasSelectionID.MatchString(input.OwnerScope) {
		return ownerNodeDeleteInput{}, errors.New("invalid Owner delete selector")
	}
	return input, nil
}

func serveDSMOwnerNodeDelete(w http.ResponseWriter, r *http.Request, ctx context.Context,
	agent Agent, key []byte, principal string,
) {
	input, err := parseDSMOwnerNodeDelete(r)
	if err != nil {
		http.Error(w, "invalid Owner move-to-trash request", http.StatusBadRequest)
		return
	}
	deleter, canDelete := agent.(OwnerNodeDeleter)
	login, canIdentify := agent.(ServerLoginAgent)
	quota, canVerify := agent.(OwnerQuotaReader)
	if !canDelete || !canIdentify || !canVerify {
		http.Error(w, "Owner move-to-trash capability unavailable", http.StatusNotImplemented)
		return
	}
	before, err := login.ServerConnection(ctx)
	if err != nil || !before.Configured || before.MustChangePassword {
		http.Error(w, "Server Owner session unavailable", http.StatusServiceUnavailable)
		return
	}
	expected := dsmOwnerScope(key, principal, r.Header.Get("Cookie"), r.Host,
		before.Server, before.Username)
	if expected == "" || expected != input.OwnerScope {
		http.Error(w, "Server Owner changed before delete", http.StatusConflict)
		return
	}
	ownerQuota, err := quota.OwnerQuota(ctx)
	if err != nil || !localbackupipc.ValidateOwnerQuota(ownerQuota) {
		http.Error(w, "Server Owner verification unavailable", http.StatusServiceUnavailable)
		return
	}
	rechecked, err := login.ServerConnection(ctx)
	if err != nil || !rechecked.Configured || rechecked.Server != before.Server ||
		rechecked.Username != before.Username || rechecked.MustChangePassword {
		http.Error(w, "Server Owner changed before delete", http.StatusConflict)
		return
	}
	if err := deleter.OwnerDeleteNode(ctx,
		input.ID, input.Revision, input.ParentID, input.Kind, input.Name); err != nil {
		http.Error(w, "Owner delete failed or result uncertain; refresh before retry", http.StatusConflict)
		return
	}
	after, err := login.ServerConnection(ctx)
	if err != nil || !after.Configured || after.Server != before.Server ||
		after.Username != before.Username {
		http.Error(w, "Server Owner changed during delete; refresh before retry", http.StatusConflict)
		return
	}
	sendJSON(w, map[string]bool{"ok": true})
}
