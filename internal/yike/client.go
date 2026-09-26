package yike

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultBaseURL = "https://photo.baidu.com/youai"
	maxCookieBytes = 16 << 10
	maxJSONBytes   = 16 << 20
	maxPages       = 100000
)

type Client struct {
	baseURL    string
	cookie     string
	httpClient *http.Client
	userAgent  string
}

func New(cookie string) (*Client, error) {
	return NewWithBaseURL(DefaultBaseURL, cookie, nil)
}

func NewWithBaseURL(baseURL, cookie string, httpClient *http.Client) (*Client, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	cookie = strings.TrimSpace(cookie)
	if baseURL == "" {
		return nil, fmt.Errorf("Yike base URL is required")
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("invalid Yike base URL")
	}
	if cookie == "" {
		return nil, fmt.Errorf("Yike cookie is required")
	}
	if len([]byte(cookie)) > maxCookieBytes {
		return nil, fmt.Errorf("Yike cookie exceeds %d bytes", maxCookieBytes)
	}
	if strings.ContainsAny(cookie, "\r\n") {
		return nil, fmt.Errorf("Yike cookie contains invalid newline")
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 60 * time.Second}
	}
	return &Client{
		baseURL: baseURL, cookie: cookie, httpClient: httpClient,
		userAgent: "Mozilla/5.0 xDrive-Yike-Connector",
	}, nil
}

func (c *Client) UserInfo(ctx context.Context) (UserInfo, error) {
	var out struct {
		apiEnvelope
		UserInfo
	}
	if err := c.getJSON(ctx, "/user/v1/getuinfo", nil, &out); err != nil {
		return UserInfo{}, err
	}
	if strings.TrimSpace(out.YouaID) == "" {
		return UserInfo{}, fmt.Errorf("Yike user info returned no youa_id")
	}
	return out.UserInfo, nil
}

func (c *Client) ListFilesPage(ctx context.Context, cursor string) (FileList, error) {
	var out struct {
		apiEnvelope
		FileList
	}
	query := url.Values{
		"need_thumbnail":     {"0"},
		"need_filter_hidden": {"0"},
	}
	if cursor != "" {
		query.Set("cursor", cursor)
	}
	if err := c.getJSON(ctx, "/file/v1/list", query, &out); err != nil {
		return FileList{}, err
	}
	return out.FileList, validatePage(out.FileList.Page)
}

func (c *Client) ListAllFiles(ctx context.Context) ([]File, error) {
	var out []File
	err := paginate(ctx, func(cursor string) ([]File, Page, error) {
		page, err := c.ListFilesPage(ctx, cursor)
		return page.List, page.Page, err
	}, func(items []File) {
		out = append(out, items...)
	})
	return out, err
}

func (c *Client) ListAlbumsPage(ctx context.Context, cursor string) (AlbumList, error) {
	var out struct {
		apiEnvelope
		AlbumList
	}
	query := url.Values{
		"need_amount": {"1"},
		"limit":       {"100"},
	}
	if cursor != "" {
		query.Set("cursor", cursor)
	}
	if err := c.getJSON(ctx, "/album/v1/list", query, &out); err != nil {
		return AlbumList{}, err
	}
	return out.AlbumList, validatePage(out.AlbumList.Page)
}

func (c *Client) ListAllAlbums(ctx context.Context) ([]Album, error) {
	var out []Album
	err := paginate(ctx, func(cursor string) ([]Album, Page, error) {
		page, err := c.ListAlbumsPage(ctx, cursor)
		return page.List, page.Page, err
	}, func(items []Album) {
		out = append(out, items...)
	})
	return out, err
}

func (c *Client) ListAlbumFilesPage(ctx context.Context, albumID, cursor string) (AlbumFileList, error) {
	albumID = strings.TrimSpace(albumID)
	if albumID == "" {
		return AlbumFileList{}, fmt.Errorf("album id is required")
	}
	var out struct {
		apiEnvelope
		AlbumFileList
	}
	query := url.Values{
		"album_id":    {albumID},
		"need_amount": {"1"},
		"limit":       {"1000"},
		"passwd":      {""},
	}
	if cursor != "" {
		query.Set("cursor", cursor)
	}
	if err := c.getJSON(ctx, "/album/v1/listfile", query, &out); err != nil {
		return AlbumFileList{}, err
	}
	return out.AlbumFileList, validatePage(out.AlbumFileList.Page)
}

func (c *Client) ListAllAlbumFiles(ctx context.Context, albumID string) ([]AlbumFile, error) {
	var out []AlbumFile
	err := paginate(ctx, func(cursor string) ([]AlbumFile, Page, error) {
		page, err := c.ListAlbumFilesPage(ctx, albumID, cursor)
		return page.List, page.Page, err
	}, func(items []AlbumFile) {
		out = append(out, items...)
	})
	return out, err
}

