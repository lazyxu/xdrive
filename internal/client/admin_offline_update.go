package client

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"regexp"
)

// Offline imports remain an administrator-only, fixed-endpoint Server feature.
// The Agent never receives a local host path, executable command or Docker
// privilege; the Server and Host Control independently authorize every step.
const OfflineImportChunkBytes = 8 << 20

var (
	offlineImportIDPattern = regexp.MustCompile("^[a-f0-9]{32}$")
	offlineImportHashPattern = regexp.MustCompile("^[a-f0-9]{64}$")
	offlineImportFilePattern = regexp.MustCompile("^xdrive-(app|postgres|media-worker|ai-runtime|ai-models)-[a-f0-9]{12}\\.tar\\.gz$")
)

func ValidOfflineImportID(id string) bool {
	return offlineImportIDPattern.MatchString(id)
}

func ValidOfflineImportFile(name string) bool {
	switch name {
	case "manifest.json", "xdrive-offline-linux-amd64", "delivery.json", "delivery-attestation.jsonl":
		return true
	default:
		return offlineImportFilePattern.MatchString(name)
	}
}

func ValidOfflineImportSHA256(digest string) bool {
	return offlineImportHashPattern.MatchString(digest)
}

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

type OfflineImportFinalized struct {
	Name         string `json:"name"`
	State        string `json:"state"`
	UploadSHA256 string `json:"upload_sha256"`
}

func offlineImportPath(id string) (string, error) {
	if !ValidOfflineImportID(id) {
		return "", fmt.Errorf("invalid offline import ID")
	}
	return "/api/v1/admin/update/offline/imports/" + id, nil
}

func offlineImportFilePath(id, name string) (string, error) {
	path, err := offlineImportPath(id)
	if err != nil {
		return "", err
	}
	if !ValidOfflineImportFile(name) {
		return "", fmt.Errorf("invalid offline import filename")
	}
	return path + "/files/" + name, nil
}

func (c *Client) OfflineImportList(ctx context.Context) (OfflineImportList, error) {
	var out OfflineImportList
	err := c.json(ctx, http.MethodGet, "/api/v1/admin/update/offline/imports", nil, &out)
	return out, err
}

func (c *Client) OfflineImportCreate(ctx context.Context) (OfflineImportCreated, error) {
	var out OfflineImportCreated
	err := c.json(ctx, http.MethodPost, "/api/v1/admin/update/offline/imports", map[string]any{}, &out)
	if err == nil && (!ValidOfflineImportID(out.ID) || out.ChunkBytes != OfflineImportChunkBytes) {
		err = fmt.Errorf("invalid offline import creation receipt")
	}
	return out, err
}

func (c *Client) OfflineImportGet(ctx context.Context, id string) (OfflineImportStatus, error) {
	var out OfflineImportStatus
	path, err := offlineImportPath(id)
	if err != nil {
		return out, err
	}
	err = c.json(ctx, http.MethodGet, path, nil, &out)
	return out, err
}

func (c *Client) OfflineImportRegister(ctx context.Context, id, name string, size int64, uploadSHA256 string) error {
	path, err := offlineImportFilePath(id, name)
	if err != nil {
		return err
	}
	if size <= 0 || size > 8<<30 ||
		(uploadSHA256 != "" && !ValidOfflineImportSHA256(uploadSHA256)) {
		return fmt.Errorf("invalid offline file metadata")
	}
	return c.json(ctx, http.MethodPost, path, map[string]any{
		"name": name, "size": size, "sha256": uploadSHA256,
	}, nil)
}

func (c *Client) OfflineImportChunk(ctx context.Context, id, name string, index uint32, data []byte, claimedSHA256 string) error {
	path, err := offlineImportFilePath(id, name)
	if err != nil {
		return err
	}
	if len(data) == 0 || len(data) > OfflineImportChunkBytes ||
		!ValidOfflineImportSHA256(claimedSHA256) {
		return fmt.Errorf("invalid offline file chunk")
	}
	actual := sha256.Sum256(data)
	if hex.EncodeToString(actual[:]) != claimedSHA256 {
		return fmt.Errorf("offline chunk digest differs before transfer")
	}
	req, err := c.request(ctx, http.MethodPut, fmt.Sprintf("%s/chunks/%d", path, index), bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("X-XDrive-Chunk-SHA256", claimedSHA256)
	resp, err := c.do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return decodeResponse(resp, nil)
}

func (c *Client) OfflineImportFinalize(ctx context.Context, id, name string) (OfflineImportFinalized, error) {
	var out OfflineImportFinalized
	path, err := offlineImportFilePath(id, name)
	if err != nil {
		return out, err
	}
	err = c.json(ctx, http.MethodPost, path+"/finalize", map[string]any{}, &out)
	return out, err
}

func (c *Client) OfflineImportDelete(ctx context.Context, id string) error {
	path, err := offlineImportPath(id)
	if err != nil {
		return err
	}
	return c.json(ctx, http.MethodDelete, path, nil, nil)
}

// Only Host Control executes the update after independently verifying both
// digests. A transport hash or untrusted upload is not a publisher signature.
func (c *Client) StartOfflineServerUpdate(ctx context.Context, id, manifestSHA256, goSHA256 string, backupFileData bool) (ServerUpdateState, error) {
	var out ServerUpdateState
	if !ValidOfflineImportID(id) ||
		!ValidOfflineImportSHA256(manifestSHA256) ||
		!ValidOfflineImportSHA256(goSHA256) {
		return out, fmt.Errorf("offline update requires exact import ID and two independent SHA-256 values")
	}
	err := c.json(ctx, http.MethodPost, "/api/v1/admin/update", map[string]any{
		"source": "offline", "channel": "master", "offline_id": id,
		"trusted_manifest_sha256": manifestSHA256,
		"trusted_installer_sha256": goSHA256,
		"backup_file_data": backupFileData,
	}, &out)
	return out, err
}
