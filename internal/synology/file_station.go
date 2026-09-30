package synology

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

var (
	ErrFileStationMissing   = errors.New("Synology File Station API is unavailable")
	ErrFileStationOperation = errors.New("Synology File Station operation failed")
)

const (
	fileStationSessionName = "FileStation"
	fileStationPageMax     = 5000
)

type FileStationTime struct {
	ATime  int64 `json:"atime,omitempty"`
	MTime  int64 `json:"mtime,omitempty"`
	CTime  int64 `json:"ctime,omitempty"`
	CRTime int64 `json:"crtime,omitempty"`
}

type FileStationAdditional struct {
	RealPath       string          `json:"real_path,omitempty"`
	Size           int64           `json:"size,omitempty"`
	Time           FileStationTime `json:"time,omitempty"`
	Type           string          `json:"type,omitempty"`
	MountPointType string          `json:"mount_point_type,omitempty"`
}

type FileStationEntry struct {
	Name       string                `json:"name"`
	Path       string                `json:"path"`
	IsDir      bool                  `json:"isdir"`
	Additional FileStationAdditional `json:"additional,omitempty"`
}

func (e FileStationEntry) FileSize() int64 {
	if e.IsDir || e.Additional.Size < 0 {
		return 0
	}
	return e.Additional.Size
}

func (e FileStationEntry) ModifiedAt() *time.Time {
	if e.Additional.Time.MTime <= 0 {
		return nil
	}
	value := time.Unix(e.Additional.Time.MTime, 0).UTC()
	return &value
}

type FileStationPage struct {
	Offset  int
	Total   int
	Entries []FileStationEntry
}

type FileStationSession struct {
	client  *Client
	apis    map[string]apiInfo
	authAPI apiInfo

	mu     sync.Mutex
	auth   authData
	closed bool
}

func (c *Client) ConnectFileStation(ctx context.Context) (*FileStationSession, error) {
	apis, err := c.fileStationAPIInfo(ctx)
	if err != nil {
		return nil, err
	}
	authAPI, ok := apis["SYNO.API.Auth"]
	if !ok || authAPI.MaxVersion < 1 {
		return nil, fmt.Errorf("%w: SYNO.API.Auth is missing", ErrUnavailable)
	}
	for _, required := range []string{"SYNO.FileStation.List", "SYNO.FileStation.Download"} {
		if info, ok := apis[required]; !ok || info.MaxVersion < 1 {
			return nil, fmt.Errorf("%w: %s is missing", ErrFileStationMissing, required)
		}
	}
	auth, err := c.fileStationLogin(ctx, authAPI)
	if err != nil {
		return nil, err
	}
	return &FileStationSession{client: c, apis: apis, authAPI: authAPI, auth: auth}, nil
}

func (c *Client) TestFileStation(ctx context.Context) (AccountInfo, error) {
	session, err := c.ConnectFileStation(ctx)
	if err != nil {
		return AccountInfo{}, err
	}
	defer func() {
		logoutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = session.Close(logoutCtx)
	}()
	if _, err := session.ListSharesPage(ctx, 0, 1); err != nil {
		return AccountInfo{}, fmt.Errorf("verify Synology File Station session: %w", err)
	}
	return AccountInfo{Username: c.username}, nil
}

func (c *Client) fileStationAPIInfo(ctx context.Context) (map[string]apiInfo, error) {
	values := url.Values{}
	values.Set("api", "SYNO.API.Info")
	values.Set("version", "1")
	values.Set("method", "query")
	values.Set("query", strings.Join([]string{
		"SYNO.API.Auth",
		"SYNO.FileStation.List",
		"SYNO.FileStation.Download",
		"SYNO.FileStation.MD5",
	}, ","))
	endpoint := c.baseURL + "/webapi/query.cgi?" + values.Encode()
	var envelope apiEnvelope
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &envelope); err != nil {
		return nil, err
	}
	if !envelope.Success {
		return nil, fileStationAPIError(envelope)
	}
	var out map[string]apiInfo
	if err := json.Unmarshal(envelope.Data, &out); err != nil {
		return nil, fmt.Errorf("%w: decode File Station API info: %v", ErrUnavailable, err)
	}
	return out, nil
}

