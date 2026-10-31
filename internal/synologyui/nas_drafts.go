package synologyui

import (
	"context"
	"crypto/subtle"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

// DSM reads only the creating device's original paused, never-bound Source
// drafts via the existing same-user Agent. This is NOT a generic Source list,
// a Root grant or permission to retry an uncertain Create response.
type NASNativeDraftReader interface {
	LocalDrafts(context.Context) ([]localbackupipc.LocalBackupDraft, error)
}

type nasNativeDraftDTO struct {
	SourceID  uint64    `json:"source_id"`
	Name      string    `json:"name"`
	Revision  uint64    `json:"revision"`
	CreatedAt time.Time `json:"created_at"`
}

// A bounded read-only recovery aid for users whose original create/bind
// acknowledgement was lost. Manual Root recovery still uses the native xd
// command: no browser-supplied local path or new Agent mutation is permitted.
func serveDSMNativeDrafts(
	w http.ResponseWriter, r *http.Request, ctx context.Context, agent Agent,
	key []byte, principal string,
) {
	if r.URL.RawQuery != "" {
		http.Error(w, "DSM draft inspection accepts no selector", http.StatusBadRequest)
		return
	}
	reader, ok := agent.(NASNativeDraftReader)
	if !ok {
		http.Error(w, "owning Agent draft inspection unavailable", http.StatusNotImplemented)
		return
	}
	owner, ok := agent.(ServerLoginAgent)
	if !ok {
		http.Error(w, "owning Agent Server identity unavailable", http.StatusNotImplemented)
		return
	}
	quotaReader, ok := agent.(OwnerQuotaReader)
	if !ok {
		http.Error(w, "current Server Owner verification unavailable", http.StatusNotImplemented)
		return
	}
	before, err := owner.ServerConnection(ctx)
	if err != nil || !before.Configured || before.MustChangePassword {
		http.Error(w, "current Server Owner is not authenticated", http.StatusServiceUnavailable)
		return
	}
	scope := dsmOwnerScope(key, principal, r.Header.Get("Cookie"), r.Host,
		before.Server, before.Username)
	if scope == "" {
		http.Error(w, "DSM Owner scope unavailable", http.StatusServiceUnavailable)
		return
	}
	if quota, err := quotaReader.OwnerQuota(ctx); err != nil ||
		!localbackupipc.ValidateOwnerQuota(quota) {
		http.Error(w, "Server Owner cannot be verified", http.StatusServiceUnavailable)
		return
	}
	drafts, err := reader.LocalDrafts(ctx)
	// Do not return a truncated view that might invite a duplicate Source.
	if err != nil || len(drafts) > 100 {
		http.Error(w, "owning Agent draft inventory unavailable or incomplete", http.StatusServiceUnavailable)
		return
	}
	items := make([]nasNativeDraftDTO, 0, len(drafts))
	var previous uint64
	for _, draft := range drafts {
		if !localbackupipc.ValidSourceID(draft.SourceID) ||
			draft.SourceID <= previous || draft.Revision != 1 ||
			draft.Created.IsZero() || !utf8.ValidString(draft.Name) ||
			len([]byte(draft.Name)) < 1 || len([]byte(draft.Name)) > 128 ||
			strings.TrimSpace(draft.Name) != draft.Name ||
			strings.ContainsAny(draft.Name, "\x00\r\n") {
			http.Error(w, "invalid owning Agent local draft result", http.StatusServiceUnavailable)
			return
		}
		items = append(items, nasNativeDraftDTO{
			SourceID: draft.SourceID, Name: draft.Name,
			Revision: draft.Revision, CreatedAt: draft.Created,
		})
		previous = draft.SourceID
	}
	after, err := owner.ServerConnection(ctx)
	if err != nil || !after.Configured || after.MustChangePassword ||
		subtle.ConstantTimeCompare([]byte(scope), []byte(dsmOwnerScope(
			key, principal, r.Header.Get("Cookie"), r.Host,
			after.Server, after.Username))) != 1 {
		http.Error(w, "Server Owner changed during draft inspection", http.StatusConflict)
		return
	}
	sendJSON(w, struct {
		OwnerScope string              `json:"owner_scope"`
		Items      []nasNativeDraftDTO `json:"items"`
	}{OwnerScope: scope, Items: items})
}