func (c *Client) DownloadFileLink(ctx context.Context, fsid int64) (DownloadLink, error) {
	if fsid <= 0 {
		return DownloadLink{}, fmt.Errorf("fsid must be positive")
	}
	var out struct {
		apiEnvelope
		DLink string `json:"dlink"`
	}
	query := url.Values{"fsid": {strconv.FormatInt(fsid, 10)}}
	if err := c.getJSON(ctx, "/file/v2/download", query, &out); err != nil {
		return DownloadLink{}, err
	}
	if strings.TrimSpace(out.DLink) == "" {
		return DownloadLink{}, fmt.Errorf("Yike download response returned no dlink")
	}
	return DownloadLink{
		URL: out.DLink,
		Headers: map[string]string{
			"User-Agent": c.userAgent,
			"Referer":    "https://photo.baidu.com/",
		},
	}, nil
}

func (c *Client) DownloadAlbumFileLink(ctx context.Context, ownUK int64, file AlbumFile) (DownloadLink, error) {
	if file.FSID <= 0 {
		return DownloadLink{}, fmt.Errorf("fsid must be positive")
	}
	ownerUK := file.OwnerUK(ownUK)
	if ownerUK <= 0 {
		return DownloadLink{}, fmt.Errorf("album file owner uk is unavailable")
	}
	if ownerUK == ownUK {
		return c.DownloadFileLink(ctx, file.FSID)
	}
	return c.downloadSharedAlbumFileLink(ctx, file)
}

func (c *Client) downloadSharedAlbumFileLink(ctx context.Context, file AlbumFile) (DownloadLink, error) {
	if strings.TrimSpace(file.AlbumID) == "" || file.TID == 0 || file.UK <= 0 {
		return DownloadLink{}, fmt.Errorf("shared album file metadata is incomplete")
	}
	query := url.Values{
		"fsid":     {strconv.FormatInt(file.FSID, 10)},
		"album_id": {file.AlbumID},
		"tid":      {strconv.FormatInt(file.TID, 10)},
		"uk":       {strconv.FormatInt(file.UK, 10)},
	}
	req, err := c.request(ctx, http.MethodHead, "/album/v1/download", query)
	if err != nil {
		return DownloadLink{}, err
	}
	noRedirect := *c.httpClient
	noRedirect.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}
	resp, err := noRedirect.Do(req)
	if err != nil {
		return DownloadLink{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 300 || resp.StatusCode >= 400 {
		return DownloadLink{}, fmt.Errorf("shared album direct download returned HTTP %d", resp.StatusCode)
	}
	location := strings.TrimSpace(resp.Header.Get("Location"))
	if location == "" {
		return DownloadLink{}, fmt.Errorf("shared album direct download returned no redirect location")
	}
	return DownloadLink{
		URL: location,
		Headers: map[string]string{
			"User-Agent": c.userAgent,
			"Referer":    "https://photo.baidu.com/",
		},
	}, nil
}

func (c *Client) getJSON(ctx context.Context, path string, query url.Values, target any) error {
	req, err := c.request(ctx, http.MethodGet, path, query)
	if err != nil {
		return err
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("Yike API returned HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxJSONBytes+1))
	if err != nil {
		return err
	}
	if len(data) > maxJSONBytes {
		return fmt.Errorf("Yike API response exceeds %d bytes", maxJSONBytes)
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("decode Yike API response: %w", err)
	}
	var envelope apiEnvelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return err
	}
	return envelope.Err()
}

func (c *Client) request(ctx context.Context, method, path string, query url.Values) (*http.Request, error) {
	fullURL := c.baseURL + "/" + strings.TrimLeft(path, "/")
	if len(query) != 0 {
		fullURL += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, fullURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Cookie", c.cookie)
	req.Header.Set("User-Agent", c.userAgent)
	req.Header.Set("Referer", "https://photo.baidu.com/")
	return req, nil
}

type apiEnvelope struct {
	Errno int `json:"errno"`
}

func (e apiEnvelope) Err() error {
	switch e.Errno {
	case 0:
		return nil
	case 50805:
		return fmt.Errorf("Yike API errno 50805: album already joined")
	case 50820:
		return fmt.Errorf("Yike API errno 50820: no shared albums found")
	default:
		return fmt.Errorf("Yike API errno %d", e.Errno)
	}
}

func validatePage(page Page) error {
	if page.HasMore != 0 && page.HasMore != 1 {
		return fmt.Errorf("invalid Yike has_more value %d", page.HasMore)
	}
	if page.HasNext() && strings.TrimSpace(page.Cursor) == "" {
		return fmt.Errorf("Yike pagination has_more=1 but cursor is empty")
	}
	return nil
}

func paginate[T any](
	ctx context.Context,
	fetch func(cursor string) ([]T, Page, error),
	appendItems func([]T),
) error {
	cursor := ""
	seen := map[string]struct{}{}
	for pageNo := 0; pageNo < maxPages; pageNo++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		items, page, err := fetch(cursor)
		if err != nil {
			return err
		}
		appendItems(items)
		if !page.HasNext() {
			return nil
		}
		next := strings.TrimSpace(page.Cursor)
		if next == "" {
			return fmt.Errorf("Yike pagination cursor is empty")
		}
		if _, duplicate := seen[next]; duplicate {
			return fmt.Errorf("Yike pagination cursor repeated")
		}
		seen[next] = struct{}{}
		cursor = next
	}
	return errors.New("Yike pagination exceeded safety limit")
}
