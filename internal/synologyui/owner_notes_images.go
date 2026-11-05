package synologyui

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

const dsmNotesImageUploadJSONMax = (client.NotesMaxImageBytes+2)/3*4 + 8192

// OwnerNotesImagesAgent has two fixed methods and no generic URL/path proxy.
// The local Agent and Server authenticate the same Owner at each hop.
type OwnerNotesImagesAgent interface {
	OwnerNotesImagesAvailable() bool
	OwnerNotesUploadImage(context.Context, string, []byte) (client.NotesImageReceipt, error)
	OwnerNotesImportIOSImage(context.Context, string, []byte) (client.NotesImageReceipt, error)
	OwnerNotesReadImage(context.Context, string, string) (localbackupipc.OwnerNotesImageData, error)
}

func isDSMOwnerNotesImageRoute(path string) bool {
	switch path {
	case "/v1/cloud-notes-image-capability", "/v1/cloud-notes-image-upload", "/v1/cloud-notes-image-import", "/v1/cloud-notes-image-read":
		return true
	}
	return false
}

func isDSMOwnerNotesImageWrite(path string) bool {
	return path == "/v1/cloud-notes-image-upload" || path == "/v1/cloud-notes-image-import"
}

type dsmNotesImageMutation struct {
	OwnerScope string
	ID         string
	Image      []byte
}

func parseDSMNotesImageMutation(r *http.Request) (dsmNotesImageMutation, error) {
	var out dsmNotesImageMutation
	if r == nil || r.URL == nil || (r.URL.Path != "/v1/cloud-notes-image-upload" && r.URL.Path != "/v1/cloud-notes-image-import") ||
		r.URL.RawQuery != "" || r.Body == nil ||
		r.ContentLength < 2 || r.ContentLength > dsmNotesImageUploadJSONMax {
		return out, errors.New("invalid DSM Notes image upload size")
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, dsmNotesImageUploadJSONMax+1))
	if err != nil || len(raw) > dsmNotesImageUploadJSONMax || int64(len(raw)) != r.ContentLength {
		return out, errors.New("invalid DSM Notes image body")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	begin, err := dec.Token()
	if err != nil || begin != json.Delim('{') {
		return out, errors.New("Notes image upload requires a JSON object")
	}
	seen := map[string]bool{}
	for dec.More() {
		field, err := dec.Token()
		key, ok := field.(string)
		if err != nil || !ok || seen[key] {
			return dsmNotesImageMutation{}, errors.New("invalid or duplicate Notes image JSON field")
		}
		seen[key] = true
		switch key {
		case "owner_scope":
			err = dec.Decode(&out.OwnerScope)
		case "id":
			err = dec.Decode(&out.ID)
		case "image":
			err = dec.Decode(&out.Image)
		default:
			return dsmNotesImageMutation{}, errors.New("unexpected Notes image field")
		}
		if err != nil {
			return dsmNotesImageMutation{}, errors.New("invalid Notes image field data")
		}
	}
	end, err := dec.Token()
	if err != nil || end != json.Delim('}') {
		return dsmNotesImageMutation{}, errors.New("incomplete Notes image JSON")
	}
	if _, err := dec.Token(); err != io.EOF {
		return dsmNotesImageMutation{}, errors.New("trailing Notes image JSON")
	}
	if len(seen) != 3 || !seen["owner_scope"] || !seen["id"] || !seen["image"] ||
		!nasSelectionID.MatchString(out.OwnerScope) || !validDSMNoteID(out.ID) ||
		len(out.Image) == 0 || len(out.Image) > client.NotesMaxImageBytes {
		return dsmNotesImageMutation{}, errors.New("unsafe Notes image upload selector or bytes")
	}
	return out, nil
}

