package client

// The Desktop Agent uses the same Server administrator-only offline import
// transport as Web. These exact RPCs never permit a filesystem path, command,
// script or Docker socket to be supplied by an Electron renderer.
import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
)

const OfflineImportChunkBytes = 8 << 20

var (
	offlineImportIDPattern   = regexp.MustCompile("^[a-f0-9]{32}$")
	offlineImportHashPattern = regexp.MustCompile("^[a-f0-9]{64}$")
	offlineImportNamePattern = regexp.MustCompile("^xdrive-(app|postgres|media-worker|ai-runtime|ai-models)-[a-f0-9]{12}\\.tar\\.gz$")
)

type OfflineImportFile struct {
	Name          string `json:"name"`
	State         string `json:"state"`
	Size          int64  `json:"size"`
	UploadedBytes int64  `json:"uploaded_bytes"`
	UploadSHA256  string `json:"upload_sha256,omitempty"`
}

type OfflineImportStatus struct {
	ID            string              `json:"id"`
	Files         []OfflineImportFile `json:"files"`
	ChunkBytes    int                 `json:"chunk_bytes"`
	ReadyToVerify bool                `json:"ready_to_verify"`
}

type OfflineImportSummary struct {
	ID         string `json:"id"`
	ModifiedAt string `json:"modified_at"`
}

type OfflineImportList struct {
	Items []OfflineImportSummary `json:"items"`
}

type OfflineImportCreated struct {
	ID         string `json:"id"`
	ChunkBytes int    `json:"chunk_bytes"`
}

type OfflineImportFinalizeReceipt struct {
	Name         string `json:"name"`
	State        string `json:"state"`
	UploadSHA256 string `json:"upload_sha256"`
}

func validOfflineName(name string) bool {
	switch name {
	case "manifest.json", "delivery.json", "delivery-attestation.jsonl", "xdrive-offline-linux-amd64":
		return true
	default:
		return offlineImportNamePattern.MatchString(name)
	}
}

func offlineImportPath(id string) (string, error) {
	if !offlineImportIDPattern.MatchString(id) {
		return "", fmt.Errorf("invalid offline import ID")
	}
	return "/api/v1/admin/update/offline/imports/" + id, nil
}
func offlineFilePath(id, name string) (string, error) {
	base, err := offlineImportPath(id)
	if err != nil {
		return "", err
	}
	if !validOfflineName(name) {
		return "", fmt.Errorf("invalid offline filename")
	}
	return base + "/files/" + url.PathEscape(name), nil
}

func (c *Client) AdminOfflineImports(ctx context.Context) (OfflineImportList, error) {
	var out OfflineImportList
	err := c.json(ctx, http.MethodGet, "/api/v1/admin/update/offline/imports", nil, &out)
	return out, err
}

func (c *Client) AdminOfflineImportCreate(ctx context.Context) (OfflineImportCreated, error) {
	var out OfflineImportCreated
	err := c.json(ctx, http.MethodPost, "/api/v1/admin/update/offline/imports", map[string]any{}, &out)
	return out, err
}
func (c *Client) AdminOfflineImportGet(ctx context.Context, id string) (OfflineImportStatus, error) {
	var out OfflineImportStatus
	base, err := offlineImportPath(id)
	if err != nil {
		return out, err
	}
	err = c.json(ctx, http.MethodGet, base, nil, &out)
	return out, err
}
func (c *Client) AdminOfflineImportRegister(ctx context.Context, id, name string, size int64, transportSHA string) error {
	path, err := offlineFilePath(id, name)
	if err != nil {
		return err
	}
	if size <= 0 || (transportSHA != "" && !offlineImportHashPattern.MatchString(transportSHA)) {
		return fmt.Errorf("invalid offline file size or transfer digest")
	}
	return c.json(ctx, http.MethodPost, path, map[string]any{
		"name": name, "size": size, "sha256": transportSHA,
	}, nil)
}
func (c *Client) AdminOfflineImportChunk(ctx context.Context, id, name string, index int, data []byte, sha string) error {
	path, err := offlineFilePath(id, name)
	if err != nil {
		return err
	}
	if index < 0 || index > 1<<20 || len(data) == 0 || len(data) > OfflineImportChunkBytes ||
		!offlineImportHashPattern.MatchString(sha) {
		return fmt.Errorf("invalid offline chunk envelope")
	}
	computed := sha256.Sum256(data)
	if hex.EncodeToString(computed[:]) != sha {
		return fmt.Errorf("offline chunk digest differs before network transfer")
	}
	req, err := c.request(ctx, http.MethodPut, fmt.Sprintf("%s/chunks/%d", path, index), bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("X-XDrive-Chunk-SHA256", sha)
	resp, err := c.do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return decodeResponse(resp, nil)
}
func (c *Client) AdminOfflineImportFinalize(ctx context.Context, id, name string) (OfflineImportFinalizeReceipt, error) {
	var out OfflineImportFinalizeReceipt
	path, err := offlineFilePath(id, name)
	if err != nil {
		return out, err
	}
	err = c.json(ctx, http.MethodPost, path+"/finalize", map[string]any{}, &out)
	return out, err
}
func (c *Client) AdminOfflineImportDelete(ctx context.Context, id string) error {
	path, err := offlineImportPath(id)
	if err != nil {
		return err
	}
	return c.json(ctx, http.MethodDelete, path, nil, nil)
}

func (c *Client) AdminOfflineImportStart(ctx context.Context, id, manifestSHA, installerSHA string, backup bool) (ServerUpdateState, error) {
	var out ServerUpdateState
	if _, err := offlineImportPath(id); err != nil {
		return out, err
	}
	if !offlineImportHashPattern.MatchString(manifestSHA) || !offlineImportHashPattern.MatchString(installerSHA) {
		return out, fmt.Errorf("invalid independent offline release digests")
	}
	err := c.json(ctx, http.MethodPost, "/api/v1/admin/update", map[string]any{
		"source": "offline", "channel": "master", "offline_id": id,
		"trusted_manifest_sha256":  manifestSHA,
		"trusted_installer_sha256": installerSHA,
		"backup_file_data":         backup,
	}, &out)
	return out, err
}
