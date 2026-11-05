package synologyui

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

const dsmOwnerNotesBodyMax = 7 << 20

type OwnerNotesAgent interface {
	OwnerNotesInitialize(context.Context) (client.NotesNamespace, error)
	OwnerNotesList(context.Context, string, string, int) (client.NotesPage, error)
	OwnerNotesRead(context.Context, string) (client.NotesDetail, error)
	OwnerNotesCreate(context.Context, client.NotesWrite) (client.NotesRow, error)
	OwnerNotesImportIOS(context.Context, client.NotesImportWrite) (client.NotesRow, error)
	OwnerNotesUpdate(context.Context, string, client.NotesWrite) (client.NotesRow, error)
	OwnerNotesDelete(context.Context, string, uint64) error
	OwnerNotesVersions(context.Context, string) (client.NotesVersions, error)
	OwnerNotesReadVersion(context.Context, uint64, uint64) (string, error)
}

func isDSMOwnerNotesRoute(path string) bool {
	switch path {
	case "/v1/cloud-notes-capability", "/v1/cloud-notes-namespace", "/v1/cloud-notes-list", "/v1/cloud-notes-read",
		"/v1/cloud-notes-create", "/v1/cloud-notes-import-ios", "/v1/cloud-notes-save", "/v1/cloud-notes-delete",
		"/v1/cloud-notes-versions", "/v1/cloud-notes-history":
		return true
	}
	return false
}

func isDSMOwnerNotesWrite(path string) bool {
	switch path {
	case "/v1/cloud-notes-namespace", "/v1/cloud-notes-create", "/v1/cloud-notes-import-ios",
		"/v1/cloud-notes-save", "/v1/cloud-notes-delete":
		return true
	}
	return false
}

func validDSMNotesImportIdentity(value string) bool {
	if value == "" {
		return true
	}
	const prefix = "manual:"
	if !strings.HasPrefix(value, prefix) {
		return false
	}
	raw := strings.TrimPrefix(value, prefix)
	id, err := uuid.Parse(raw)
	return err == nil && id.String() == raw
}

func validDSMNoteID(value string) bool {
	id, err := uuid.Parse(value)
	return err == nil && id.String() == value
}

func notesQuery(r *http.Request, fields ...string) (url.Values, bool) {
	if r.URL.RawQuery == "" {
		return nil, false
	}
	v, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(v) != len(fields) {
		return nil, false
	}
	allowed := make(map[string]bool, len(fields))
	for _, field := range fields {
		allowed[field] = true
	}
	for field, items := range v {
		if !allowed[field] || len(items) != 1 {
			return nil, false
		}
	}
	return v, true
}

type dsmNotesMutation struct {
	OwnerScope       string
	ID               string
	Title            string
	Markdown         string
	ExternalID       string
	ExpectedRevision uint64
	Revision         uint64
}

