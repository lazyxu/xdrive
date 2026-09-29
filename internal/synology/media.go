package synology

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
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

type Session struct {
	client  *Client
	apis    map[string]apiInfo
	authAPI apiInfo
	auth    authData
	closeMu sync.Mutex
	closed  bool
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
	s.closeMu.Lock()
	defer s.closeMu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	return s.client.logout(ctx, s.authAPI, s.auth.SID)
}

func (s *Session) Available(space Space) bool {
	if s == nil {
		return false
	}
	return spaceAvailable(s.apis, space)
}

func (s *Session) ListFoldersPage(ctx context.Context, space Space, offset, limit int) (FolderPage, error) {
	if err := s.validatePage(space, offset, limit); err != nil {
		return FolderPage{}, err
	}
	apiName, err := folderAPI(space)
	if err != nil {
		return FolderPage{}, err
	}
	values := s.baseValues(apiName, "list")
	values.Set("offset", strconv.Itoa(offset))
	values.Set("limit", strconv.Itoa(limit))

	var envelope apiEnvelope
	if err := s.client.doJSON(ctx, http.MethodPost, s.photosEndpoint(), strings.NewReader(values.Encode()), &envelope); err != nil {
		return FolderPage{}, err
	}
	if !envelope.Success {
		return FolderPage{}, apiError(envelope)
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
	values := s.baseValues(apiName, "list")
	values.Set("offset", strconv.Itoa(offset))
	values.Set("limit", strconv.Itoa(limit))
	values.Set("additional", `["thumbnail"]`)

	var envelope apiEnvelope
	if err := s.client.doJSON(ctx, http.MethodPost, s.photosEndpoint(), strings.NewReader(values.Encode()), &envelope); err != nil {
		return ItemPage{}, err
	}
	if !envelope.Success {
		return ItemPage{}, apiError(envelope)
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

func (s *Session) OpenItem(ctx context.Context, item Item, offset int64) (io.ReadCloser, error) {
	if s == nil || s.client == nil || s.closed {
		return nil, fmt.Errorf("%w: Synology session is closed", ErrUnavailable)
	}
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
	values := s.baseValues(apiName, "download")
	values.Set("unit_id", fmt.Sprintf("[%d]", item.ID))
	if key := item.CacheKey(); key != "" {
		values.Set("cache_key", strconv.Quote(key))
	}
	endpoint := s.photosEndpoint() + "?" + values.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/octet-stream")
	req.Header.Set("Accept-Encoding", "identity")
	req.Header.Set("User-Agent", "xdrive-synology-pull/1")
	if offset > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
	}
	resp, err := s.client.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		_ = resp.Body.Close()
		return nil, fmt.Errorf("%w: download returned HTTP %s", ErrUnavailable, resp.Status)
	}
	if strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "application/json") {
		data, readErr := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
		_ = resp.Body.Close()
		if readErr != nil {
			return nil, fmt.Errorf("%w: read download error: %v", ErrUnavailable, readErr)
		}
		var envelope apiEnvelope
		if json.Unmarshal(data, &envelope) == nil && !envelope.Success {
			return nil, apiError(envelope)
		}
		return nil, fmt.Errorf("%w: download returned JSON", ErrUnavailable)
	}
	if offset > 0 && resp.StatusCode == http.StatusOK {
		if _, err := io.CopyN(io.Discard, resp.Body, offset); err != nil {
			_ = resp.Body.Close()
			return nil, fmt.Errorf("%w: skip to resume offset %d: %v", ErrUnavailable, offset, err)
		}
	}
	return resp.Body, nil
}

func (s *Session) validatePage(space Space, offset, limit int) error {
	if s == nil || s.client == nil || s.closed {
		return fmt.Errorf("%w: Synology session is closed", ErrUnavailable)
	}
	if !s.Available(space) {
		return fmt.Errorf("%w: %s space is unavailable", ErrPhotosMissing, space)
	}
	if offset < 0 || limit <= 0 || limit > 5000 {
		return fmt.Errorf("invalid Synology pagination")
	}
	return nil
}

func (s *Session) baseValues(apiName, method string) url.Values {
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
	values.Set("_sid", s.auth.SID)
	if token := strings.TrimSpace(s.auth.SynoToken); token != "" {
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
