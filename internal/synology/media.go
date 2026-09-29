package synology

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
	"sync"
	"time"
)

type Space string

const (
	SpacePersonal Space = "personal"
	SpaceShared   Space = "shared"

	DefaultPageSize = 500
)

type Folder struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	OwnerUserID int64  `json:"owner_user_id"`
	Parent      int64  `json:"parent"`
}

type Thumbnail struct {
	CacheKey string `json:"cache_key"`
	UnitID   int64  `json:"unit_id"`
}

type ItemAdditional struct {
	Thumbnail Thumbnail `json:"thumbnail"`
}

type Item struct {
	ID          int64          `json:"id"`
	Filename    string         `json:"filename"`
	Filesize    int64          `json:"filesize"`
	FolderID    int64          `json:"folder_id"`
	IndexedTime int64          `json:"indexed_time"`
	OwnerUserID int64          `json:"owner_user_id"`
	Time        int64          `json:"time"`
	Type        string         `json:"type"`
	LiveType    string         `json:"live_type,omitempty"`
	Additional  ItemAdditional `json:"additional"`
	Space       Space          `json:"-"`
}

type Album struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	Type       string `json:"type,omitempty"`
	ItemCount  int64  `json:"item_count,omitempty"`
	CreateTime int64  `json:"create_time,omitempty"`
	Shared     bool   `json:"shared,omitempty"`
	Space      Space  `json:"-"`
}

func (i Item) CacheKey() string {
	return strings.TrimSpace(i.Additional.Thumbnail.CacheKey)
}

type FolderPage struct {
	Offset int
	Total  int
	List   []Folder
}

type ItemPage struct {
	Offset int
	Total  int
	List   []Item
}

type AlbumPage struct {
	Offset int
	Total  int
	List   []Album
}

type Session struct {
	client  *Client
	apis    map[string]apiInfo
	authAPI apiInfo

	mu     sync.Mutex
	auth   authData
	closed bool
}

func (c *Client) Connect(ctx context.Context) (*Session, error) {
	apis, err := c.apiInfo(ctx)
	if err != nil {
		return nil, err
	}
	authAPI, ok := apis["SYNO.API.Auth"]
	if !ok || authAPI.MaxVersion < 1 {
		return nil, fmt.Errorf("%w: SYNO.API.Auth is missing", ErrUnavailable)
	}
	if !spaceAvailable(apis, SpacePersonal) && !spaceAvailable(apis, SpaceShared) {
		return nil, fmt.Errorf("%w: install/enable Synology Photos", ErrPhotosMissing)
	}
	auth, err := c.login(ctx, authAPI)
	if err != nil {
		return nil, err
	}
	return &Session{client: c, apis: apis, authAPI: authAPI, auth: auth}, nil
}

func (s *Session) Close(ctx context.Context) error {
	if s == nil || s.client == nil {
		return nil
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	auth := s.auth
	s.mu.Unlock()
	return s.client.logout(ctx, s.authAPI, auth.SID)
}

func (s *Session) authSnapshot() (authData, error) {
	if s == nil || s.client == nil {
		return authData{}, fmt.Errorf("%w: Synology session is unavailable", ErrUnavailable)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return authData{}, fmt.Errorf("%w: Synology session is closed", ErrUnavailable)
	}
	return s.auth, nil
}

func (s *Session) reauthenticate(ctx context.Context, staleSID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return fmt.Errorf("%w: Synology session is closed", ErrUnavailable)
	}
	if strings.TrimSpace(s.auth.SID) != strings.TrimSpace(staleSID) {
		return nil
	}
	auth, err := s.client.login(ctx, s.authAPI)
	if err != nil {
		return err
	}
	s.auth = auth
	return nil
}

func (s *Session) Available(space Space) bool {
	if s == nil {
		return false
	}
	return spaceAvailable(s.apis, space)
}

func (s *Session) AlbumsAvailable(space Space) bool {
	if s == nil {
		return false
	}
	apiName, err := albumAPI(space)
	if err != nil {
		return false
	}
	itemName, err := itemAPI(space)
	if err != nil {
		return false
	}
	return s.apis[apiName].MaxVersion > 0 && s.apis[itemName].MaxVersion > 0
}

