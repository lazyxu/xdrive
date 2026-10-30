package synologyui

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

// ServerLoginAgent is an explicit same-user capability of the original
// Backup-only Agent. DSM's authenticated browser never gets the IPC bearer.
type ServerLoginAgent interface {
	ServerConnection(context.Context) (localbackupipc.ServerConnection, error)
	LoginServer(context.Context, string, string, string) error
}

type serverLoginInput struct {
	Server   string
	Username string
	Password string
}

// Reject duplicate keys, malformed/trailing JSON, unknown options and
// unbounded passwords before invoking any Agent operation. In particular,
// the browser cannot submit mount_path, trust roots or alternate connection
// routes. Only the original Agent may persist the authenticated session.
func parseServerLogin(r *http.Request) (serverLoginInput, error) {
	var out serverLoginInput
	if r == nil || r.URL == nil || r.URL.RawQuery != "" || r.Body == nil ||
		r.ContentLength < 2 || r.ContentLength > 8192 {
		return out, errors.New("invalid DSM login request")
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, 8193))
	if err != nil || len(data) > 8192 || int64(len(data)) != r.ContentLength {
		return out, errors.New("invalid DSM login body")
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	first, err := dec.Token()
	if err != nil || first != json.Delim('{') {
		return out, errors.New("DSM login must be an object")
	}
	seen := map[string]bool{}
	for dec.More() {
		field, err := dec.Token()
		key, ok := field.(string)
		if err != nil || !ok || seen[key] {
			return serverLoginInput{}, errors.New("duplicate DSM login field")
		}
		seen[key] = true
		switch key {
		case "server":
			err = dec.Decode(&out.Server)
		case "username":
			err = dec.Decode(&out.Username)
		case "password":
			err = dec.Decode(&out.Password)
		default:
			return serverLoginInput{}, errors.New("unknown DSM login field")
		}
		if err != nil {
			return serverLoginInput{}, errors.New("invalid DSM login field")
		}
	}
	last, err := dec.Token()
	if err != nil || last != json.Delim('}') || len(seen) != 3 {
		return serverLoginInput{}, errors.New("incomplete DSM login request")
	}
	if _, err := dec.Token(); err != io.EOF {
		return serverLoginInput{}, errors.New("trailing DSM login JSON")
	}
	if len(out.Server) == 0 || len(out.Server) > 512 ||
		len(out.Username) == 0 || len(out.Username) > 128 ||
		len(out.Password) == 0 || len(out.Password) > 4096 ||
		!utf8.ValidString(out.Password) ||
		strings.ContainsAny(out.Server, "\x00\r\n") ||
		strings.ContainsAny(out.Username, "\x00\r\n") ||
		strings.ContainsAny(out.Password, "\x00\r\n") {
		return serverLoginInput{}, errors.New("invalid DSM login field lengths")
	}
	return out, nil
}