func serveDSMOwnerNotesImage(w http.ResponseWriter, r *http.Request, ctx context.Context,
	agent Agent, key []byte, principal string) {
	images, ok := agent.(OwnerNotesImagesAgent)
	login, loginOK := agent.(ServerLoginAgent)
	if !ok || !loginOK || !images.OwnerNotesImagesAvailable() {
		http.Error(w, "Owner Notes image Agent capability unavailable", http.StatusNotImplemented)
		return
	}
	before, err := login.ServerConnection(ctx)
	if err != nil || !before.Configured || before.MustChangePassword {
		http.Error(w, "Notes image Owner session unavailable", http.StatusServiceUnavailable)
		return
	}
	var output any
	switch r.URL.Path {
	case "/v1/cloud-notes-image-capability":
		if r.URL.RawQuery != "" {
			http.Error(w, "invalid Notes image capability query", http.StatusBadRequest)
			return
		}
		output = map[string]bool{"available": true}
	case "/v1/cloud-notes-image-upload":
		input, parseErr := parseDSMNotesImageMutation(r)
		if parseErr != nil {
			http.Error(w, "invalid Notes image request", http.StatusBadRequest)
			return
		}
		wantScope := dsmOwnerScope(key, principal, r.Header.Get("Cookie"), r.Host,
			before.Server, before.Username)
		if wantScope == "" || subtle.ConstantTimeCompare([]byte(wantScope), []byte(input.OwnerScope)) != 1 {
			http.Error(w, "Notes image Owner changed; reload before upload", http.StatusConflict)
			return
		}
		quota, quotaOK := agent.(OwnerQuotaReader)
		if !quotaOK {
			http.Error(w, "Notes Owner quota check unavailable", http.StatusNotImplemented)
			return
		}
		q, qerr := quota.OwnerQuota(ctx)
		if qerr != nil || !localbackupipc.ValidateOwnerQuota(q) {
			http.Error(w, "Notes image Owner quota unverified", http.StatusServiceUnavailable)
			return
		}
		check, checkErr := login.ServerConnection(ctx)
		if checkErr != nil || !check.Configured || check.MustChangePassword ||
			check.Server != before.Server || check.Username != before.Username {
			http.Error(w, "Notes image Owner changed before upload", http.StatusConflict)
			return
		}
		output, err = images.OwnerNotesUploadImage(ctx, input.ID, input.Image)
	case "/v1/cloud-notes-image-import":
		input, parseErr := parseDSMNotesImageMutation(r)
		if parseErr != nil {
			http.Error(w, "invalid iOS Notes image import request", http.StatusBadRequest)
			return
		}
		wantScope := dsmOwnerScope(key, principal, r.Header.Get("Cookie"), r.Host,
			before.Server, before.Username)
		if wantScope == "" || subtle.ConstantTimeCompare([]byte(wantScope), []byte(input.OwnerScope)) != 1 {
			http.Error(w, "Notes Owner changed; reload before image import", http.StatusConflict)
			return
		}
		quota, quotaOK := agent.(OwnerQuotaReader)
		if !quotaOK {
			http.Error(w, "Notes Owner quota check unavailable", http.StatusNotImplemented)
			return
		}
		q, qerr := quota.OwnerQuota(ctx)
		if qerr != nil || !localbackupipc.ValidateOwnerQuota(q) {
			http.Error(w, "Notes image Owner quota unverified", http.StatusServiceUnavailable)
			return
		}
		check, checkErr := login.ServerConnection(ctx)
		if checkErr != nil || !check.Configured || check.MustChangePassword ||
			check.Server != before.Server || check.Username != before.Username {
			http.Error(w, "Notes image Owner changed before import", http.StatusConflict)
			return
		}
		output, err = images.OwnerNotesImportIOSImage(ctx, input.ID, input.Image)
	case "/v1/cloud-notes-image-read":
		params, good := notesQuery(r, "id", "relative_path")
		if !good || !validDSMNoteID(params.Get("id")) {
			http.Error(w, "invalid Notes image ID", http.StatusBadRequest)
			return
		}
		if _, _, valid := client.NotesImageFilename(params.Get("id"),
			params.Get("relative_path")); !valid {
			http.Error(w, "invalid Notes image path", http.StatusBadRequest)
			return
		}
		output, err = images.OwnerNotesReadImage(ctx, params.Get("id"), params.Get("relative_path"))
	default:
		http.NotFound(w, r)
		return
	}
	if err != nil {
		// An upload ACK may be lost after committing. Do not automatically retry.
		http.Error(w, "Owner Notes image operation failed or is unverified", http.StatusConflict)
		return
	}
	after, err := login.ServerConnection(ctx)
	if err != nil || !after.Configured || after.MustChangePassword ||
		after.Server != before.Server || after.Username != before.Username {
		http.Error(w, "Notes image Owner changed during request", http.StatusConflict)
		return
	}
	sendJSON(w, output)
}
