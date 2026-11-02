package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"strings"
	"unicode/utf8"

	"github.com/lazyxu/xdrive/internal/client"
)

const (
	dsmOwnerSmallUploadMaxBytes  = 4 << 20
	dsmOwnerSmallUploadJSONBytes = 6 << 20
)

// A bounded DSM browser payload, never a local-path upload instruction.
type agentOwnerSmallUploadInput struct {
	ParentID uint64 `json:"parent_id"`
	Name     string `json:"name"`
	SHA256   string `json:"sha256"`
	Data     []byte `json:"data"`
}

func validAgentOwnerSmallUpload(v agentOwnerSmallUploadInput) bool {
	if v.ParentID == 0 || v.ParentID > 1<<53-1 ||
		v.Name == "" || v.Name != strings.TrimSpace(v.Name) ||
		len(v.Name) > 255 || !utf8.ValidString(v.Name) ||
		v.Name == "." || v.Name == ".." || strings.ContainsAny(v.Name, "/\\") ||
		len(v.Data) < 1 || len(v.Data) > dsmOwnerSmallUploadMaxBytes ||
		len(v.SHA256) != 64 {
		return false
	}
	for _, ch := range v.Name {
		if ch < 32 || ch == 127 {
			return false
		}
	}
	sha := sha256.Sum256(v.Data)
	return hex.EncodeToString(sha[:]) == v.SHA256
}

// The Agent creates the temporary file; the DSM browser cannot specify a
// native filesystem path. The original Server CAS upload writer is reused.
func stageAgentOwnerSmallUpload(ctx context.Context, input agentOwnerSmallUploadInput,
	run func(context.Context, uint64, string, string) (client.Node, error),
) (client.Node, error) {
	if ctx == nil || ctx.Err() != nil || run == nil || !validAgentOwnerSmallUpload(input) {
		return client.Node{}, errors.New("invalid bounded Owner upload")
	}
	f, err := os.CreateTemp("", "xdrive-dsm-owner-upload-")
	if err != nil {
		return client.Node{}, err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(input.Data); err != nil {
		_ = f.Close()
		return client.Node{}, err
	}
	if err = f.Sync(); err != nil {
		_ = f.Close()
		return client.Node{}, err
	}
	if err = f.Close(); err != nil {
		return client.Node{}, err
	}
	if err = ctx.Err(); err != nil {
		return client.Node{}, err
	}
	return run(ctx, input.ParentID, f.Name(), input.Name)
}

func (h *desktopIPCHandler) cloudOwnerSmallUpload(w http.ResponseWriter, r *http.Request) {
	if r.ContentLength < 2 || r.ContentLength > dsmOwnerSmallUploadJSONBytes {
		writeDesktopIPCError(w, http.StatusRequestEntityTooLarge, "invalid_owner_upload", "bounded file body required")
		return
	}
	var input agentOwnerSmallUploadInput
	if !decodeDesktopIPCJSONLimit(w, r, &input, dsmOwnerSmallUploadJSONBytes) {
		return
	}
	if !validAgentOwnerSmallUpload(input) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_owner_upload", "invalid Owner file bytes or selector")
		return
	}
	node, err := stageAgentOwnerSmallUpload(r.Context(), input,
		func(ctx context.Context, parentID uint64, localPath, name string) (client.Node, error) {
			result, err := h.ctrl.CloudUploadWithConflictPolicy(ctx, parentID, localPath, name, "fail")
			if err != nil {
				return client.Node{}, err
			}
			if result.Skipped {
				return client.Node{}, errors.New("Owner upload was skipped")
			}
			return result.Node, nil
		})
	if err != nil {
		writeDesktopIPCError(w, http.StatusConflict, "owner_upload_unverified", "Owner file upload failed or outcome uncertain; refresh before retry")
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, node)
}
