package client

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
)

// Notes images are immutable Owner Files, not public media URLs. Both Desktop
// and DSM must use this authenticated Client instead of forwarding credentials.
const NotesMaxImageBytes = 20 << 20
const notesImageReplyMaxBytes = 4096

type NotesImageReceipt struct {
	NodeID       uint64 `json:"node_id"`
	Filename     string `json:"filename"`
	RelativePath string `json:"relative_path"`
	ContentType  string `json:"content_type"`
	Bytes        int64  `json:"bytes"`
	SHA256       string `json:"sha256"`
}

func notesImageMIME(filename string) (string, bool) {
	parts := strings.Split(filename, ".")
	if len(parts) != 2 || !validNoteID(parts[0]) {
		return "", false
	}
	switch parts[1] {
	case "png":
		return "image/png", true
	case "jpg":
		return "image/jpeg", true
	case "gif":
		return "image/gif", true
	case "webp":
		return "image/webp", true
	case "heic":
		return "image/heic", true
	default:
		return "", false
	}
}

func NotesImageFilename(noteID, relative string) (string, string, bool) {
	if !validNoteID(noteID) || len(relative) > 160 ||
		!strings.HasPrefix(relative, "_assets/"+noteID+"/") {
		return "", "", false
	}
	filename := strings.TrimPrefix(relative, "_assets/"+noteID+"/")
	mime, ok := notesImageMIME(filename)
	return filename, mime, ok
}

func (c *Client) NotesUploadMineImage(
	ctx context.Context, noteID string, image []byte,
) (NotesImageReceipt, error) {
	var empty NotesImageReceipt
	if !validNoteID(noteID) || len(image) == 0 || len(image) > NotesMaxImageBytes {
		return empty, errors.New("invalid Owner Note or bounded image")
	}
	// One explicit user action, no automatic retry if the commit ACK is lost.
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("image", "notes-image")
	if err != nil {
		return empty, err
	}
	if _, err = part.Write(image); err != nil {
		return empty, err
	}
	if err = writer.Close(); err != nil {
		return empty, err
	}
	req, err := c.request(ctx, http.MethodPost,
		"/api/v1/notes/mine/"+noteID+"/images", bytes.NewReader(body.Bytes()))
	if err != nil {
		return empty, err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Accept", "application/json")
	resp, err := c.do(req)
	if err != nil {
		return empty, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		return empty, responseError(resp)
	}
	if !strings.HasPrefix(resp.Header.Get("Content-Type"), "application/json") ||
		resp.ContentLength > notesImageReplyMaxBytes {
		return empty, errors.New("invalid Notes image receipt type or size")
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, notesImageReplyMaxBytes+1))
	if err != nil {
		return empty, err
	}
	if len(raw) > notesImageReplyMaxBytes {
		return empty, errors.New("oversized Notes image receipt")
	}
	var out NotesImageReceipt
	if err := json.Unmarshal(raw, &out); err != nil {
		return empty, errors.New("invalid Notes image receipt JSON")
	}
	filename, mime, ok := NotesImageFilename(noteID, out.RelativePath)
	sum := sha256.Sum256(image)
	if !ok || out.NodeID == 0 || out.Filename != filename ||
		out.ContentType != mime || out.Bytes != int64(len(image)) ||
		!strings.EqualFold(out.SHA256, hex.EncodeToString(sum[:])) {
		return empty, errors.New("Owner Notes image receipt did not match uploaded bytes")
	}
	return out, nil
}

func (c *Client) NotesImportIOSImage(
	ctx context.Context, noteID string, image []byte,
) (NotesImageReceipt, error) {
	var empty NotesImageReceipt
	if !validNoteID(noteID) || len(image) == 0 || len(image) > NotesMaxImageBytes {
		return empty, errors.New("invalid Owner Note or bounded image")
	}
	// One explicit user action, no automatic retry if the commit ACK is lost.
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("image", "notes-image")
	if err != nil {
		return empty, err
	}
	if _, err = part.Write(image); err != nil {
		return empty, err
	}
	if err = writer.Close(); err != nil {
		return empty, err
	}
	req, err := c.request(ctx, http.MethodPost,
		"/api/v1/notes/ios/images/import/"+noteID, bytes.NewReader(body.Bytes()))
	if err != nil {
		return empty, err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Accept", "application/json")
	resp, err := c.do(req)
	if err != nil {
		return empty, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		return empty, responseError(resp)
	}
	if !strings.HasPrefix(resp.Header.Get("Content-Type"), "application/json") ||
		resp.ContentLength > notesImageReplyMaxBytes {
		return empty, errors.New("invalid Notes image receipt type or size")
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, notesImageReplyMaxBytes+1))
	if err != nil {
		return empty, err
	}
	if len(raw) > notesImageReplyMaxBytes {
		return empty, errors.New("oversized Notes image receipt")
	}
	var out NotesImageReceipt
	if err := json.Unmarshal(raw, &out); err != nil {
		return empty, errors.New("invalid Notes image receipt JSON")
	}
	filename, mime, ok := NotesImageFilename(noteID, out.RelativePath)
	sum := sha256.Sum256(image)
	if !ok || out.NodeID == 0 || out.Filename != filename ||
		out.ContentType != mime || out.Bytes != int64(len(image)) ||
		!strings.EqualFold(out.SHA256, hex.EncodeToString(sum[:])) {
		return empty, errors.New("iOS Notes image import receipt did not match uploaded bytes")
	}
	return out, nil
}

// NotesReadImage only accepts the pinned, same-Note _assets/uuid/uuid.ext
// relative path. Neither a user URL nor a signed Server URL is ever followed.
func (c *Client) NotesReadImage(
	ctx context.Context, noteID, relativePath string,
) ([]byte, error) {
	filename, mime, ok := NotesImageFilename(noteID, relativePath)
	if !ok {
		return nil, errors.New("invalid Owner Notes image selector")
	}
	req, err := c.request(ctx, http.MethodGet,
		"/api/v1/notes/"+noteID+"/images/"+filename, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", mime)
	resp, err := c.do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, responseError(resp)
	}
	if strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0]) != mime ||
		resp.ContentLength > NotesMaxImageBytes {
		return nil, errors.New("invalid Notes image Content-Type or length")
	}
	etag := resp.Header.Get("ETag")
	if len(etag) != 66 || !strings.HasPrefix(etag, "\"") ||
		!strings.HasSuffix(etag, "\"") {
		return nil, errors.New("Notes image digest ETag missing")
	}
	if _, err := hex.DecodeString(etag[1:65]); err != nil {
		return nil, errors.New("invalid Notes image digest ETag")
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, NotesMaxImageBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) == 0 || len(data) > NotesMaxImageBytes {
		return nil, errors.New("Notes image payload exceeds 20 MiB")
	}
	digest := sha256.Sum256(data)
	if !strings.EqualFold(hex.EncodeToString(digest[:]), etag[1:65]) {
		return nil, fmt.Errorf("Owner Notes image SHA-256 mismatch")
	}
	return data, nil
}