func (c *Client) fileStationLogin(ctx context.Context, authAPI apiInfo) (authData, error) {
	version := authAPI.MaxVersion
	if version > 3 {
		version = 3
	}
	if version < 1 {
		version = 1
	}
	values := url.Values{}
	values.Set("api", "SYNO.API.Auth")
	values.Set("version", strconv.Itoa(version))
	values.Set("method", "login")
	values.Set("account", c.username)
	values.Set("passwd", c.password)
	values.Set("session", fileStationSessionName)
	values.Set("format", "sid")
	if version >= 3 {
		values.Set("enable_syno_token", "yes")
	}
	endpoint, err := c.webAPIEndpoint(authAPI.Path)
	if err != nil {
		return authData{}, err
	}
	var envelope apiEnvelope
	if err := c.doJSON(ctx, http.MethodPost, endpoint, strings.NewReader(values.Encode()), &envelope); err != nil {
		return authData{}, err
	}
	if !envelope.Success {
		return authData{}, apiError(envelope)
	}
	var data authData
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		return authData{}, fmt.Errorf("%w: decode File Station login response: %v", ErrUnavailable, err)
	}
	if strings.TrimSpace(data.SID) == "" {
		return authData{}, fmt.Errorf("%w: File Station login response did not contain sid", ErrAuthentication)
	}
	return data, nil
}

func (c *Client) fileStationLogout(ctx context.Context, authAPI apiInfo, sid string) error {
	if strings.TrimSpace(sid) == "" {
		return nil
	}
	version := authAPI.MaxVersion
	if version > 6 {
		version = 6
	}
	if version < 1 {
		version = 1
	}
	values := url.Values{}
	values.Set("api", "SYNO.API.Auth")
	values.Set("version", strconv.Itoa(version))
	values.Set("method", "logout")
	values.Set("session", fileStationSessionName)
	values.Set("_sid", sid)
	endpoint, err := c.webAPIEndpoint(authAPI.Path)
	if err != nil {
		return err
	}
	var envelope apiEnvelope
	if err := c.doJSON(ctx, http.MethodPost, endpoint, strings.NewReader(values.Encode()), &envelope); err != nil {
		return err
	}
	if !envelope.Success {
		return apiError(envelope)
	}
	return nil
}

func (s *FileStationSession) Close(ctx context.Context) error {
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
	return s.client.fileStationLogout(ctx, s.authAPI, auth.SID)
}

func (s *FileStationSession) authSnapshot() (authData, error) {
	if s == nil || s.client == nil {
		return authData{}, fmt.Errorf("%w: File Station session is unavailable", ErrUnavailable)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return authData{}, fmt.Errorf("%w: File Station session is closed", ErrUnavailable)
	}
	return s.auth, nil
}

func (s *FileStationSession) reauthenticate(ctx context.Context, staleSID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return fmt.Errorf("%w: File Station session is closed", ErrUnavailable)
	}
	if strings.TrimSpace(s.auth.SID) != strings.TrimSpace(staleSID) {
		return nil
	}
	auth, err := s.client.fileStationLogin(ctx, s.authAPI)
	if err != nil {
		return err
	}
	s.auth = auth
	return nil
}

func (s *FileStationSession) MD5Available() bool {
	if s == nil {
		return false
	}
	info, ok := s.apis["SYNO.FileStation.MD5"]
	return ok && info.MaxVersion >= 1
}

func (s *FileStationSession) ListSharesPage(ctx context.Context, offset, limit int) (FileStationPage, error) {
	return s.listPage(ctx, "list_share", "", offset, limit)
}

func (s *FileStationSession) ListFolderPage(ctx context.Context, folderPath string, offset, limit int) (FileStationPage, error) {
	normalized, err := NormalizeFileStationPath(folderPath)
	if err != nil {
		return FileStationPage{}, err
	}
	return s.listPage(ctx, "list", normalized, offset, limit)
}