func (s *Session) ListFoldersPage(ctx context.Context, space Space, offset, limit int) (FolderPage, error) {
	if err := s.validatePage(space, offset, limit); err != nil {
		return FolderPage{}, err
	}
	apiName, err := folderAPI(space)
	if err != nil {
		return FolderPage{}, err
	}
	var envelope apiEnvelope
	if err := s.doPhotosJSON(ctx, apiName, "list", func(values url.Values) {
		values.Set("offset", strconv.Itoa(offset))
		values.Set("limit", strconv.Itoa(limit))
	}, &envelope); err != nil {
		return FolderPage{}, err
	}
	var data struct {
		Offset int      `json:"offset"`
		Total  int      `json:"total"`
		List   []Folder `json:"list"`
	}
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		return FolderPage{}, fmt.Errorf("%w: decode Synology folder list: %v", ErrUnavailable, err)
	}
	return FolderPage{Offset: data.Offset, Total: data.Total, List: data.List}, nil
}

func (s *Session) ListItemsPage(ctx context.Context, space Space, offset, limit int) (ItemPage, error) {
	if err := s.validatePage(space, offset, limit); err != nil {
		return ItemPage{}, err
	}
	apiName, err := itemAPI(space)
	if err != nil {
		return ItemPage{}, err
	}
	var envelope apiEnvelope
	if err := s.doPhotosJSON(ctx, apiName, "list", func(values url.Values) {
		values.Set("offset", strconv.Itoa(offset))
		values.Set("limit", strconv.Itoa(limit))
		values.Set("additional", `["thumbnail"]`)
	}, &envelope); err != nil {
		return ItemPage{}, err
	}
	var data struct {
		Offset int    `json:"offset"`
		Total  int    `json:"total"`
		List   []Item `json:"list"`
	}
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		return ItemPage{}, fmt.Errorf("%w: decode Synology item list: %v", ErrUnavailable, err)
	}
	for i := range data.List {
		data.List[i].Space = space
	}
	return ItemPage{Offset: data.Offset, Total: data.Total, List: data.List}, nil
}

func (s *Session) ListAlbumsPage(ctx context.Context, space Space, offset, limit int) (AlbumPage, error) {
	if err := s.validatePage(space, offset, limit); err != nil {
		return AlbumPage{}, err
	}
	if !s.AlbumsAvailable(space) {
		return AlbumPage{}, fmt.Errorf("%w: %s album API is unavailable", ErrPhotosMissing, space)
	}
	apiName, err := albumAPI(space)
	if err != nil {
		return AlbumPage{}, err
	}
	var envelope apiEnvelope
	if err := s.doPhotosJSON(ctx, apiName, "list", func(values url.Values) {
		values.Set("offset", strconv.Itoa(offset))
		values.Set("limit", strconv.Itoa(limit))
	}, &envelope); err != nil {
		return AlbumPage{}, err
	}
	var data struct {
		Offset int     `json:"offset"`
		Total  int     `json:"total"`
		List   []Album `json:"list"`
	}
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		return AlbumPage{}, fmt.Errorf("%w: decode Synology album list: %v", ErrUnavailable, err)
	}
	for i := range data.List {
		data.List[i].Space = space
	}
	return AlbumPage{Offset: data.Offset, Total: data.Total, List: data.List}, nil
}

func (s *Session) ListAlbumItemsPage(ctx context.Context, space Space, albumID int64, offset, limit int) (ItemPage, error) {
	if albumID <= 0 {
		return ItemPage{}, fmt.Errorf("invalid Synology album id %d", albumID)
	}
	if err := s.validatePage(space, offset, limit); err != nil {
		return ItemPage{}, err
	}
	if !s.AlbumsAvailable(space) {
		return ItemPage{}, fmt.Errorf("%w: %s album API is unavailable", ErrPhotosMissing, space)
	}
	apiName, err := itemAPI(space)
	if err != nil {
		return ItemPage{}, err
	}
	var envelope apiEnvelope
	if err := s.doPhotosJSON(ctx, apiName, "list", func(values url.Values) {
		values.Set("id", strconv.FormatInt(albumID, 10))
		values.Set("offset", strconv.Itoa(offset))
		values.Set("limit", strconv.Itoa(limit))
		values.Set("additional", `["thumbnail"]`)
	}, &envelope); err != nil {
		return ItemPage{}, err
	}
	var data struct {
		Offset int    `json:"offset"`
		Total  int    `json:"total"`
		List   []Item `json:"list"`
	}
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		return ItemPage{}, fmt.Errorf("%w: decode Synology album item list: %v", ErrUnavailable, err)
	}
	for i := range data.List {
		data.List[i].Space = space
	}
	return ItemPage{Offset: data.Offset, Total: data.Total, List: data.List}, nil
}

