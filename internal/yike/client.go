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
	"sync"
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
	defaultAPIMinInterval                = 500 * time.Millisecond
	defaultAPIRateLimitBaseDelay         = 2 * time.Second
	defaultDownloadLinkBatchSize         = 20
)

var (
	ErrAuthentication = errors.New("Yike authentication failed")
	ErrRateLimited    = errors.New("Yike request rate limited")
	ErrUnavailable    = errors.New("Yike service unavailable")
	ErrNoAlbums       = errors.New("Yike has no shared albums")
)

type Client struct {
	baseURL                   string
	cookie                    string
	httpClient                *http.Client
	userAgent                 string
	downloadHeaderTimeout     time.Duration
	downloadIdleTimeout       time.Duration
	apiMaxAttempts            int
	apiRetryBaseDelay         time.Duration
	apiRetryMaxDelay          time.Duration
	apiMinInterval            time.Duration
	apiRateLimitBaseDelay     time.Duration
	apiSlotMu                 sync.Mutex
	apiNextSlot               time.Time
	downloadLinkMu            sync.Mutex
	downloadLinkQueue         []int64
	downloadLinkQueued        map[int64]struct{}
	downloadLinkCache         map[int64]DownloadLink
	downloadLinkBatchDisabled bool
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
		apiMinInterval:        defaultAPIMinInterval,
		apiRateLimitBaseDelay: defaultAPIRateLimitBaseDelay,
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

const (
	fileCursorV1Prefix = "xdrive-yike-v1:"
	fileCursorV2Prefix = "xdrive-yike-v2:"
)

func (c *Client) ListFilesPage(ctx context.Context, cursor string) (FileList, error) {
	switch {
	case strings.HasPrefix(cursor, fileCursorV2Prefix):
		return c.listFilesPageV2(ctx, strings.TrimPrefix(cursor, fileCursorV2Prefix))
	case strings.HasPrefix(cursor, fileCursorV1Prefix):
		return c.listFilesPageV1(ctx, strings.TrimPrefix(cursor, fileCursorV1Prefix))
	case cursor != "":
		// Compatibility with callers that persisted or supplied an old raw v1 cursor.
		return c.listFilesPageV1(ctx, cursor)
	}

	// Prefer the newer timeline shape because current Yike Web responses can
	// expose the original user-facing filename there. Keep v1 as a compatibility
	// fallback for accounts/endpoints where v2 is unavailable.
	page, err := c.listFilesPageV2(ctx, "")
	if err == nil && (len(page.List) != 0 || page.HasNext()) {
		return page, nil
	}
	if err != nil && !canFallbackFromFileListV2(err) {
		return FileList{}, err
	}
	return c.listFilesPageV1(ctx, "")
}

func canFallbackFromFileListV2(err error) bool {
	return err == nil ||
		(!errors.Is(err, ErrAuthentication) &&
			!errors.Is(err, ErrRateLimited) &&
			!errors.Is(err, ErrUnavailable))
}

func (c *Client) listFilesPageV2(ctx context.Context, cursor string) (FileList, error) {
	query := url.Values{
		"clienttype":     {"70"},
		"web":            {"1"},
		"need_thumbnail": {"0"},
		"need_original":  {"1"},
		"limit":          {"100"},
	}
	if cursor == "" {
		query.Set("cursor", "0")
	} else {
		query.Set("cursor", cursor)
	}
	page, err := c.fetchFileListPage(ctx, "/file/v2/list", query)
	if err != nil {
		return FileList{}, err
	}
	tagFileListCursor(&page, fileCursorV2Prefix)
	return page, nil
}

func (c *Client) listFilesPageV1(ctx context.Context, cursor string) (FileList, error) {
	query := url.Values{
		"need_thumbnail":     {"0"},
		"need_filter_hidden": {"0"},
	}
	if cursor != "" {
		query.Set("cursor", cursor)
	}
	page, err := c.fetchFileListPage(ctx, "/file/v1/list", query)
	if err != nil {
		return FileList{}, err
	}
	tagFileListCursor(&page, fileCursorV1Prefix)
	return page, nil
}

func (c *Client) fetchFileListPage(ctx context.Context, endpoint string, query url.Values) (FileList, error) {
	var out struct {
		apiEnvelope
		FileList
		Data *FileList `json:"data,omitempty"`
	}
	if err := c.getJSON(ctx, endpoint, query, &out); err != nil {
		return FileList{}, err
	}
	page := out.FileList
	if out.Data != nil && len(page.List) == 0 && len(page.Items) == 0 && len(page.Files) == 0 &&
		len(page.FileList) == 0 && len(page.FileListCompact) == 0 && page.HasMore == 0 && page.Cursor == "" {
		page = *out.Data
	}
	page.Normalize()
	return page, validatePage(page.Page)
}

func tagFileListCursor(page *FileList, prefix string) {
	if page == nil || !page.HasNext() {
		return
	}
	page.Cursor = FlexibleString(prefix + string(page.Cursor))
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
		if errors.Is(err, ErrNoAlbums) {
			return AlbumList{}, nil
		}
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
	for i := range out.List {
		out.List[i].File.Normalize()
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

func (c *Client) QueueDownloadFileLinks(fsids []int64) {
	if c == nil || len(fsids) == 0 {
		return
	}
	c.downloadLinkMu.Lock()
	defer c.downloadLinkMu.Unlock()
	if c.downloadLinkBatchDisabled {
		return
	}
	if c.downloadLinkQueued == nil {
		c.downloadLinkQueued = make(map[int64]struct{})
	}
	for _, fsid := range fsids {
		if fsid <= 0 {
			continue
		}
		if c.downloadLinkCache != nil {
			if _, ok := c.downloadLinkCache[fsid]; ok {
				continue
			}
		}
		if _, ok := c.downloadLinkQueued[fsid]; ok {
			continue
		}
		c.downloadLinkQueued[fsid] = struct{}{}
		c.downloadLinkQueue = append(c.downloadLinkQueue, fsid)
	}
}

func (c *Client) DownloadFileLink(ctx context.Context, fsid int64) (DownloadLink, error) {
	if fsid <= 0 {
		return DownloadLink{}, fmt.Errorf("fsid must be positive")
	}
	if link, ok := c.takeCachedDownloadLink(fsid); ok {
		return link, nil
	}
	batch := c.takeDownloadLinkBatch(fsid)
	if len(batch) > 1 {
		links, err := c.downloadFileLinksBatch(ctx, batch)
		if err != nil {
			if errors.Is(err, ErrRateLimited) || errors.Is(err, ErrAuthentication) {
				return DownloadLink{}, err
			}
			c.disableDownloadLinkBatch()
		} else {
			c.storeDownloadLinks(fsid, links)
			if link, ok := links[fsid]; ok {
				return link, nil
			}
			if len(links) == 0 {
				c.disableDownloadLinkBatch()
			}
		}
	}
	return c.downloadFileLinkSingle(ctx, fsid)
}

func (c *Client) downloadFileLinkSingle(ctx context.Context, fsid int64) (DownloadLink, error) {
	var out struct {
		apiEnvelope
		DLink string `json:"dlink"`
	}
	query := url.Values{
		"fsid":       {strconv.FormatInt(fsid, 10)},
		"clienttype": {"70"},
	}
	if err := c.getJSONNoRateLimitRetry(ctx, "/file/v2/download", query, &out); err != nil {
		return DownloadLink{}, err
	}
	if strings.TrimSpace(out.DLink) == "" {
		return DownloadLink{}, fmt.Errorf("Yike download response returned no dlink")
	}
	return c.newDownloadLink(out.DLink), nil
}

func (c *Client) downloadFileLinksBatch(ctx context.Context, fsids []int64) (map[int64]DownloadLink, error) {
	if len(fsids) == 0 {
		return map[int64]DownloadLink{}, nil
	}
	if len(fsids) > defaultDownloadLinkBatchSize {
		fsids = fsids[:defaultDownloadLinkBatchSize]
	}
	encodedIDs := make([]string, 0, len(fsids))
	allowed := make(map[int64]struct{}, len(fsids))
	for _, fsid := range fsids {
		if fsid <= 0 {
			continue
		}
		encodedIDs = append(encodedIDs, strconv.FormatInt(fsid, 10))
		allowed[fsid] = struct{}{}
	}
	if len(encodedIDs) == 0 {
		return map[int64]DownloadLink{}, nil
	}
	rawIDs, err := json.Marshal(encodedIDs)
	if err != nil {
		return nil, fmt.Errorf("encode Yike dlink batch: %w", err)
	}
	query := url.Values{
		"clienttype": {"70"},
		"web":        {"1"},
		"fsidlist":   {string(rawIDs)},
		"need_dlink": {"1"},
	}
	var payload any
	if err := c.getJSONNoRateLimitRetry(ctx, "/file/v1/info", query, &payload); err != nil {
		return nil, err
	}
	rawLinks := make(map[int64]string)
	collectDownloadLinkHints(payload, rawLinks)
	links := make(map[int64]DownloadLink)
	for fsid, rawURL := range rawLinks {
		if _, ok := allowed[fsid]; !ok || strings.TrimSpace(rawURL) == "" {
			continue
		}
		links[fsid] = c.newDownloadLink(rawURL)
	}
	return links, nil
}

func collectDownloadLinkHints(value any, out map[int64]string) {
	switch typed := value.(type) {
	case []any:
		for _, item := range typed {
			collectDownloadLinkHints(item, out)
		}
	case map[string]any:
		fsid := firstPositiveInt64(typed["fsid"], typed["fs_id"], typed["file_id"])
		rawURL := firstNonEmptyString(typed["dlink"], typed["download_url"], typed["url"])
		if fsid > 0 && rawURL != "" {
			out[fsid] = rawURL
		}
		for _, item := range typed {
			collectDownloadLinkHints(item, out)
		}
	}
}

func firstPositiveInt64(values ...any) int64 {
	for _, value := range values {
		switch typed := value.(type) {
		case float64:
			candidate := int64(typed)
			if candidate > 0 && float64(candidate) == typed {
				return candidate
			}
		case string:
			candidate, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
			if err == nil && candidate > 0 {
				return candidate
			}
		}
	}
	return 0
}

func firstNonEmptyString(values ...any) string {
	for _, value := range values {
		if candidate, ok := value.(string); ok {
			if candidate = strings.TrimSpace(candidate); candidate != "" {
				return candidate
			}
		}
	}
	return ""
}

func (c *Client) newDownloadLink(rawURL string) DownloadLink {
	return DownloadLink{
		URL: strings.TrimSpace(rawURL),
		Headers: map[string]string{
			"User-Agent": c.userAgent,
			"Referer":    "https://photo.baidu.com/",
		},
	}
}

func (c *Client) takeCachedDownloadLink(fsid int64) (DownloadLink, bool) {
	c.downloadLinkMu.Lock()
	defer c.downloadLinkMu.Unlock()
	if c.downloadLinkCache == nil {
		return DownloadLink{}, false
	}
	link, ok := c.downloadLinkCache[fsid]
	if ok {
		delete(c.downloadLinkCache, fsid)
	}
	return link, ok
}

func (c *Client) takeDownloadLinkBatch(fsid int64) []int64 {
	c.downloadLinkMu.Lock()
	defer c.downloadLinkMu.Unlock()
	if c.downloadLinkBatchDisabled {
		return nil
	}
	batch := []int64{fsid}
	if c.downloadLinkQueued != nil {
		delete(c.downloadLinkQueued, fsid)
	}
	remaining := c.downloadLinkQueue[:0]
	for _, queued := range c.downloadLinkQueue {
		if queued == fsid {
			continue
		}
		if len(batch) < defaultDownloadLinkBatchSize {
			if c.downloadLinkCache == nil {
				batch = append(batch, queued)
				delete(c.downloadLinkQueued, queued)
				continue
			}
			if _, cached := c.downloadLinkCache[queued]; !cached {
				batch = append(batch, queued)
				delete(c.downloadLinkQueued, queued)
				continue
			}
		}
		remaining = append(remaining, queued)
	}
	c.downloadLinkQueue = append([]int64(nil), remaining...)
	return batch
}

func (c *Client) storeDownloadLinks(requested int64, links map[int64]DownloadLink) {
	if len(links) == 0 {
		return
	}
	c.downloadLinkMu.Lock()
	defer c.downloadLinkMu.Unlock()
	if c.downloadLinkCache == nil {
		c.downloadLinkCache = make(map[int64]DownloadLink)
	}
	for fsid, link := range links {
		if fsid != requested && strings.TrimSpace(link.URL) != "" {
			c.downloadLinkCache[fsid] = link
		}
	}
}

func (c *Client) disableDownloadLinkBatch() {
	c.downloadLinkMu.Lock()
	defer c.downloadLinkMu.Unlock()
	c.downloadLinkBatchDisabled = true
	c.downloadLinkQueue = nil
	c.downloadLinkQueued = nil
	c.downloadLinkCache = nil
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
		if err := c.waitAPISlot(ctx); err != nil {
			return DownloadLink{}, err
		}
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

		if resp.StatusCode == http.StatusTooManyRequests {
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
			_ = resp.Body.Close()
			return DownloadLink{}, fmt.Errorf("%w: HTTP %d", ErrRateLimited, resp.StatusCode)
		}
		if resp.StatusCode >= 500 {
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
	return c.getJSONWithRateLimitRetry(ctx, path, query, target, true)
}

func (c *Client) getJSONNoRateLimitRetry(ctx context.Context, path string, query url.Values, target any) error {
	return c.getJSONWithRateLimitRetry(ctx, path, query, target, false)
}

func (c *Client) getJSONWithRateLimitRetry(ctx context.Context, path string, query url.Values, target any, retryRateLimit bool) error {
	attempts := c.apiAttempts()
	for attempt := 0; attempt < attempts; attempt++ {
		if err := c.waitAPISlot(ctx); err != nil {
			return err
		}
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
			if !retryRateLimit {
				return fmt.Errorf("%w: HTTP %d", ErrRateLimited, resp.StatusCode)
			}
			if attempt+1 < attempts {
				if delay, allowed := c.apiRateLimitDelay(attempt, retryAfter); allowed {
					c.reserveAPICooldown(delay)
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
		apiErr := envelope.Err()
		if apiErr == nil {
			return nil
		}
		if retryRateLimit && errors.Is(apiErr, ErrRateLimited) && attempt+1 < attempts {
			if delay, allowed := c.apiRateLimitDelay(attempt, ""); allowed {
				c.reserveAPICooldown(delay)
				if err := sleepContext(ctx, delay); err != nil {
					return err
				}
				continue
			}
		}
		return apiErr
	}
	return fmt.Errorf("%w: Yike API retries exhausted", ErrUnavailable)
}

func (c *Client) waitAPISlot(ctx context.Context) error {
	interval := c.apiMinInterval
	if interval <= 0 {
		return nil
	}
	now := time.Now()
	c.apiSlotMu.Lock()
	slot := now
	if c.apiNextSlot.After(slot) {
		slot = c.apiNextSlot
	}
	c.apiNextSlot = slot.Add(interval)
	c.apiSlotMu.Unlock()
	if delay := time.Until(slot); delay > 0 {
		return sleepContext(ctx, delay)
	}
	return nil
}

func (c *Client) reserveAPICooldown(delay time.Duration) {
	if delay <= 0 {
		return
	}
	deadline := time.Now().Add(delay)
	c.apiSlotMu.Lock()
	if c.apiNextSlot.Before(deadline) {
		c.apiNextSlot = deadline
	}
	c.apiSlotMu.Unlock()
}

func (c *Client) apiRateLimitDelay(attempt int, retryAfter string) (time.Duration, bool) {
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
	delay := c.apiRateLimitBaseDelay
	if delay <= 0 {
		delay = defaultAPIRateLimitBaseDelay
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
		return fmt.Errorf("%w: API errno 50820%s", ErrNoAlbums, detail)
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
	if page.HasNext() && strings.TrimSpace(string(page.Cursor)) == "" {
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
		next := strings.TrimSpace(string(page.Cursor))
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
