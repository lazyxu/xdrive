package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Client struct {
	BaseURL string
	Token   string
	HTTP    *http.Client

	sessionMu        sync.RWMutex
	refreshMu        sync.Mutex
	refreshToken     string
	accessExpiresAt  time.Time
	refreshExpiresAt time.Time
	onTokens         func(SessionTokens) error
	loadTokens       func() (SessionTokens, error)
}

type Node struct {
	ID        uint64     `json:"id"`
	ParentID  *uint64    `json:"parent_id,omitempty"`
	Name      string     `json:"name"`
	Type      string     `json:"type"`
	Size      int64      `json:"size"`
	Revision  uint64     `json:"revision"`
	SHA256    string     `json:"sha256,omitempty"`
	DeletedAt *time.Time `json:"deleted_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

type QuotaUsage struct {
	QuotaBytes        int64 `json:"quota_bytes"`
	PhysicalUsedBytes int64 `json:"physical_used_bytes"`
	LogicalFileBytes  int64 `json:"logical_file_bytes"`
	TrashBytes        int64 `json:"trash_bytes"`
	HistoryBytes      int64 `json:"history_bytes"`
	OverQuota         bool  `json:"over_quota"`
}

type StorageSizeBucket struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Count int64  `json:"count"`
	Bytes int64  `json:"bytes"`
}

type StorageStats struct {
	Scope                     string              `json:"scope"`
	CASBlobCount              int64               `json:"cas_blob_count"`
	CASPhysicalBytes          int64               `json:"cas_physical_bytes"`
	CASLogicalReferencedBytes int64               `json:"cas_logical_referenced_bytes"`
	CASDedupSavedBytes        int64               `json:"cas_dedup_saved_bytes"`
	CASDedupRatio             float64             `json:"cas_dedup_ratio"`
	CASSavingsRatio           float64             `json:"cas_savings_ratio"`
	AverageBlobSizeBytes      float64             `json:"average_blob_size_bytes"`
	P50BlobSizeBytes          int64               `json:"p50_blob_size_bytes"`
	P90BlobSizeBytes          int64               `json:"p90_blob_size_bytes"`
	P99BlobSizeBytes          int64               `json:"p99_blob_size_bytes"`
	LegacyBlobCount           int64               `json:"legacy_blob_count"`
	LegacyPhysicalBytes       int64               `json:"legacy_physical_bytes"`
	Buckets                   []StorageSizeBucket `json:"buckets"`
	GeneratedAt               time.Time           `json:"generated_at"`
}

type AuthResponse struct {
	Token              string `json:"token"`
	AccessToken        string `json:"access_token"`
	RefreshToken       string `json:"refresh_token"`
	TokenType          string `json:"token_type"`
	ExpiresIn          int64  `json:"expires_in"`
	RefreshExpiresIn   int64  `json:"refresh_expires_in"`
	Username           string `json:"username"`
	Role               string `json:"role"`
	MustChangePassword bool   `json:"must_change_password"`
}

type APIError struct {
	Status int
	Msg    string
}

func (e *APIError) Error() string { return fmt.Sprintf("xdrive API: %s (%d)", e.Msg, e.Status) }

func IsRevisionConflict(err error) bool {
	var apiErr *APIError
	return errors.As(err, &apiErr) && apiErr.Status == http.StatusConflict && apiErr.Msg == "revision_conflict"
}

func New(baseURL, token string) *Client {
	return &Client{BaseURL: strings.TrimRight(baseURL, "/"), Token: token, HTTP: &http.Client{Timeout: 0}}
}

func (c *Client) Login(ctx context.Context, username, password string) (AuthResponse, error) {
	return c.authenticate(ctx, "/api/v1/auth/login", username, password)
}

func (c *Client) authenticate(ctx context.Context, path, username, password string) (AuthResponse, error) {
	var out AuthResponse
	body, _ := json.Marshal(map[string]string{"username": username, "password": password})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+path, bytes.NewReader(body))
	if err != nil {
		return out, err
	}
	req.Header.Set("Content-Type", "application/json")
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

func (c *Client) Quota(ctx context.Context) (QuotaUsage, error) {
	var out QuotaUsage
	err := c.json(ctx, http.MethodGet, "/api/v1/me/quota", nil, &out)
	return out, err
}

func (c *Client) StorageStats(ctx context.Context) (StorageStats, error) {
	var out StorageStats
	err := c.json(ctx, http.MethodGet, "/api/v1/me/storage", nil, &out)
	return out, err
}

func (c *Client) Root(ctx context.Context) (Node, error) {
	var out Node
	err := c.json(ctx, http.MethodGet, "/api/v1/nodes/root", nil, &out)
	return out, err
}

func (c *Client) List(ctx context.Context, parentID uint64) ([]Node, error) {
	var out []Node
	err := c.json(ctx, http.MethodGet, fmt.Sprintf("/api/v1/nodes/%d/children", parentID), nil, &out)
	return out, err
}

func (c *Client) CreateDir(ctx context.Context, parentID uint64, name string) (Node, error) {
	var out Node
	err := c.json(ctx, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", parentID), map[string]any{"name": name}, &out)
	return out, err
}

func (c *Client) RenameMove(ctx context.Context, id, revision uint64, name *string, parentID *uint64) (Node, error) {
	var out Node
	body := map[string]any{}
	if name != nil {
		body["name"] = *name
	}
	if parentID != nil {
		body["parent_id"] = *parentID
	}
	err := c.jsonRevision(ctx, http.MethodPatch, fmt.Sprintf("/api/v1/nodes/%d", id), revision, body, &out)
	return out, err
}

func (c *Client) Delete(ctx context.Context, id, revision uint64) error {
	req, err := c.request(ctx, http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", id), nil)
	if err != nil {
		return err
	}
	req.Header.Set("If-Match", fmt.Sprintf("\"%d\"", revision))
	resp, err := c.do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return responseError(resp)
	}
	return nil
}

func (c *Client) UploadFile(ctx context.Context, parentID uint64, path, name string) (Node, error) {
	return c.UploadFileResumable(ctx, parentID, path, name, nil)
}

func (c *Client) Upload(ctx context.Context, parentID uint64, name string, r io.Reader) (Node, error) {
	var out Node
	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	go func() {
		part, err := mw.CreateFormFile("file", filepath.Base(name))
		if err == nil {
			_, err = io.Copy(part, r)
		}
		if err == nil {
			err = mw.Close()
		}
		_ = pw.CloseWithError(err)
	}()
	req, err := c.request(ctx, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/files", parentID), pr)
	if err != nil {
		return out, err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
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

func (c *Client) Overwrite(ctx context.Context, id, revision uint64, r io.Reader) (Node, error) {
	var out Node
	req, err := c.request(ctx, http.MethodPut, fmt.Sprintf("/api/v1/files/%d/content", id), r)
	if err != nil {
		return out, err
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("If-Match", fmt.Sprintf("\"%d\"", revision))
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

type DownloadProgress func(done, total int64)

func (c *Client) DownloadTo(ctx context.Context, id uint64, w io.Writer) error {
	return c.DownloadToProgress(ctx, id, w, nil)
}

func (c *Client) DownloadToProgress(ctx context.Context, id uint64, w io.Writer, progress DownloadProgress) error {
	req, err := c.request(ctx, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", id), nil)
	if err != nil {
		return err
	}
	resp, err := c.do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return responseError(resp)
	}
	total := resp.ContentLength
	if total < 0 {
		total = 0
	}
	if progress != nil {
		progress(0, total)
	}
	writer := &progressWriter{writer: w, total: total, progress: progress}
	_, err = io.Copy(writer, resp.Body)
	return err
}

type progressWriter struct {
	writer     io.Writer
	total      int64
	done       int64
	progress   DownloadProgress
	lastReport time.Time
}

func (w *progressWriter) Write(p []byte) (int, error) {
	n, err := w.writer.Write(p)
	if n > 0 {
		w.done += int64(n)
		if w.progress != nil &&
			(w.lastReport.IsZero() || time.Since(w.lastReport) >= 100*time.Millisecond || (w.total > 0 && w.done >= w.total)) {
			w.progress(w.done, w.total)
			w.lastReport = time.Now()
		}
	}
	return n, err
}

func (c *Client) DownloadRange(ctx context.Context, id uint64, offset, length int64) ([]byte, error) {
	if length <= 0 {
		return nil, nil
	}
	req, err := c.request(ctx, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", id), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", offset, offset+length-1))
	resp, err := c.do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusPartialContent && resp.StatusCode != http.StatusOK {
		return nil, responseError(resp)
	}
	return io.ReadAll(io.LimitReader(resp.Body, length))
}

func (c *Client) Walk(ctx context.Context) (map[string]Node, error) {
	root, err := c.Root(ctx)
	if err != nil {
		return nil, err
	}
	out := map[string]Node{"": root}
	var walk func(Node, string) error
	walk = func(parent Node, prefix string) error {
		children, err := c.List(ctx, parent.ID)
		if err != nil {
			return err
		}
		for _, child := range children {
			rel := child.Name
			if prefix != "" {
				rel = prefix + "/" + child.Name
			}
			out[rel] = child
			if child.Type == "dir" {
				if err := walk(child, rel); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if err := walk(root, ""); err != nil {
		return nil, err
	}
	return out, nil
}

func (c *Client) jsonRevision(ctx context.Context, method, path string, revision uint64, in any, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := c.request(ctx, method, path, body)
	if err != nil {
		return err
	}
	req.Header.Set("If-Match", fmt.Sprintf("\"%d\"", revision))
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return decodeResponse(resp, out)
}

func (c *Client) json(ctx context.Context, method, path string, in any, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := c.request(ctx, method, path, body)
	if err != nil {
		return err
	}
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return decodeResponse(resp, out)
}

func (c *Client) request(ctx context.Context, method, path string, body io.Reader) (*http.Request, error) {
	if _, err := url.ParseRequestURI(c.BaseURL); err != nil {
		return nil, fmt.Errorf("invalid server URL: %w", err)
	}
	if err := c.ensureFresh(ctx); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, body)
	if err != nil {
		return nil, err
	}
	if token := c.accessToken(); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("User-Agent", "xdrive-xd/0.1")
	return req, nil
}

func (c *Client) do(req *http.Request) (*http.Response, error) {
	h := c.HTTP
	if h == nil {
		h = http.DefaultClient
	}
	resp, err := h.Do(req)
	if err != nil {
		return nil, err
	}
	return resp, nil
}

func decodeResponse(resp *http.Response, out any) error {
	if resp.StatusCode/100 != 2 {
		return responseError(resp)
	}
	if out == nil || resp.StatusCode == http.StatusNoContent {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func responseError(resp *http.Response) error {
	var e struct {
		Error string `json:"error"`
	}
	_ = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&e)
	if e.Error == "" {
		e.Error = http.StatusText(resp.StatusCode)
	}
	return &APIError{Status: resp.StatusCode, Msg: e.Error}
}

func ParseNodeID(identity []byte) (uint64, error) {
	id, err := strconv.ParseUint(strings.TrimSpace(string(identity)), 10, 64)
	if err != nil || id == 0 {
		return 0, errors.New("invalid node identity")
	}
	return id, nil
}
