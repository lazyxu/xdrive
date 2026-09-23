package client

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const DefaultUploadChunkSize int64 = 8 << 20

type UploadProgress func(done, total int64)

type UploadInit struct {
	ParentID         *uint64  `json:"parent_id,omitempty"`
	NodeID           *uint64  `json:"node_id,omitempty"`
	Name             string   `json:"name,omitempty"`
	Size             int64    `json:"size"`
	ChunkSize        int64    `json:"chunk_size,omitempty"`
	SHA256           string   `json:"sha256,omitempty"`
	ChunkSHA256      []string `json:"chunk_sha256,omitempty"`
	ResumeKey        string   `json:"resume_key,omitempty"`
	ExpectedRevision uint64   `json:"expected_revision,omitempty"`
}

type UploadPart struct {
	Index  int    `json:"index"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
	Reused bool   `json:"reused,omitempty"`
}

type UploadSession struct {
	ID               string       `json:"id"`
	ParentID         *uint64      `json:"parent_id,omitempty"`
	NodeID           *uint64      `json:"node_id,omitempty"`
	Name             string       `json:"name,omitempty"`
	Size             int64        `json:"size"`
	ChunkSize        int64        `json:"chunk_size"`
	ChunkCount       int          `json:"chunk_count"`
	SHA256           string       `json:"sha256,omitempty"`
	ResumeKey        string       `json:"resume_key,omitempty"`
	ExpectedRevision uint64       `json:"expected_revision,omitempty"`
	Status           string       `json:"status"`
	ExpiresAt        time.Time    `json:"expires_at"`
	Received         []UploadPart `json:"received_chunks"`
	Result           *Node        `json:"result,omitempty"`
}

func (c *Client) StartUpload(ctx context.Context, init UploadInit) (UploadSession, error) {
	var out UploadSession
	err := c.json(ctx, http.MethodPost, "/api/v1/uploads", init, &out)
	return out, err
}

func (c *Client) UploadStatus(ctx context.Context, id string) (UploadSession, error) {
	var out UploadSession
	err := c.json(ctx, http.MethodGet, "/api/v1/uploads/"+id, nil, &out)
	return out, err
}

func (c *Client) PutUploadChunk(ctx context.Context, id string, index int, sha string, r io.Reader) (UploadPart, error) {
	var out UploadPart
	req, err := c.request(ctx, http.MethodPut, fmt.Sprintf("/api/v1/uploads/%s/chunks/%d", id, index), r)
	if err != nil {
		return out, err
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("X-Chunk-SHA256", sha)
	resp, err := c.do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if err := decodeResponse(resp, &out); err != nil {
		return out, err
	}
	return out, nil
}

func (c *Client) FinalizeUpload(ctx context.Context, id string) (UploadSession, error) {
	var out UploadSession
	err := c.json(ctx, http.MethodPost, "/api/v1/uploads/"+id+"/finalize", map[string]any{}, &out)
	return out, err
}

func (c *Client) AbortUpload(ctx context.Context, id string) error {
	req, err := c.request(ctx, http.MethodDelete, "/api/v1/uploads/"+id, nil)
	if err != nil {
		return err
	}
	resp, err := c.do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return decodeResponse(resp, nil)
}

func (c *Client) UploadFileResumable(ctx context.Context, parentID uint64, path, name string, progress UploadProgress) (Node, error) {
	return c.uploadPath(ctx, path, UploadInit{
		ParentID:  &parentID,
		Name:      name,
		ChunkSize: DefaultUploadChunkSize,
	}, progress)
}

func (c *Client) OverwriteFileResumable(ctx context.Context, nodeID, revision uint64, path string, progress UploadProgress) (Node, error) {
	return c.uploadPath(ctx, path, UploadInit{
		NodeID:           &nodeID,
		ExpectedRevision: revision,
		ChunkSize:        DefaultUploadChunkSize,
	}, progress)
}

func (c *Client) uploadPath(ctx context.Context, path string, init UploadInit, progress UploadProgress) (Node, error) {
	f, err := os.Open(path)
	if err != nil {
		return Node{}, err
	}
	stat, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return Node{}, err
	}
	if stat.IsDir() {
		_ = f.Close()
		return Node{}, fmt.Errorf("upload source is a directory")
	}
	init.Size = stat.Size()

	fullHash, chunkHashes, err := hashUploadFile(f, stat.Size(), init.ChunkSize)
	if err != nil {
		_ = f.Close()
		return Node{}, fmt.Errorf("hash upload source: %w", err)
	}
	afterHash, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return Node{}, err
	}
	if afterHash.Size() != stat.Size() || !afterHash.ModTime().Equal(stat.ModTime()) {
		_ = f.Close()
		return Node{}, fmt.Errorf("upload source changed while hashing")
	}
	init.SHA256 = fullHash
	init.ChunkSHA256 = chunkHashes
	init.ResumeKey = init.SHA256
	defer f.Close()

	session, err := c.StartUpload(ctx, init)
	if err != nil {
		return Node{}, err
	}
	if session.Status == "finalized" && session.Result != nil {
		if progress != nil {
			progress(init.Size, init.Size)
		}
		return *session.Result, nil
	}

	received := make(map[int]UploadPart, len(session.Received))
	var done int64
	for _, part := range session.Received {
		if part.Index < 0 || part.Index >= len(chunkHashes) {
			continue
		}
		expectedSize := uploadChunkSize(init.Size, session.ChunkSize, part.Index)
		if part.Size != expectedSize || !strings.EqualFold(part.SHA256, chunkHashes[part.Index]) {
			continue
		}
		received[part.Index] = part
		done += part.Size
	}
	if progress != nil {
		progress(done, init.Size)
	}

	for index := 0; index < session.ChunkCount; index++ {
		if _, ok := received[index]; ok {
			continue
		}
		offset := int64(index) * session.ChunkSize
		partSize := uploadChunkSize(session.Size, session.ChunkSize, index)
		buf := make([]byte, int(partSize))
		n, readErr := f.ReadAt(buf, offset)
		if readErr != nil && !errors.Is(readErr, io.EOF) {
			return Node{}, readErr
		}
		if int64(n) != partSize {
			return Node{}, fmt.Errorf("short read for chunk %d: got %d want %d", index, n, partSize)
		}
		sum := sha256.Sum256(buf)
		partHash := hex.EncodeToString(sum[:])
		if !strings.EqualFold(partHash, chunkHashes[index]) {
			return Node{}, fmt.Errorf("upload source changed after hashing at chunk %d", index)
		}
		part, err := c.putChunkRetry(ctx, session.ID, index, partHash, buf)
		if err != nil {
			return Node{}, err
		}
		done += part.Size
		if progress != nil {
			progress(done, init.Size)
		}
	}

	final, err := c.finalizeRetry(ctx, session.ID)
	if err != nil {
		return Node{}, err
	}
	if final.Result == nil {
		return Node{}, fmt.Errorf("finalize upload returned no file")
	}
	if init.SHA256 != "" && final.Result.SHA256 != "" && final.Result.SHA256 != init.SHA256 {
		return Node{}, fmt.Errorf("server content hash mismatch: got %s want %s", final.Result.SHA256, init.SHA256)
	}
	if progress != nil {
		progress(init.Size, init.Size)
	}
	return *final.Result, nil
}

func hashUploadFile(f *os.File, size, chunkSize int64) (string, []string, error) {
	if chunkSize <= 0 {
		chunkSize = DefaultUploadChunkSize
	}
	count := 0
	if size > 0 {
		count = int((size + chunkSize - 1) / chunkSize)
	}
	hashes := make([]string, count)
	full := sha256.New()
	for index := 0; index < count; index++ {
		partSize := uploadChunkSize(size, chunkSize, index)
		buf := make([]byte, int(partSize))
		n, err := f.ReadAt(buf, int64(index)*chunkSize)
		if err != nil && !errors.Is(err, io.EOF) {
			return "", nil, err
		}
		if int64(n) != partSize {
			return "", nil, fmt.Errorf("short read while hashing chunk %d: got %d want %d", index, n, partSize)
		}
		if _, err := full.Write(buf); err != nil {
			return "", nil, err
		}
		sum := sha256.Sum256(buf)
		hashes[index] = hex.EncodeToString(sum[:])
	}
	return hex.EncodeToString(full.Sum(nil)), hashes, nil
}

func uploadChunkSize(total, chunkSize int64, index int) int64 {
	offset := int64(index) * chunkSize
	if remain := total - offset; remain < chunkSize {
		return remain
	}
	return chunkSize
}

func (c *Client) putChunkRetry(ctx context.Context, sessionID string, index int, hash string, data []byte) (UploadPart, error) {
	var last error
	for attempt := 0; attempt < 3; attempt++ {
		part, err := c.PutUploadChunk(ctx, sessionID, index, hash, bytes.NewReader(data))
		if err == nil {
			return part, nil
		}
		last = err
		var apiErr *APIError
		if errors.As(err, &apiErr) && apiErr.Status < 500 {
			return UploadPart{}, err
		}
		if attempt < 2 {
			select {
			case <-ctx.Done():
				return UploadPart{}, ctx.Err()
			case <-time.After(time.Duration(attempt+1) * 250 * time.Millisecond):
			}
		}
	}
	return UploadPart{}, last
}

func (c *Client) finalizeRetry(ctx context.Context, sessionID string) (UploadSession, error) {
	var last error
	for attempt := 0; attempt < 3; attempt++ {
		result, err := c.FinalizeUpload(ctx, sessionID)
		if err == nil {
			return result, nil
		}
		last = err
		var apiErr *APIError
		if errors.As(err, &apiErr) && apiErr.Status < 500 {
			return UploadSession{}, err
		}
		if attempt < 2 {
			select {
			case <-ctx.Done():
				return UploadSession{}, ctx.Err()
			case <-time.After(time.Duration(attempt+1) * 250 * time.Millisecond):
			}
		}
	}
	return UploadSession{}, last
}