type retryableDownloadOpenError struct {
	err        error
	retryAfter string
}

func (e *retryableDownloadOpenError) Error() string { return e.err.Error() }
func (e *retryableDownloadOpenError) Unwrap() error { return e.err }

func (s *Session) OpenItem(ctx context.Context, item Item, offset int64) (io.ReadCloser, error) {
	authRetried := false
	attempts := s.client.apiAttempts()
	for attempt := 0; attempt < attempts; attempt++ {
		auth, err := s.authSnapshot()
		if err != nil {
			return nil, err
		}
		body, err := s.openItemOnce(ctx, item, offset, auth)
		if err == nil {
			return body, nil
		}
		if !authRetried && (errors.Is(err, ErrSessionExpired) || errors.Is(err, ErrAuthentication)) {
			if err := s.reauthenticate(ctx, auth.SID); err != nil {
				return nil, err
			}
			authRetried = true
			attempt--
			continue
		}
		var retryErr *retryableDownloadOpenError
		if errors.As(err, &retryErr) && attempt+1 < attempts {
			if delay, allowed := s.client.apiRetryDelay(attempt, retryErr.retryAfter); allowed {
				if err := sleepContext(ctx, delay); err != nil {
					return nil, err
				}
				continue
			}
		}
		return nil, err
	}
	return nil, fmt.Errorf("%w: media download retries exhausted", ErrUnavailable)
}

func (s *Session) openItemOnce(ctx context.Context, item Item, offset int64, auth authData) (io.ReadCloser, error) {
	if item.ID <= 0 || offset < 0 {
		return nil, fmt.Errorf("invalid Synology item or offset")
	}
	apiName, err := downloadAPI(item.Space)
	if err != nil {
		return nil, err
	}
	info, ok := s.apis[apiName]
	if !ok || info.MaxVersion < 1 {
		return nil, fmt.Errorf("%w: %s is missing", ErrPhotosMissing, apiName)
	}
	values := s.baseValues(apiName, "download", auth)
	values.Set("unit_id", fmt.Sprintf("[%d]", item.ID))
	if key := item.CacheKey(); key != "" {
		values.Set("cache_key", strconv.Quote(key))
	}
	endpoint := s.photosEndpoint() + "?" + values.Encode()

	requestCtx, cancel := context.WithCancel(ctx)
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		cancel()
		return nil, err
	}
	req.Header.Set("Accept", "application/octet-stream")
	req.Header.Set("Accept-Encoding", "identity")
	req.Header.Set("User-Agent", "xdrive-synology-pull/1")
	if offset > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
	}
	httpClient := s.client.mediaDownloadClient()
	resp, err := httpClient.Do(req)
	if err != nil {
		cancel()
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, ctxErr
		}
		return nil, &retryableDownloadOpenError{err: fmt.Errorf("%w: %v", ErrUnavailable, err)}
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		_ = resp.Body.Close()
		cancel()
		return nil, fmt.Errorf("%w: download returned HTTP %s", ErrAuthentication, resp.Status)
	}
	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
		retryAfter := resp.Header.Get("Retry-After")
		_ = resp.Body.Close()
		cancel()
		return nil, &retryableDownloadOpenError{
			err:        fmt.Errorf("%w: download returned HTTP %s", ErrUnavailable, resp.Status),
			retryAfter: retryAfter,
		}
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		_ = resp.Body.Close()
		cancel()
		return nil, fmt.Errorf("%w: download returned HTTP %s", ErrUnavailable, resp.Status)
	}
	if strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "application/json") {
		data, readErr := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
		_ = resp.Body.Close()
		cancel()
		if readErr != nil {
			return nil, fmt.Errorf("%w: read download error: %v", ErrUnavailable, readErr)
		}
		var envelope apiEnvelope
		if json.Unmarshal(data, &envelope) == nil && !envelope.Success {
			return nil, apiError(envelope)
		}
		return nil, fmt.Errorf("%w: download returned JSON", ErrUnavailable)
	}

	body := &idleTimeoutReadCloser{
		body: resp.Body, cancel: cancel, parent: ctx,
		timeout: s.client.downloadIdleTimeout,
	}
	if offset > 0 && resp.StatusCode == http.StatusOK {
		if _, err := io.CopyN(io.Discard, body, offset); err != nil {
			_ = body.Close()
			return nil, fmt.Errorf("%w: skip to resume offset %d: %v", ErrUnavailable, offset, err)
		}
	}
	return body, nil
}