func parseDSMNotesMutation(r *http.Request) (dsmNotesMutation, error) {
	var out dsmNotesMutation
	if r == nil || r.URL == nil || r.URL.RawQuery != "" || r.Body == nil ||
		r.ContentLength < 2 || r.ContentLength > dsmOwnerNotesBodyMax {
		return out, errors.New("invalid DSM Notes request size")
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, dsmOwnerNotesBodyMax+1))
	if err != nil || len(raw) > dsmOwnerNotesBodyMax || int64(len(raw)) != r.ContentLength {
		return out, errors.New("invalid DSM Notes mutation body")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	first, err := dec.Token()
	if err != nil || first != json.Delim('{') {
		return out, errors.New("DSM Notes mutation must be a JSON object")
	}
	seen := map[string]bool{}
	for dec.More() {
		field, err := dec.Token()
		key, ok := field.(string)
		if err != nil || !ok || seen[key] {
			return dsmNotesMutation{}, errors.New("duplicated DSM Notes mutation field")
		}
		seen[key] = true
		switch key {
		case "owner_scope":
			err = dec.Decode(&out.OwnerScope)
		case "id":
			err = dec.Decode(&out.ID)
		case "title":
			err = dec.Decode(&out.Title)
		case "markdown":
			err = dec.Decode(&out.Markdown)
		case "external_id":
			err = dec.Decode(&out.ExternalID)
		case "expected_revision":
			err = dec.Decode(&out.ExpectedRevision)
		case "revision":
			err = dec.Decode(&out.Revision)
		default:
			return dsmNotesMutation{}, errors.New("unrecognized DSM Notes mutation field")
		}
		if err != nil {
			return dsmNotesMutation{}, errors.New("invalid DSM Notes mutation field")
		}
	}
	last, err := dec.Token()
	if err != nil || last != json.Delim('}') {
		return dsmNotesMutation{}, errors.New("incomplete DSM Notes JSON")
	}
	if _, err := dec.Token(); err != io.EOF {
		return dsmNotesMutation{}, errors.New("trailing DSM Notes JSON")
	}
	if !seen["owner_scope"] || !nasSelectionID.MatchString(out.OwnerScope) {
		return dsmNotesMutation{}, errors.New("Owner Notes scope is invalid")
	}
	switch r.URL.Path {
	case "/v1/cloud-notes-namespace":
		if len(seen) != 1 {
			return out, errors.New("invalid Notes namespace fields")
		}
	case "/v1/cloud-notes-create", "/v1/cloud-notes-import-ios", "/v1/cloud-notes-save":
		expected := 3
		if r.URL.Path == "/v1/cloud-notes-save" {
			expected = 5
		} else if r.URL.Path == "/v1/cloud-notes-import-ios" {
			expected = 4
		}
		if len(seen) != expected || !seen["title"] || !seen["markdown"] ||
			(r.URL.Path == "/v1/cloud-notes-save" &&
				(!seen["id"] || !validDSMNoteID(out.ID) ||
					!seen["expected_revision"] || out.ExpectedRevision == 0)) ||
			(r.URL.Path == "/v1/cloud-notes-import-ios" &&
				(!seen["external_id"] || !validDSMNotesImportIdentity(out.ExternalID))) {
			return out, errors.New("invalid Notes write fields")
		}
		if strings.TrimSpace(out.Title) == "" || len([]byte(out.Title)) > 255 ||
			!utf8.ValidString(out.Title) || !utf8.ValidString(out.Markdown) ||
			len([]byte(out.Markdown)) > client.NotesMaxMarkdownBytes {
			return out, errors.New("Notes Markdown size or UTF-8 invalid")
		}
		for _, r := range out.Title {
			if r < 32 || r == 127 {
				return dsmNotesMutation{}, errors.New("Notes title contains control characters")
			}
		}
		if strings.ContainsRune(out.Markdown, 0) {
			return out, errors.New("Notes Markdown contains NUL")
		}
	case "/v1/cloud-notes-delete":
		if len(seen) != 3 || !seen["id"] || !seen["revision"] ||
			!validDSMNoteID(out.ID) || out.Revision == 0 {
			return out, errors.New("invalid Notes deletion fields")
		}
	default:
		return out, errors.New("unsupported Notes mutation")
	}
	return out, nil
}

