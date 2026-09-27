package yike

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultBaseURL                       = "https://photo.baidu.com/youai"
	maxCookieBytes                       = 16 << 10
	maxJSONBytes                         = 16 << 20
	maxPages                             = 100000
	defaultDownloadResponseHeaderTimeout = 30 * time.Second
	defaultDownloadIdleTimeout           = 60 * time.Second
	defaultAPIMaxAttempts                = 3
	defaultAPIRetryBaseDelay             = 500 * time.Millisecond
	defaultAPIRetryMaxDelay              = 30 * time.Second
)

var (
	ErrAuthentication = errors.New("Yike authentication failed")
	ErrRateLimited    = errors.New("Yike request rate limited")
	ErrUnavailable    = errors.New("Yike service unavailable")
)

type Client struct {
	baseURL               string
	cookie                string
	httpClient            *http.Client
	userAgent             string
	downloadHeaderTimeout time.Duration
	downloadIdleTimeout   time.Duration
	apiMaxAttempts        int
	apiRetryBaseDelay     time.Duration
	apiRetryMaxDelay      time.Duration
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
		userAgent:             "Mozilla/5.0 xDrive-Yike-Connector",
		downloadHeaderTimeout: defaultDownloadResponseHeaderTimeout,
		downloadIdleTimeout:   defaultDownloadIdleTimeout,
		apiMaxAttempts:        defaultAPIMaxAttempts,
		apiRetryBaseDelay:     defaultAPIRetryBaseDelay,
		apiRetryMaxDelay:      defaultAPIRetryMaxDelay,
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

func (c *Client) OpenDownload(ctx context.Context, link DownloadLink, offset int64) (io.ReadCloser, error) {
	if offset < 0 {
		return nil, fmt.Errorf("download offset must be zero or greater")
	}
	parsed, err := url.Parse(strings.TrimSpace(link.URL))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("invalid Yike download URL")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return nil, fmt.Errorf("unsupported Yike download URL scheme %q", parsed.Scheme)
	}
	if parsed.User != nil {
		return nil, fmt.Errorf("Yike download URL must not contain userinfo")
	}
	if ip := net.ParseIP(parsed.Hostname()); ip != nil &&
		(ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast()) &&
		!c.baseURLUsesPrivateHost() {
		return nil, fmt.Errorf("Yike download URL resolves to a private literal address")
	}

	downloadCtx, cancel := context.WithCancel(ctx)
	req, err := http.NewRequestWithContext(downloadCtx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		cancel()
		return nil, err
	}
	for key, value := range link.Headers {
		if strings.EqualFold(key, "Cookie") || strings.EqualFold(key, "Authorization") {
			continue
		}
		req.Header.Set(key, value)
	}
	req.Header.Set("Accept-Encoding", "identity")
	if offset > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
	}

	downloadClient := c.mediaDownloadClient()
	resp, err := downloadClient.Do(req)
	if err != nil {
		cancel()
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, ctxErr
		}
		return nil, fmt.Errorf("%w: open Yike media download: %v", ErrUnavailable, err)
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		defer resp.Body.Close()
		defer cancel()
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("Yike media download returned HTTP %d", resp.StatusCode)
	}

	body := &idleTimeoutReadCloser{
		body: resp.Body, cancel: cancel, parent: ctx, timeout: c.downloadIdleTimeout,
	}
	if offset == 0 {
		return body, nil
	}
	if resp.StatusCode == http.StatusPartialContent {
		wantPrefix := fmt.Sprintf("bytes %d-", offset)
		if !strings.HasPrefix(strings.TrimSpace(resp.Header.Get("Content-Range")), wantPrefix) {
			_ = body.Close()
			return nil, fmt.Errorf("Yike media range response starts at the wrong offset")
		}
		return body, nil
	}
	if _, err := io.CopyN(io.Discard, body, offset); err != nil {
		_ = body.Close()
		return nil, fmt.Errorf("skip Yike media download to offset %d: %w", offset, err)
	}
	return body, nil
}

func (c *Client) mediaDownloadClient() http.Client {
	out := *c.httpClient
	out.Timeout = 0
	timeout := c.downloadHeaderTimeout
	if timeout <= 0 {
		return out
	}

	switch transport := out.Transport.(type) {
	case nil:
		if defaultTransport, ok := http.DefaultTransport.(*http.Transport); ok {
			cloned := defaultTransport.Clone()
			cloned.ResponseHeaderTimeout = timeout
			out.Transport = cloned
		}
	case *http.Transport:
		cloned := transport.Clone()
		if cloned.ResponseHeaderTimeout <= 0 || cloned.ResponseHeaderTimeout > timeout {
			cloned.ResponseHeaderTimeout = timeout
		}
		out.Transport = cloned
	}
	return out
}

