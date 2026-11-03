package synologyui

import (
	"context"
	"net/http"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

// The DSM copy and move operations intentionally share the same strict
// seven-field, single-current-Owner source/target selector. The original
// Server's copy does not have an atomic source-revision precondition.
type OwnerNodeCopier interface {
	OwnerCopyNode(context.Context, uint64, uint64, uint64, uint64, string, string) (localbackupipc.OwnerFileNode, error)
}

func serveDSMOwnerNodeCopy(w http.ResponseWriter, r *http.Request, ctx context.Context,
	agent Agent, key []byte, principal string,
) {
	input, err := parseDSMOwnerNodeMove(r)
	if err != nil {
		http.Error(w, "invalid Owner copy request", http.StatusBadRequest)
		return
	}
	copier, canCopy := agent.(OwnerNodeCopier)
	login, canIdentify := agent.(ServerLoginAgent)
	quota, canVerify := agent.(OwnerQuotaReader)
	if !canCopy || !canIdentify || !canVerify {
		http.Error(w, "Owner copy capability unavailable", http.StatusNotImplemented)
		return
	}
	before, err := login.ServerConnection(ctx)
	if err != nil || !before.Configured || before.MustChangePassword {
		http.Error(w, "Server Owner session unavailable", http.StatusServiceUnavailable)
		return
	}
	expected := dsmOwnerScope(key, principal, r.Header.Get("Cookie"), r.Host, before.Server, before.Username)
	if expected == "" || expected != input.OwnerScope {
		http.Error(w, "Server Owner changed before copy", http.StatusConflict)
		return
	}
	ownerQuota, err := quota.OwnerQuota(ctx)
	if err != nil || !localbackupipc.ValidateOwnerQuota(ownerQuota) {
		http.Error(w, "Server Owner verification unavailable", http.StatusServiceUnavailable)
		return
	}
	rechecked, err := login.ServerConnection(ctx)
	if err != nil || !rechecked.Configured || rechecked.MustChangePassword ||
		rechecked.Server != before.Server || rechecked.Username != before.Username {
		http.Error(w, "Server Owner changed before copy", http.StatusConflict)
		return
	}
	node, err := copier.OwnerCopyNode(ctx, input.ID, input.Revision,
		input.ParentID, input.TargetParent, input.Kind, input.Name)
	if err != nil || !localbackupipc.ValidateOwnerCopiedNode(node,
		input.ID, input.Revision, input.ParentID, input.TargetParent, input.Kind, input.Name) {
		http.Error(w, "Owner copy failed or result uncertain; refresh before retry", http.StatusConflict)
		return
	}
	after, err := login.ServerConnection(ctx)
	if err != nil || !after.Configured || after.Server != before.Server ||
		after.Username != before.Username {
		http.Error(w, "Owner changed during copy; refresh before retry", http.StatusConflict)
		return
	}
	sendJSON(w, node)
}
