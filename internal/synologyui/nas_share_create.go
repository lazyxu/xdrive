package synologyui

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

// NASShareBootstrapper is the SAME owning Agent used by the restricted-user
// xd backup init command. The DSM CGI must never create a second Runner.
type NASShareBootstrapper interface {
	PreflightLocalRoot(context.Context, string) error
	CreateLocalBackupSource(context.Context, string) (localbackupipc.LocalBackupSource, error)
	AuthorizeLocalRoot(context.Context, uint64, string) (localbackupipc.LocalBackupRootGrant, error)
}

type nasShareCreateInput struct {
	SelectionID string
	OwnerScope  string
	Name        string
	Confirmed   bool
}

// The only browser authority is one already authenticated NAS selection,
// a pinned Server Owner scope, an innocuous display name and explicit user
// consent. The Server provisions the cloud target from the authenticated
// device identity; never accept a caller-selected target, local path, device
// ID, token or Root grant.
func parseNASShareCreate(r *http.Request) (nasShareCreateInput, error) {
	var value nasShareCreateInput
	if r == nil || r.URL == nil || r.URL.RawQuery != "" || r.Body == nil ||
		r.ContentLength < 2 || r.ContentLength > 1024 {
		return value, errors.New("invalid DSM backup Source setup request")
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1025))
	if err != nil || len(body) > 1024 || int64(len(body)) != r.ContentLength {
		return value, errors.New("invalid DSM backup Source setup body")
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	first, err := dec.Token()
	if err != nil || first != json.Delim('{') {
		return value, errors.New("DSM backup Source request must be an object")
	}
	seen := make(map[string]bool, 4)
	for dec.More() {
		field, err := dec.Token()
		key, ok := field.(string)
		if err != nil || !ok || seen[key] {
			return nasShareCreateInput{}, errors.New("duplicate or invalid DSM Source setup field")
		}
		seen[key] = true
		switch key {
		case "selection_id":
			err = dec.Decode(&value.SelectionID)
		case "owner_scope":
			err = dec.Decode(&value.OwnerScope)
		case "name":
			err = dec.Decode(&value.Name)
		case "confirmed":
			err = dec.Decode(&value.Confirmed)
		default:
			return nasShareCreateInput{}, errors.New("unexpected DSM backup Source field")
		}
		if err != nil {
			return nasShareCreateInput{}, errors.New("invalid DSM backup Source setup field")
		}
	}
	end, err := dec.Token()
	if err != nil || end != json.Delim('}') || len(seen) != 4 {
		return nasShareCreateInput{}, errors.New("incomplete DSM backup Source setup")
	}
	if _, err := dec.Token(); err != io.EOF {
		return nasShareCreateInput{}, errors.New("trailing DSM backup Source setup data")
	}
	if !nasSelectionID.MatchString(value.SelectionID) ||
		!nasSelectionID.MatchString(value.OwnerScope) ||
		!value.Confirmed || !utf8.ValidString(value.Name) ||
		len([]byte(value.Name)) < 1 || len([]byte(value.Name)) > 128 ||
		value.Name != strings.TrimSpace(value.Name) ||
		strings.ContainsAny(value.Name, "\x00\r\n") {
		return nasShareCreateInput{}, errors.New("invalid DSM backup Source consent or selector")
	}
	return value, nil
}

// The current Server Owner must remain unchanged throughout the browser's
// NAS share selection and native Source mutation. The HMAC is scoped to the
// active DSM principal/cookie/Host; it grants no Source, local path or Root
// authority and cannot choose the managed cloud destination.
func validManagedNASBackupSource(source localbackupipc.LocalBackupSource, name string) bool {
	return localbackupipc.ValidSourceID(source.ID) && source.Name == name &&
		source.Kind == "local_folder" && source.Direction == "push" &&
		source.SyncMode == "backup" && source.Status == "paused" &&
		source.Revision > 0 && source.TargetManaged && source.TargetNodeID != nil &&
		localbackupipc.ValidSourceID(*source.TargetNodeID) && source.TargetPath != "" &&
		len([]byte(source.TargetPath)) <= 2048 && !strings.ContainsAny(source.TargetPath, "\x00\r\n")
}

func dsmOwnerScope(key []byte, principal, cookie, host, server, username string) string {
	if len(key) != 32 || principal == "" || cookie == "" || host == "" ||
		server == "" || username == "" {
		return ""
	}
	mac := hmac.New(sha256.New, key)
	fmt.Fprintf(mac, "xdrive-dsm-owner-scope-v1\x00%s\x00%s\x00%s\x00%s\x00%s",
		principal, cookie, host, server, username)
	return hex.EncodeToString(mac.Sum(nil))
}