type idleTimeoutReadCloser struct {
	body    io.ReadCloser
	cancel  context.CancelFunc
	parent  context.Context
	timeout time.Duration
}

func (r *idleTimeoutReadCloser) Read(p []byte) (int, error) {
	if r.timeout <= 0 {
		return r.body.Read(p)
	}
	timedOut := make(chan struct{})
	timer := time.AfterFunc(r.timeout, func() {
		close(timedOut)
		r.cancel()
	})
	n, err := r.body.Read(p)
	if timer.Stop() {
		return n, err
	}

	<-timedOut
	if parentErr := r.parent.Err(); parentErr != nil {
		return n, parentErr
	}
	return n, fmt.Errorf("Yike media download stalled for %s", r.timeout)
}

func (r *idleTimeoutReadCloser) Close() error {
	r.cancel()
	return r.body.Close()
}

func (c *Client) baseURLUsesPrivateHost() bool {
	parsed, err := url.Parse(c.baseURL)
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast())
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
	noRedirect := *c.httpClient
	noRedirect.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}

	attempts := c.apiAttempts()
	for attempt := 0; attempt < attempts; attempt++ {
		req, err := c.request(ctx, http.MethodGet, "/album/v1/download", query)
		if err != nil {
			return DownloadLink{}, err
		}
		resp, err := noRedirect.Do(req)
		if err != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return DownloadLink{}, ctxErr
			}
			if attempt+1 < attempts {
				if err := c.waitAPIRetry(ctx, attempt, ""); err != nil {
					return DownloadLink{}, err
				}
				continue
			}
			return DownloadLink{}, fmt.Errorf("%w: open shared album download link: %v", ErrUnavailable, err)
		}

		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			retryAfter := resp.Header.Get("Retry-After")
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
			_ = resp.Body.Close()
			if attempt+1 < attempts {
				if delay, allowed := c.apiRetryDelay(attempt, retryAfter); allowed {
					if err := sleepContext(ctx, delay); err != nil {
						return DownloadLink{}, err
					}
					continue
				}
			}
			if resp.StatusCode == http.StatusTooManyRequests {
				return DownloadLink{}, fmt.Errorf("%w: HTTP %d", ErrRateLimited, resp.StatusCode)
			}
			return DownloadLink{}, fmt.Errorf("%w: HTTP %d", ErrUnavailable, resp.StatusCode)
		}

		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
			_ = resp.Body.Close()
			return DownloadLink{}, fmt.Errorf("%w: HTTP %d", ErrAuthentication, resp.StatusCode)
		}
		if resp.StatusCode < 300 || resp.StatusCode >= 400 {
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
			_ = resp.Body.Close()
			return DownloadLink{}, fmt.Errorf("shared album direct download returned HTTP %d", resp.StatusCode)
		}
		location, err := resp.Location()
		_ = resp.Body.Close()
		if err != nil {
			return DownloadLink{}, fmt.Errorf("shared album direct download returned invalid redirect: %w", err)
		}
		return DownloadLink{
			URL: location.String(),
			Headers: map[string]string{
				"User-Agent": c.userAgent,
				"Referer":    "https://photo.baidu.com/",
			},
		}, nil
	}
	return DownloadLink{}, fmt.Errorf("%w: shared album download retries exhausted", ErrUnavailable)
}