func serveDSMOwnerNotes(w http.ResponseWriter, r *http.Request, ctx context.Context,
	agent Agent, key []byte, principal string) {
	notes, ok := agent.(OwnerNotesAgent)
	capable, capabilityOK := agent.(interface{ OwnerNotesAvailable() bool })
	login, loginOK := agent.(ServerLoginAgent)
	if !ok || !loginOK || !capabilityOK || !capable.OwnerNotesAvailable() {
		http.Error(w, "Owner Notes Agent capability unavailable", http.StatusNotImplemented)
		return
	}
	// Each request is tied to the owning Agent's verified live Server profile.
	before, err := login.ServerConnection(ctx)
	if err != nil || !before.Configured || before.MustChangePassword {
		http.Error(w, "Owner Notes Server session unavailable", http.StatusServiceUnavailable)
		return
	}
	var input dsmNotesMutation
	if isDSMOwnerNotesWrite(r.URL.Path) {
		input, err = parseDSMNotesMutation(r)
		if err != nil {
			http.Error(w, "invalid Owner Notes mutation", http.StatusBadRequest)
			return
		}
		expected := dsmOwnerScope(key, principal, r.Header.Get("Cookie"), r.Host,
			before.Server, before.Username)
		if expected == "" || expected != input.OwnerScope {
			http.Error(w, "Notes Owner changed; reload before writing", http.StatusConflict)
			return
		}
		quota, quotaOK := agent.(OwnerQuotaReader)
		if !quotaOK {
			http.Error(w, "Notes Owner preflight unavailable", http.StatusNotImplemented)
			return
		}
		available, quotaErr := quota.OwnerQuota(ctx)
		if quotaErr != nil || !localbackupipc.ValidateOwnerQuota(available) {
			http.Error(w, "Notes Owner is not verified", http.StatusServiceUnavailable)
			return
		}
		current, currentErr := login.ServerConnection(ctx)
		if currentErr != nil || !current.Configured || current.Server != before.Server ||
			current.Username != before.Username || current.MustChangePassword {
			http.Error(w, "Notes Owner changed before mutation", http.StatusConflict)
			return
		}
	}

	var output any
	switch r.URL.Path {
	case "/v1/cloud-notes-capability":
		if r.URL.RawQuery != "" {
			http.Error(w, "invalid Notes capability query", http.StatusBadRequest)
			return
		}
		output = map[string]bool{"available": true}
	case "/v1/cloud-notes-namespace":
		output, err = notes.OwnerNotesInitialize(ctx)
	case "/v1/cloud-notes-create":
		output, err = notes.OwnerNotesCreate(ctx,
			client.NotesWrite{Title: input.Title, Markdown: input.Markdown})
	case "/v1/cloud-notes-import-ios":
		output, err = notes.OwnerNotesImportIOS(ctx,
			client.NotesImportWrite{Title: input.Title, Markdown: input.Markdown, ExternalID: input.ExternalID})
	case "/v1/cloud-notes-save":
		output, err = notes.OwnerNotesUpdate(ctx, input.ID,
			client.NotesWrite{Title: input.Title, Markdown: input.Markdown,
				ExpectedRevision: input.ExpectedRevision})
	case "/v1/cloud-notes-delete":
		err = notes.OwnerNotesDelete(ctx, input.ID, input.Revision)
		output = map[string]bool{"deleted": true}
	case "/v1/cloud-notes-list":
		query, good := notesQuery(r, "source", "q", "offset")
		if !good {
			http.Error(w, "invalid Notes list query", http.StatusBadRequest)
			return
		}
		offset, parseErr := strconv.Atoi(query.Get("offset"))
		if parseErr != nil || strconv.Itoa(offset) != query.Get("offset") ||
			offset < 0 || offset > 10000000 || offset%client.NotesMaxPageSize != 0 {
			http.Error(w, "invalid Notes offset", http.StatusBadRequest)
			return
		}
		output, err = notes.OwnerNotesList(ctx, query.Get("source"), query.Get("q"), offset)
	case "/v1/cloud-notes-read", "/v1/cloud-notes-versions":
		query, good := notesQuery(r, "id")
		if !good || !validDSMNoteID(query.Get("id")) {
			http.Error(w, "invalid Notes ID", http.StatusBadRequest)
			return
		}
		if r.URL.Path == "/v1/cloud-notes-read" {
			output, err = notes.OwnerNotesRead(ctx, query.Get("id"))
		} else {
			output, err = notes.OwnerNotesVersions(ctx, query.Get("id"))
		}
	case "/v1/cloud-notes-history":
		query, good := notesQuery(r, "node_id", "version_id")
		if !good {
			http.Error(w, "invalid Notes history query", http.StatusBadRequest)
			return
		}
		nodeID, nodeErr := strconv.ParseUint(query.Get("node_id"), 10, 64)
		versionID, versionErr := strconv.ParseUint(query.Get("version_id"), 10, 64)
		if nodeErr != nil || versionErr != nil || !localbackupipc.ValidOwnerFileID(nodeID) ||
			versionID == 0 || strconv.FormatUint(nodeID, 10) != query.Get("node_id") ||
			strconv.FormatUint(versionID, 10) != query.Get("version_id") {
			http.Error(w, "invalid Notes history selector", http.StatusBadRequest)
			return
		}
		var markdown string
		markdown, err = notes.OwnerNotesReadVersion(ctx, nodeID, versionID)
		output = map[string]string{"markdown": markdown}
	default:
		http.NotFound(w, r)
		return
	}
	if err != nil {
		// An unknown mutation ACK may have committed; do not pretend it failed
		// before commit or expose a reusable automatic retry instruction.
		http.Error(w, "Owner Notes operation failed or is unverified", http.StatusConflict)
		return
	}
	after, err := login.ServerConnection(ctx)
	if err != nil || !after.Configured || after.MustChangePassword ||
		after.Server != before.Server || after.Username != before.Username {
		http.Error(w, "Notes Owner changed during request; reload before retry", http.StatusConflict)
		return
	}
	sendJSON(w, output)
}
