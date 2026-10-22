package client

import (
	"context"
	"fmt"
	"strings"
)

func canonicalStreamSHA256(value string) bool {
	if len(value) != 64 {
		return false
	}
	for i := 0; i < len(value); i++ {
		b := value[i]
		if !(b >= '0' && b <= '9') && !(b >= 'a' && b <= 'f') {
			return false
		}
	}
	return true
}

// UploadStreamResumableVerifiedResult is the shared ordinary upload engine's
// strict entry for a verified source snapshot (including future local Push).
// It uses the SAME /uploads Session/chunk/finalize CAS and FileVersion path;
// unlike the legacy stream method it requires a known SHA-256 and stable
// operation-scoped resume key. It does not issue a durable Push completion.
// The caller must provide a trusted offset opener pinned to the same file.
func (c *Client) UploadStreamResumableVerifiedResult(ctx context.Context,
	init UploadInit, open UploadStreamOpen, progress UploadProgress,
) (UploadResult, error) {
	if c == nil || ctx == nil || ctx.Err() != nil || init.Size < 0 ||
		!canonicalStreamSHA256(init.SHA256) || init.ResumeKey == "" ||
		len(init.ResumeKey) > 128 || strings.TrimSpace(init.ResumeKey) != init.ResumeKey ||
		strings.ContainsAny(init.ResumeKey, "\x00\r\n") ||
		(init.ParentID == nil) == (init.NodeID == nil) ||
		(init.Size > 0 && open == nil) ||
		(init.ConflictPolicy != "" && init.ConflictPolicy != UploadConflictPolicyFail) {
		return UploadResult{}, fmt.Errorf("invalid verified stream upload")
	}
	if init.ParentID != nil {
		if *init.ParentID == 0 || init.Name == "" || init.ExpectedRevision != 0 {
			return UploadResult{}, fmt.Errorf("invalid verified upload parent")
		}
	} else if *init.NodeID == 0 || init.ExpectedRevision == 0 || init.Name != "" {
		return UploadResult{}, fmt.Errorf("invalid verified upload target revision")
	}
	if init.ChunkSize == 0 {
		init.ChunkSize = DefaultUploadChunkSize
	}
	if init.ChunkSize < 4<<20 || init.ChunkSize > 16<<20 {
		return UploadResult{}, fmt.Errorf("invalid verified upload chunk size")
	}
	result, err := c.uploadStreamResult(ctx, init, open, progress)
	if err != nil {
		return UploadResult{}, err
	}
	// A resumed session can project the currently live Node, which may have
	// changed since its own finalize. Never accept that projection as a
	// historical Push operation receipt without checking immutable content.
	if result.Skipped || result.Node.ID == 0 || result.Node.Type != "file" ||
		result.Node.Size != init.Size || result.SHA256 != init.SHA256 ||
		result.Node.SHA256 != init.SHA256 {
		return UploadResult{}, fmt.Errorf("verified stream upload result does not match original content")
	}
	if init.NodeID != nil {
		if result.Node.ID != *init.NodeID || result.Node.Revision != init.ExpectedRevision+1 {
			return UploadResult{}, fmt.Errorf("verified stream upload result has wrong target revision")
		}
	} else if result.Node.ParentID == nil || *result.Node.ParentID != *init.ParentID ||
		result.Node.Name != init.Name || result.Node.Revision != 1 {
		return UploadResult{}, fmt.Errorf("verified stream upload result has wrong create target")
	}
	return result, nil
}
