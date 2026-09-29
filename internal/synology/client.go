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
	"time"
)

var (
	ErrAuthentication = errors.New("Synology authentication failed")
	ErrUnavailable    = errors.New("Synology is unavailable")
	ErrPhotosMissing  = errors.New("Synology Photos API is unavailable")
)

type Credential struct {
	BaseURL  string `json:"base_url"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type AccountInfo struct {
	Username string
}

type Client struct {
	baseURL  string
	username string
	password string
	http     *http.Client
}

type apiInfo struct {
	Path       string `json:"path"`
	MinVersion int    `json:"minVersion"`
	MaxVersion int    `json:"maxVersion"`
}

type apiEnvelope struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data"`
	Error   *struct {
		Code int `json:"code"`
	} `json:"error,omitempty"`
}

type authData struct {
	SID       string `json:"sid"`
	SynoToken string `json:"synotoken"`
}

func New(credential Credential) (*Client, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(credential.BaseURL), "/")
	username := strings.TrimSpace(credential.Username)
	password := credential.Password
	if baseURL == "" || username == "" || password == "" {
		return nil, fmt.Errorf("base_url, username and password are required")
	}
	u, err := url.Parse(baseURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" ||
		u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, fmt.Errorf("base_url must be an http(s) DSM origin without path, query or credentials")
	}
	return &Client{
		baseURL:  baseURL,
		username: username,
		password: password,
		http:     &http.Client{Timeout: 0},
	}, nil
}

func (c *Client) Test(ctx context.Context) (AccountInfo, error) {
	apis, err := c.apiInfo(ctx)
	if err != nil {
		return AccountInfo{}, err
	}
	authAPI, ok := apis["SYNO.API.Auth"]
	if !ok || authAPI.MaxVersion < 1 {
		return AccountInfo{}, fmt.Errorf("%w: SYNO.API.Auth is missing", ErrUnavailable)
	}
	personal := apis["SYNO.Foto.Browse.Item"].MaxVersion > 0 && apis["SYNO.Foto.Download"].MaxVersion > 0
	shared := apis["SYNO.FotoTeam.Browse.Item"].MaxVersion > 0 && apis["SYNO.FotoTeam.Download"].MaxVersion > 0
	if !personal && !shared {
		return AccountInfo{}, fmt.Errorf("%w: install/enable Synology Photos", ErrPhotosMissing)
	}

	session, err := c.login(ctx, authAPI)
	if err != nil {
		return AccountInfo{}, err
	}
	defer func() {
		logoutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = c.logout(logoutCtx, authAPI, session.SID)
	}()
	return AccountInfo{Username: c.username}, nil
}

func (c *Client) apiInfo(ctx context.Context) (map[string]apiInfo, error) {
	values := url.Values{}
	values.Set("api", "SYNO.API.Info")
	values.Set("version", "1")
	values.Set("method", "query")
	values.Set("query", strings.Join([]string{
		"SYNO.API.Auth",
		"SYNO.Foto.Browse.Folder",
		"SYNO.Foto.Browse.Item",
		"SYNO.Foto.Download",
		"SYNO.FotoTeam.Browse.Folder",
		"SYNO.FotoTeam.Browse.Item",
		"SYNO.FotoTeam.Download",
	}, ","))
	endpoint := c.baseURL + "/webapi/entry.cgi?" + values.Encode()
	var envelope apiEnvelope
	if err := c.doJSON(ctx, http.MethodGet, endpoint, nil, &envelope); err != nil {
		return nil, err
	}
	if !envelope.Success {
		return nil, apiError(envelope)
	}
	var out map[string]apiInfo
	if err := json.Unmarshal(envelope.Data, &out); err != nil {
		return nil, fmt.Errorf("%w: decode API info: %v", ErrUnavailable, err)
	}
	return out, nil
}

func (c *Client) login(ctx context.Context, authAPI apiInfo) (authData, error) {
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
	values.Set("method", "login")
	values.Set("account", c.username)
	values.Set("passwd", c.password)
	values.Set("session", "SynologyPhotos")
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
		return authData{}, fmt.Errorf("%w: decode login response: %v", ErrUnavailable, err)
	}
	if strings.TrimSpace(data.SID) == "" {
		return authData{}, fmt.Errorf("%w: login response did not contain sid", ErrAuthentication)
	}
	return data, nil
}

func (c *Client) logout(ctx context.Context, authAPI apiInfo, sid string) error {
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
	values.Set("session", "SynologyPhotos")
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

func (c *Client) webAPIEndpoint(apiPath string) (string, error) {
	apiPath = strings.TrimSpace(apiPath)
	if apiPath == "" {
		apiPath = "entry.cgi"
	}
	clean := path.Clean("/" + apiPath)
	if clean == "/" || strings.Contains(clean, "..") {
		return "", fmt.Errorf("%w: invalid API path", ErrUnavailable)
	}
	return c.baseURL + "/webapi" + clean, nil
}

func (c *Client) doJSON(ctx context.Context, method, endpoint string, body io.Reader, out any) error {
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "xdrive-synology-pull/1")
	if body != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("%w: HTTP %s", ErrUnavailable, resp.Status)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(out); err != nil {
		return fmt.Errorf("%w: decode response: %v", ErrUnavailable, err)
	}
	return nil
}

func apiError(envelope apiEnvelope) error {
	code := 0
	if envelope.Error != nil {
		code = envelope.Error.Code
	}
	switch code {
	case 400, 401, 402, 403, 404:
		return fmt.Errorf("%w: DSM API error %d", ErrAuthentication, code)
	default:
		return fmt.Errorf("%w: DSM API error %d", ErrUnavailable, code)
	}
}
