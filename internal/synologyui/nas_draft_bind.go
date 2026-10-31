package synologyui

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type nasDraftBindInput struct {
	SourceID    uint64
	SelectionID string
	OwnerScope  string
	Confirmed   bool
}

// Bind a pre-existing native draft, never create a Source or accept a browser
// filesystem path. The owning Agent and Server remain the only Root authority.
func parseNASDraftBind(r *http.Request) (nasDraftBindInput, error) {
	var input nasDraftBindInput
	if r == nil || r.URL == nil || r.URL.RawQuery != "" ||
		r.Body == nil || r.ContentLength < 2 || r.ContentLength > 1024 {
		return input, errors.New("invalid DSM native draft bind request")
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1025))
	if err != nil || len(body) > 1024 || int64(len(body)) != r.ContentLength {
		return input, errors.New("invalid native draft bind body")
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	start, err := decoder.Token()
	if err != nil || start != json.Delim('{') {
		return input, errors.New("native draft binding requires JSON object")
	}
	seen := make(map[string]bool, 4)
	for decoder.More() {
		field, err := decoder.Token()
		name, ok := field.(string)
		if err != nil || !ok || seen[name] {
			return nasDraftBindInput{}, errors.New("invalid or duplicate bind field")
		}
		seen[name] = true
		switch name {
		case "source_id":
			err = decoder.Decode(&input.SourceID)
		case "selection_id":
			err = decoder.Decode(&input.SelectionID)
		case "owner_scope":
			err = decoder.Decode(&input.OwnerScope)
		case "confirmed":
			err = decoder.Decode(&input.Confirmed)
		default:
			return nasDraftBindInput{}, errors.New("unexpected native draft bind field")
		}
		if err != nil {
			return nasDraftBindInput{}, errors.New("invalid native draft bind value")
		}
	}
	end, err := decoder.Token()
	if err != nil || end != json.Delim('}') || len(seen) != 4 {
		return nasDraftBindInput{}, errors.New("incomplete native draft binding")
	}
	if _, err = decoder.Token(); err != io.EOF {
		return nasDraftBindInput{}, errors.New("trailing native draft bind body")
	}
	if !localbackupipc.ValidSourceID(input.SourceID) ||
		!nasSelectionID.MatchString(input.SelectionID) ||
		!nasSelectionID.MatchString(input.OwnerScope) || !input.Confirmed {
		return nasDraftBindInput{}, errors.New("invalid native draft consent or selector")
	}
	return input, nil
}