func (s *FileStationSession) listPage(ctx context.Context, method, folderPath string, offset, limit int) (FileStationPage, error) {
	if offset < 0 || limit <= 0 || limit > fileStationPageMax {
		return FileStationPage{}, fmt.Errorf("invalid File Station pagination")
	}
	var envelope apiEnvelope
	err := s.doFileStationJSON(ctx, "SYNO.FileStation.List", method, func(values url.Values) {
		values.Set("offset", strconv.Itoa(offset))
		values.Set("limit", strconv.Itoa(limit))
		values.Set("sort_by", strconv.Quote("name"))
		values.Set("sort_direction", strconv.Quote("asc"))
		if folderPath == "" {
			values.Set("additional", `["real_path","time","mount_point_type"]`)
		} else {
			values.Set("folder_path", strconv.Quote(folderPath))
			values.Set("additional", `["real_path","size","time","type","mount_point_type"]`)
		}
	}, &envelope)
	if err != nil {
		return FileStationPage{}, err
	}
	var data struct {
		Offset int                `json:"offset"`
		Total  int                `json:"total"`
		Shares []FileStationEntry `json:"shares"`
		Files  []FileStationEntry `json:"files"`
	}
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		return FileStationPage{}, fmt.Errorf("%w: decode File Station listing: %v", ErrUnavailable, err)
	}
	entries := data.Files
	if method == "list_share" {
		entries = data.Shares
	}
	for i := range entries {
		normalized, err := NormalizeFileStationPath(entries[i].Path)
		if err != nil {
			return FileStationPage{}, fmt.Errorf("%w: invalid File Station result path: %v", ErrUnavailable, err)
		}
		entries[i].Path = normalized
		entries[i].Name = strings.TrimSpace(entries[i].Name)
		if entries[i].Name == "" {
			entries[i].Name = path.Base(normalized)
		}
		if entries[i].Additional.Size < 0 {
			return FileStationPage{}, fmt.Errorf("%w: negative File Station size for %q", ErrUnavailable, normalized)
		}
	}
	return FileStationPage{Offset: data.Offset, Total: data.Total, Entries: entries}, nil
}

func (s *FileStationSession) OpenPath(ctx context.Context, remotePath string, offset int64) (io.ReadCloser, error) {
	normalized, err := NormalizeFileStationPath(remotePath)
	if err != nil {
		return nil, err
	}
	if offset < 0 {
		return nil, fmt.Errorf("download offset must be zero or greater")
	}
	authRetried := false
	attempts := s.client.apiAttempts()
	for attempt := 0; attempt < attempts; attempt++ {
		auth, err := s.authSnapshot()
		if err != nil {
			return nil, err
		}
		body, err := s.openPathOnce(ctx, normalized, offset, auth)
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
	return nil, fmt.Errorf("%w: File Station download retries exhausted", ErrUnavailable)
}

func (s *FileStationSession) openPathOnce(
	ctx context.Context,
	remotePath string,
	offset int64,
	auth authData,
) (io.ReadCloser, error) {
	info, ok := s.apis["SYNO.FileStation.Download"]
	if !ok || info.MaxVersion < 1 {
		return nil, fmt.Errorf("%w: SYNO.FileStation.Download is missing", ErrFileStationMissing)
	}
	values := s.fileStationBaseValues("SYNO.FileStation.Download", "download", auth)
	encodedPath, _ := json.Marshal([]string{remotePath})
	values.Set("path", string(encodedPath))
	values.Set("mode", strconv.Quote("open"))
	endpoint, err := s.client.webAPIEndpoint(info.Path)
	if err != nil {
		return nil, err
	}
	endpoint += "?" + values.Encode()

	requestCtx, cancel := context.WithCancel(ctx)
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		cancel()
		return nil, err
	}
	req.Header.Set("Accept", "application/octet-stream")
	req.Header.Set("Accept-Encoding", "identity")
	req.Header.Set("User-Agent", "xdrive-synology-files-pull/1")
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
		return nil, fmt.Errorf("%w: File Station download returned HTTP %s", ErrAuthentication, resp.Status)
	}
	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
		retryAfter := resp.Header.Get("Retry-After")
		_ = resp.Body.Close()
		cancel()
		return nil, &retryableDownloadOpenError{
			err:        fmt.Errorf("%w: File Station download returned HTTP %s", ErrUnavailable, resp.Status),
			retryAfter: retryAfter,
		}
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		_ = resp.Body.Close()
		cancel()
		return nil, fmt.Errorf("%w: File Station download returned HTTP %s", ErrFileStationOperation, resp.Status)
	}
	if strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "application/json") {
		data, readErr := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
		_ = resp.Body.Close()
		cancel()
		if readErr != nil {
			return nil, fmt.Errorf("%w: read File Station download error: %v", ErrUnavailable, readErr)
		}
		var envelope apiEnvelope
		if json.Unmarshal(data, &envelope) == nil && !envelope.Success {
			return nil, fileStationAPIError(envelope)
		}
		return nil, fmt.Errorf("%w: File Station download returned JSON", ErrFileStationOperation)
	}

	body := &idleTimeoutReadCloser{
		body: resp.Body, cancel: cancel, parent: ctx,
		timeout: s.client.downloadIdleTimeout,
	}
	if offset > 0 && resp.StatusCode == http.StatusOK {
		if _, err := io.CopyN(io.Discard, body, offset); err != nil {
			_ = body.Close()
			return nil, fmt.Errorf("%w: skip File Station download to offset %d: %v", ErrUnavailable, offset, err)
		}
	}
	return body, nil
}