func (s *Session) doPhotosJSON(
	ctx context.Context,
	apiName string,
	method string,
	configure func(url.Values),
	out *apiEnvelope,
) error {
	for authAttempt := 0; authAttempt < 2; authAttempt++ {
		auth, err := s.authSnapshot()
		if err != nil {
			return err
		}
		values := s.baseValues(apiName, method, auth)
		if configure != nil {
			configure(values)
		}
		var envelope apiEnvelope
		err = s.client.doJSON(ctx, http.MethodPost, s.photosEndpoint(), strings.NewReader(values.Encode()), &envelope)
		if err == nil && envelope.Success {
			*out = envelope
			return nil
		}
		if err == nil {
			err = apiError(envelope)
		}
		if authAttempt == 0 && (errors.Is(err, ErrSessionExpired) || errors.Is(err, ErrAuthentication)) {
			if err := s.reauthenticate(ctx, auth.SID); err != nil {
				return err
			}
			continue
		}
		return err
	}
	return fmt.Errorf("%w: Photos API reauthentication exhausted", ErrAuthentication)
}

func (s *Session) validatePage(space Space, offset, limit int) error {
	if _, err := s.authSnapshot(); err != nil {
		return err
	}
	if !s.Available(space) {
		return fmt.Errorf("%w: %s space is unavailable", ErrPhotosMissing, space)
	}
	if offset < 0 || limit <= 0 || limit > 5000 {
		return fmt.Errorf("invalid Synology pagination")
	}
	return nil
}

func (s *Session) baseValues(apiName, method string, auth authData) url.Values {
	values := url.Values{}
	values.Set("api", apiName)
	version := s.apis[apiName].MaxVersion
	if version > 2 {
		version = 2
	}
	if version < 1 {
		version = 1
	}
	values.Set("version", strconv.Itoa(version))
	values.Set("method", method)
	values.Set("_sid", auth.SID)
	if token := strings.TrimSpace(auth.SynoToken); token != "" {
		values.Set("SynoToken", token)
	}
	return values
}

func (s *Session) photosEndpoint() string {
	return s.client.baseURL + "/photo/webapi/entry.cgi"
}

func spaceAvailable(apis map[string]apiInfo, space Space) bool {
	item, itemErr := itemAPI(space)
	download, downloadErr := downloadAPI(space)
	folder, folderErr := folderAPI(space)
	if itemErr != nil || downloadErr != nil || folderErr != nil {
		return false
	}
	return apis[item].MaxVersion > 0 && apis[download].MaxVersion > 0 && apis[folder].MaxVersion > 0
}

func (c *Client) mediaDownloadClient() http.Client {
	out := *c.http
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
	return n, fmt.Errorf("Synology media download stalled for %s", r.timeout)
}

func (r *idleTimeoutReadCloser) Close() error {
	r.cancel()
	return r.body.Close()
}

func folderAPI(space Space) (string, error) {
	switch space {
	case SpacePersonal:
		return "SYNO.Foto.Browse.Folder", nil
	case SpaceShared:
		return "SYNO.FotoTeam.Browse.Folder", nil
	default:
		return "", fmt.Errorf("unsupported Synology Photos space %q", space)
	}
}

func albumAPI(space Space) (string, error) {
	switch space {
	case SpacePersonal:
		return "SYNO.Foto.Browse.Album", nil
	case SpaceShared:
		return "SYNO.FotoTeam.Browse.Album", nil
	default:
		return "", fmt.Errorf("unsupported Synology Photos space %q", space)
	}
}

func itemAPI(space Space) (string, error) {
	switch space {
	case SpacePersonal:
		return "SYNO.Foto.Browse.Item", nil
	case SpaceShared:
		return "SYNO.FotoTeam.Browse.Item", nil
	default:
		return "", fmt.Errorf("unsupported Synology Photos space %q", space)
	}
}

func downloadAPI(space Space) (string, error) {
	switch space {
	case SpacePersonal:
		return "SYNO.Foto.Download", nil
	case SpaceShared:
		return "SYNO.FotoTeam.Download", nil
	default:
		return "", fmt.Errorf("unsupported Synology Photos space %q", space)
	}
}