// The browser must reselect a fresh NAS share and explicitly confirm binding
// this specific original device draft. No upload, scheduling, unbind, delete or
// retry is triggered by this endpoint.
func serveDSMNativeDraftBind(
	w http.ResponseWriter, r *http.Request, ctx context.Context, agent Agent,
	key []byte, principal, nasRoot string,
) {
	input, err := parseNASDraftBind(r)
	if err != nil {
		http.Error(w, "invalid DSM draft binding request", http.StatusBadRequest)
		return
	}
	bootstrap, ok := agent.(NASShareBootstrapper)
	if !ok {
		http.Error(w, "native Root binding unavailable", http.StatusNotImplemented)
		return
	}
	reader, ok := agent.(NASNativeDraftReader)
	if !ok {
		http.Error(w, "owning Agent draft inspection unavailable", http.StatusNotImplemented)
		return
	}
	owner, ok := agent.(ServerLoginAgent)
	if !ok {
		http.Error(w, "Server Owner scope unavailable", http.StatusNotImplemented)
		return
	}
	quotaReader, ok := agent.(OwnerQuotaReader)
	if !ok {
		http.Error(w, "Owner proof unavailable", http.StatusNotImplemented)
		return
	}
	connection, err := owner.ServerConnection(ctx)
	if err != nil || !connection.Configured || connection.MustChangePassword {
		http.Error(w, "Server Owner unverified", http.StatusServiceUnavailable)
		return
	}
	scope := dsmOwnerScope(key, principal, r.Header.Get("Cookie"),
		r.Host, connection.Server, connection.Username)
	if scope == "" || subtle.ConstantTimeCompare([]byte(scope), []byte(input.OwnerScope)) != 1 {
		http.Error(w, "Server Owner scope changed", http.StatusConflict)
		return
	}
	if nasRoot == "" {
		nasRoot = "/"
	}
	path, err := resolveNASSharePreflight(ctx, nasRoot, key, principal,
		r.Header.Get("Cookie"), r.Host, input.SelectionID)
	if err != nil {
		http.Error(w, "NAS share selection unavailable", http.StatusConflict)
		return
	}
	if err := bootstrap.PreflightLocalRoot(ctx, path); err != nil {
		http.Error(w, "native Root preflight failed", http.StatusServiceUnavailable)
		return
	}
	if quota, err := quotaReader.OwnerQuota(ctx); err != nil || !localbackupipc.ValidateOwnerQuota(quota) {
		http.Error(w, "current Server Owner verification unavailable", http.StatusServiceUnavailable)
		return
	}
	drafts, err := reader.LocalDrafts(ctx)
	if err != nil || len(drafts) > 100 {
		http.Error(w, "creating-device draft proof unavailable", http.StatusServiceUnavailable)
		return
	}
	// The read-only DSM draft view already requires a complete, ordered
	// first-bind inventory. Recheck the same contract at this mutation
	// boundary: an older or malformed Agent response cannot authorize a
	// Root merely because one numeric Source ID happens to match.
	found := false
	var previous uint64
	for _, draft := range drafts {
		if !localbackupipc.ValidSourceID(draft.SourceID) ||
			draft.SourceID <= previous || draft.Revision != 1 ||
			draft.Created.IsZero() || !utf8.ValidString(draft.Name) ||
			len([]byte(draft.Name)) < 1 || len([]byte(draft.Name)) > 128 ||
			strings.TrimSpace(draft.Name) != draft.Name ||
			strings.ContainsAny(draft.Name, "\x00\r\n") {
			http.Error(w, "invalid owning Agent native draft inventory", http.StatusServiceUnavailable)
			return
		}
		if draft.SourceID == input.SourceID {
			found = true
		}
		previous = draft.SourceID
	}
	if !found {
		http.Error(w, "Source is not a current original-device unbound draft", http.StatusConflict)
		return
	}
	// Keep both the original device's Source authority and the selected
	// Owner fixed before the irreversible native Root binding attempt.
	latest, err := owner.ServerConnection(ctx)
	if err != nil || !latest.Configured || latest.MustChangePassword ||
		subtle.ConstantTimeCompare([]byte(scope), []byte(dsmOwnerScope(
			key, principal, r.Header.Get("Cookie"), r.Host,
			latest.Server, latest.Username))) != 1 {
		http.Error(w, "Owner changed before native bind", http.StatusConflict)
		return
	}
	grant, err := bootstrap.AuthorizeLocalRoot(ctx, input.SourceID, path)
	state := "needs_inspection"
	if err == nil && grant.SourceID == input.SourceID && grant.Path == path &&
		grant.Status == "awaiting_executor" && grant.StrongIdentity {
		state = "authorized"
	}
	after, checkErr := owner.ServerConnection(ctx)
	if checkErr != nil || !after.Configured || after.MustChangePassword ||
		subtle.ConstantTimeCompare([]byte(scope), []byte(dsmOwnerScope(
			key, principal, r.Header.Get("Cookie"), r.Host,
			after.Server, after.Username))) != 1 {
		state = "needs_inspection"
	}
	// A failed/ambiguous Agent reply may have completed binding. Never
	// retry it, never present an unavailable receipt as confirmed.
	sendJSON(w, map[string]any{"source_id": input.SourceID, "state": state})
}