func (s *FileStationSession) doFileStationJSON(
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
		values := s.fileStationBaseValues(apiName, method, auth)
		if configure != nil {
			configure(values)
		}
		info, ok := s.apis[apiName]
		if !ok || info.MaxVersion < 1 {
			return fmt.Errorf("%w: %s is missing", ErrFileStationMissing, apiName)
		}
		endpoint, err := s.client.webAPIEndpoint(info.Path)
		if err != nil {
			return err
		}
		var envelope apiEnvelope
		err = s.client.doJSON(ctx, http.MethodPost, endpoint, strings.NewReader(values.Encode()), &envelope)
		if err == nil && envelope.Success {
			*out = envelope
			return nil
		}
		if err == nil {
			err = fileStationAPIError(envelope)
		}
		if authAttempt == 0 && (errors.Is(err, ErrSessionExpired) || errors.Is(err, ErrAuthentication)) {
			if err := s.reauthenticate(ctx, auth.SID); err != nil {
				return err
			}
			continue
		}
		return err
	}
	return fmt.Errorf("%w: File Station reauthentication exhausted", ErrAuthentication)
}

func (s *FileStationSession) fileStationBaseValues(apiName, method string, auth authData) url.Values {
	values := url.Values{}
	values.Set("api", apiName)
	info := s.apis[apiName]
	version := info.MaxVersion
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

func NormalizeFileStationPath(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || !strings.HasPrefix(value, "/") || strings.ContainsRune(value, 0) ||
		strings.Contains(value, "\\") || !utf8.ValidString(value) {
		return "", fmt.Errorf("File Station path must be an absolute UTF-8 DSM path")
	}
	clean := path.Clean(value)
	if clean == "." || clean == "" || !strings.HasPrefix(clean, "/") {
		return "", fmt.Errorf("invalid File Station path")
	}
	return clean, nil
}

func fileStationAPIError(envelope apiEnvelope) error {
	code := 0
	if envelope.Error != nil {
		code = envelope.Error.Code
	}
	switch code {
	case 106, 119:
		return &DSMAPIError{Code: code, Cause: ErrSessionExpired}
	case 107:
		return &DSMAPIError{Code: code, Cause: ErrMultipleLogin}
	case 105, 403, 404, 405, 406, 407:
		return &DSMAPIError{Code: code, Cause: ErrPermissionDenied}
	case 402:
		return &DSMAPIError{Code: code, Cause: ErrUnavailable}
	default:
		return &DSMAPIError{Code: code, Cause: ErrFileStationOperation}
	}
}
