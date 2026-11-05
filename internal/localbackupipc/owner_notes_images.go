package localbackupipc

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
)

// OwnerNotesImageData carries only verified, bounded immutable image bytes.
// Neither a Server token nor a browser-controlled path enters this port.
type OwnerNotesImageData struct {
	ContentType string `json:"content_type"`
	Bytes       int64  `json:"bytes"`
	SHA256      string `json:"sha256"`
	Image       []byte `json:"image"`
}

const ownerNotesImageIPCReplyMax = (client.NotesMaxImageBytes+2)/3*4 + 8192

// Notes images must be independently advertised by the owning Agent.
// A text-only Backup-only Agent does not unlock image uploads or reads.
func (c *Client) OwnerNotesImagesAvailable() bool {
	return c != nil && hasCapability(c.capabilities, "cloud-notes") &&
		hasCapability(c.capabilities, "cloud-notes-images")
}

func (c *Client) requireOwnerNotesImages(ctx context.Context, noteID string) error {
	if c == nil || c.http == nil || ctx == nil || ctx.Err() != nil ||
		!hasCapability(c.capabilities, "cloud-notes") ||
		!hasCapability(c.capabilities, "cloud-notes-images") {
		return errors.New("owning Agent Notes image capability unavailable")
	}
	id, err := uuid.Parse(noteID)
	if err != nil || id.String() != noteID {
		return errors.New("invalid Owner Notes image identity")
	}
	return nil
}

// OwnerNotesUploadImage sends one bounded image to the existing same-user,
// loopback-authenticated Agent. A lost mutation ACK is never replayed.
func (c *Client) OwnerNotesUploadImage(
	ctx context.Context, noteID string, image []byte,
) (client.NotesImageReceipt, error) {
	var empty client.NotesImageReceipt
	if err := c.requireOwnerNotesImages(ctx, noteID); err != nil {
		return empty, err
	}
	if len(image) == 0 || len(image) > client.NotesMaxImageBytes {
		return empty, errors.New("Owner Notes image exceeds 20 MiB")
	}
	var out client.NotesImageReceipt
	if err := c.request(ctx, http.MethodPost,
		"/v1/cloud/notes/"+noteID+"/images",
		struct {
			Image []byte `json:"image"`
		}{Image: image}, &out); err != nil {
		return empty, err
	}
	filename, mime, ok := client.NotesImageFilename(noteID, out.RelativePath)
	sum := sha256.Sum256(image)
	if !ok || out.NodeID == 0 || out.Filename != filename ||
		out.ContentType != mime || out.Bytes != int64(len(image)) ||
		!strings.EqualFold(out.SHA256, hex.EncodeToString(sum[:])) {
		return empty, errors.New("unverified Owner Notes image upload receipt")
	}
	return out, nil
}

// OwnerNotesReadImage permits only the same-Note immutable asset selector.
// IPC responses exceed the ordinary 1 MiB JSON limit, so this one method
// reads at most 20 MiB of decoded image bytes plus bounded Base64 framing.
// The Agent must have verified the Server's MIME and digest first; this
// caller validates the bytes independently before returning them to DSM.
// OwnerNotesImportIOSImage appends one bounded image to a read-only iOS
// archive. It is a separate fixed Agent route from editable Mine images.
func (c *Client) OwnerNotesImportIOSImage(
	ctx context.Context, noteID string, image []byte,
) (client.NotesImageReceipt, error) {
	var empty client.NotesImageReceipt
	if err := c.requireOwnerNotesImages(ctx, noteID); err != nil {
		return empty, err
	}
	if len(image) == 0 || len(image) > client.NotesMaxImageBytes {
		return empty, errors.New("Owner iOS Notes image exceeds 20 MiB")
	}
	var out client.NotesImageReceipt
	path := "/v1/cloud/notes/ios-import/" + noteID + "/images"
	if err := c.request(ctx, http.MethodPost, path, struct {
		Image []byte `json:"image"`
	}{Image: image}, &out); err != nil {
		return empty, err
	}
	filename, mime, ok := client.NotesImageFilename(noteID, out.RelativePath)
	sum := sha256.Sum256(image)
	if !ok || out.NodeID == 0 || out.Filename != filename ||
		out.ContentType != mime || out.Bytes != int64(len(image)) ||
		!strings.EqualFold(out.SHA256, hex.EncodeToString(sum[:])) {
		return empty, errors.New("unverified Owner iOS Notes image import receipt")
	}
	return out, nil
}

func (c *Client) OwnerNotesReadImage(
	ctx context.Context, noteID, relativePath string,
) (OwnerNotesImageData, error) {
	var empty OwnerNotesImageData
	if err := c.requireOwnerNotesImages(ctx, noteID); err != nil {
		return empty, err
	}
	_, mime, ok := client.NotesImageFilename(noteID, relativePath)
	if !ok {
		return empty, errors.New("unsafe or cross-Note image selector")
	}
	// The only request argument is a fixed relative path, never an URL.
	path := "/v1/cloud/notes/" + noteID + "/images"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		c.baseURL+path+"?relative_path="+url.QueryEscape(relativePath), nil)
	if err != nil {
		return empty, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return empty, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return empty, &AgentHTTPStatusError{Method: http.MethodGet, StatusCode: resp.StatusCode}
	}
	if strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0]) != "application/json" ||
		resp.ContentLength > int64(ownerNotesImageIPCReplyMax) {
		return empty, errors.New("invalid Owner Notes image IPC content type or size")
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, int64(ownerNotesImageIPCReplyMax+1)))
	if err != nil || len(raw) > ownerNotesImageIPCReplyMax {
		return empty, errors.New("oversized or unreadable Owner Notes image IPC response")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var out OwnerNotesImageData
	if err := decoder.Decode(&out); err != nil {
		return empty, errors.New("malformed Owner Notes image IPC response")
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return empty, errors.New("trailing Owner Notes image IPC data")
	}
	if out.ContentType != mime || out.Bytes != int64(len(out.Image)) ||
		out.Bytes < 1 || out.Bytes > client.NotesMaxImageBytes {
		return empty, errors.New("Owner Notes image byte count or MIME mismatch")
	}
	sum := sha256.Sum256(out.Image)
	if !strings.EqualFold(out.SHA256, hex.EncodeToString(sum[:])) {
		return empty, errors.New("Owner Notes image SHA-256 mismatch")
	}
	return out, nil
}