func (c *Client) getJSON(ctx context.Context, path string, query url.Values, target any) error {
	attempts := c.apiAttempts()
	for attempt := 0; attempt < attempts; attempt++ {
		req, err := c.request(ctx, http.MethodGet, path, query)
		if err != nil {
			return err
		}
		resp, err := c.httpClient.Do(req)
		if err != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return ctxErr
			}
			if attempt+1 < attempts {
				if err := c.waitAPIRetry(ctx, attempt, ""); err != nil {
					return err
				}
				continue
			}
			return fmt.Errorf("%w: %v", ErrUnavailable, err)
		}

		switch resp.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
			_ = resp.Body.Close()
			return fmt.Errorf("%w: HTTP %d", ErrAuthentication, resp.StatusCode)
		case http.StatusTooManyRequests:
			retryAfter := resp.Header.Get("Retry-After")
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
			_ = resp.Body.Close()
			if attempt+1 < attempts {
				if delay, allowed := c.apiRetryDelay(attempt, retryAfter); allowed {
					if err := sleepContext(ctx, delay); err != nil {
						return err
					}
					continue
				}
			}
			return fmt.Errorf("%w: HTTP %d", ErrRateLimited, resp.StatusCode)
		}
		if resp.StatusCode >= 500 {
			retryAfter := resp.Header.Get("Retry-After")
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
			_ = resp.Body.Close()
			if attempt+1 < attempts {
				if delay, allowed := c.apiRetryDelay(attempt, retryAfter); allowed {
					if err := sleepContext(ctx, delay); err != nil {
						return err
					}
					continue
				}
			}
			return fmt.Errorf("%w: HTTP %d", ErrUnavailable, resp.StatusCode)
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
			_ = resp.Body.Close()
			return fmt.Errorf("Yike API returned HTTP %d", resp.StatusCode)
		}

		data, err := io.ReadAll(io.LimitReader(resp.Body, maxJSONBytes+1))
		_ = resp.Body.Close()
		if err != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return ctxErr
			}
			if attempt+1 < attempts {
				if err := c.waitAPIRetry(ctx, attempt, ""); err != nil {
					return err
				}
				continue
			}
			return fmt.Errorf("%w: read Yike API response: %v", ErrUnavailable, err)
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
	return fmt.Errorf("%w: Yike API retries exhausted", ErrUnavailable)
}

func (c *Client) apiAttempts() int {
	if c.apiMaxAttempts < 1 {
		return 1
	}
	return c.apiMaxAttempts
}

func (c *Client) waitAPIRetry(ctx context.Context, attempt int, retryAfter string) error {
	delay, allowed := c.apiRetryDelay(attempt, retryAfter)
	if !allowed {
		return nil
	}
	return sleepContext(ctx, delay)
}

func (c *Client) apiRetryDelay(attempt int, retryAfter string) (time.Duration, bool) {
	maxDelay := c.apiRetryMaxDelay
	if maxDelay <= 0 {
		maxDelay = defaultAPIRetryMaxDelay
	}
	if value, ok := parseRetryAfter(retryAfter, time.Now()); ok {
		if value > maxDelay {
			return 0, false
		}
		return value, true
	}

	delay := c.apiRetryBaseDelay
	if delay < 0 {
		delay = 0
	}
	for i := 0; i < attempt && delay < maxDelay; i++ {
		if delay > maxDelay/2 {
			delay = maxDelay
			break
		}
		delay *= 2
	}
	if delay > maxDelay {
		delay = maxDelay
	}
	return delay, true
}

func parseRetryAfter(value string, now time.Time) (time.Duration, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	if seconds, err := strconv.ParseInt(value, 10, 64); err == nil {
		if seconds < 0 || seconds > int64((time.Duration(1<<63-1))/time.Second) {
			return 0, false
		}
		return time.Duration(seconds) * time.Second, true
	}
	when, err := http.ParseTime(value)
	if err != nil {
		return 0, false
	}
	delay := when.Sub(now)
	if delay < 0 {
		delay = 0
	}
	return delay, true
}

func sleepContext(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return ctx.Err()
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
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
	Errno   int    `json:"errno"`
	Errmsg  string `json:"errmsg"`
	Message string `json:"message"`
}

func (e apiEnvelope) Err() error {
	message := strings.TrimSpace(e.Errmsg)
	if message == "" {
		message = strings.TrimSpace(e.Message)
	}
	detail := ""
	if message != "" {
		detail = ": " + message
	}

	switch e.Errno {
	case 0:
		return nil
	case -6, -9, -10, -12, 9019:
		return fmt.Errorf("%w: API errno %d%s", ErrAuthentication, e.Errno, detail)
	case 50005:
		return fmt.Errorf("%w: API errno 50005%s", ErrRateLimited, detail)
	case 50805:
		return fmt.Errorf("Yike API errno 50805: album already joined%s", detail)
	case 50820:
		return fmt.Errorf("Yike API errno 50820: no shared albums found%s", detail)
	default:
		lower := strings.ToLower(message)
		if strings.Contains(lower, "login") || strings.Contains(message, "登录") {
			return fmt.Errorf("%w: API errno %d%s", ErrAuthentication, e.Errno, detail)
		}
		return fmt.Errorf("Yike API errno %d%s", e.Errno, detail)
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
