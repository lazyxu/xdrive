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
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	BaseURL string
	Token   string
	HTTP    *http.Client
}

type Node struct {
	ID        uint64    `json:"id"`
	ParentID  *uint64   `json:"parent_id,omitempty"`
	Name      string    `json:"name"`
	Type      string    `json:"type"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type AuthResponse struct {
	Token    string `json:"token"`
	Username string `json:"username"`
}

type APIError struct {
	Status int
	Msg    string
}

func (e *APIError) Error() string { return fmt.Sprintf("xdrive API: %s (%d)", e.Msg, e.Status) }

func New(baseURL, token string) *Client {
	return &Client{BaseURL: strings.TrimRight(baseURL, "/"), Token: token, HTTP: &http.Client{Timeout: 0}}
}

func (c *Client) Login(ctx context.Context, username, password string) (AuthResponse, error) {
	return c.authenticate(ctx, "/api/v1/auth/login", username, password)
}

func (c *Client) Register(ctx context.Context, username, password string) (AuthResponse, error) {
	return c.authenticate(ctx, "/api/v1/auth/register", username, password)
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

func (c *Client) RenameMove(ctx context.Context, id uint64, name *string, parentID *uint64) (Node, error) {
	var out Node
	body := map[string]any{}
	if name != nil {
		body["name"] = *name
	}
	if parentID != nil {
		body["parent_id"] = *parentID
	}
	err := c.json(ctx, http.MethodPatch, fmt.Sprintf("/api/v1/nodes/%d", id), body, &out)
	return out, err
}

func (c *Client) Delete(ctx context.Context, id uint64) error {
	req, err := c.request(ctx, http.MethodDelete, fmt.Sprintf("/api/v1/nodes/%d", id), nil)
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
	return nil
}

func (c *Client) UploadFile(ctx context.Context, parentID uint64, path, name string) (Node, error) {
	f, err := os.Open(path)
	if err != nil {
		return Node{}, err
	}
	defer f.Close()
	return c.Upload(ctx, parentID, name, f)
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

func (c *Client) Overwrite(ctx context.Context, id uint64, r io.Reader) (Node, error) {
	var out Node
	req, err := c.request(ctx, http.MethodPut, fmt.Sprintf("/api/v1/files/%d/content", id), r)
	if err != nil {
		return out, err
	}
	req.Header.Set("Content-Type", "application/octet-stream")
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

func (c *Client) DownloadTo(ctx context.Context, id uint64, w io.Writer) error {
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
	_, err = io.Copy(w, resp.Body)
	return err
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
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, body)
	if err != nil {
		return nil, err
	}
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
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
