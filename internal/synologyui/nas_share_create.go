package synologyui

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"errors"
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
	CreateLocalBackupSource(context.Context, string, uint64) (localbackupipc.LocalBackupSource, error)
	AuthorizeLocalRoot(context.Context, uint64, string) (localbackupipc.LocalBackupRootGrant, error)
}

type nasShareCreateInput struct {
	SelectionID string
	OwnerScope  string
	Name        string
	TargetID    uint64
	Confirmed   bool
}

// The only browser authority is one already authenticated NAS selection,
// an Owner cloud target directory ID, an innocuous display name, and explicit
// user consent. Never accept local paths, device IDs, tokens or Root grants.
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
	seen := make(map[string]bool, 5)
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
		case "target_id":
			err = dec.Decode(&value.TargetID)
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
	if err != nil || end != json.Delim('}') || len(seen) != 5 {
		return nasShareCreateInput{}, errors.New("incomplete DSM backup Source setup")
	}
	if _, err := dec.Token(); err != io.EOF {
		return nasShareCreateInput{}, errors.New("trailing DSM backup Source setup data")
	}
	if !nasSelectionID.MatchString(value.SelectionID) ||
		!nasSelectionID.MatchString(value.OwnerScope) ||
		!localbackupipc.ValidSourceID(value.TargetID) ||
		!value.Confirmed || !utf8.ValidString(value.Name) ||
		len([]byte(value.Name)) < 1 || len([]byte(value.Name)) > 128 ||
		value.Name != strings.TrimSpace(value.Name) ||
		strings.ContainsAny(value.Name, "\x00\r\n") {
		return nasShareCreateInput{}, errors.New("invalid DSM backup Source consent or selector")
	}
	return value, nil
}

// A selected cloud target must remain under the same verified Server/Owner
// identity throughout the browser's NAS directory selection and native Source
// mutation. The HMAC is scoped to the active DSM principal/cookie/Host;
// it does not grant any Source, local path or Root authority.
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
