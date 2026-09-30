package synology

import (
	"bytes"
	"context"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	maxJSONBytes                         = 2 << 20
	maxRequestBodyBytes                  = 64 << 10
	defaultAPITimeout                    = 60 * time.Second
	defaultAPIMaxAttempts                = 3
	defaultAPIRetryBaseDelay             = 500 * time.Millisecond
	defaultAPIRetryMaxDelay              = 30 * time.Second
	defaultDownloadResponseHeaderTimeout = 30 * time.Second
	defaultDownloadIdleTimeout           = 60 * time.Second
)

var (
	ErrAuthentication = errors.New("Synology authentication failed")
	ErrSessionExpired = errors.New("Synology session expired")
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
	baseURL               string
	username              string
	password              string
	http                  *http.Client
	apiMaxAttempts        int
	apiRetryBaseDelay     time.Duration
	apiRetryMaxDelay      time.Duration
	downloadHeaderTimeout time.Duration
	downloadIdleTimeout   time.Duration
}

type apiInfo struct {
	Path       string `json:"path"`
	MinVersion int    `json:"minVersion"`
	MaxVersion int    `json:"maxVersion"`
}

type DSMAPIError struct {
	Code  int
	Cause error
}

func (e *DSMAPIError) Error() string {
	return fmt.Sprintf("%s: DSM API error %d", e.Cause, e.Code)
}

func (e *DSMAPIError) Unwrap() error { return e.Cause }

type ConnectionDiagnostic struct {
	Code   string
	Detail string
}

func DiagnoseConnectionError(err error) ConnectionDiagnostic {
	if err == nil {
		return ConnectionDiagnostic{}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return ConnectionDiagnostic{
			Code:   "synology_timeout",
			Detail: "连接 Synology DSM 超时。",
		}
	}

	var unknownAuthority x509.UnknownAuthorityError
	if errors.As(err, &unknownAuthority) {
		return ConnectionDiagnostic{
			Code:   "synology_tls_unknown_authority",
			Detail: "DSM HTTPS 证书不受 xDrive Server 信任；局域网 DSM 使用自签名证书时最常见。建议改用证书覆盖的域名/DDNS，或将签发该证书的 CA 加入 xDrive Server 信任库；xDrive 不会自动跳过 TLS 校验。",
		}
	}
	var hostnameError x509.HostnameError
	if errors.As(err, &hostnameError) {
		return ConnectionDiagnostic{
			Code:   "synology_tls_hostname_mismatch",
			Detail: "DSM HTTPS 证书与当前访问地址不匹配；使用 IP 地址时，证书可能只签发给 DSM 域名。请改用证书 SAN 中的域名，或使用包含该 IP 地址的证书。",
		}
	}
	var invalidCertificate x509.CertificateInvalidError
	if errors.As(err, &invalidCertificate) {
		return ConnectionDiagnostic{
			Code:   "synology_tls_certificate_invalid",
			Detail: "DSM HTTPS 证书无效、已过期或尚未生效。",
		}
	}

	var dnsError *net.DNSError
	if errors.As(err, &dnsError) {
		return ConnectionDiagnostic{
			Code:   "synology_dns_failed",
			Detail: "无法解析 Synology DSM 地址：" + dnsError.Error(),
		}
	}
	if errors.Is(err, syscall.ECONNREFUSED) {
		return ConnectionDiagnostic{
			Code:   "synology_connection_refused",
			Detail: "DSM 主机可达，但目标端口拒绝连接；请确认 DSM HTTPS 端口已监听且防火墙允许访问。",
		}
	}
	if errors.Is(err, syscall.ENETUNREACH) || errors.Is(err, syscall.EHOSTUNREACH) {
		return ConnectionDiagnostic{
			Code:   "synology_network_unreachable",
			Detail: "xDrive Server 到 Synology DSM 没有可用网络路由；请检查容器/宿主机网络与 NAS 防火墙。",
		}
	}
	var networkError net.Error
	if errors.As(err, &networkError) && networkError.Timeout() {
		return ConnectionDiagnostic{
			Code:   "synology_timeout",
			Detail: "连接 Synology DSM 超时。",
		}
	}

	var dsmError *DSMAPIError
	if errors.As(err, &dsmError) {
		if errors.Is(dsmError, ErrAuthentication) {
			return ConnectionDiagnostic{
				Code:   "synology_auth_failed",
				Detail: fmt.Sprintf("DSM 登录/API 鉴权失败（错误码 %d）。", dsmError.Code),
			}
		}
		return ConnectionDiagnostic{
			Code:   "synology_api_error",
			Detail: fmt.Sprintf("DSM API 返回错误码 %d。", dsmError.Code),
		}
	}
	if errors.Is(err, ErrPhotosMissing) {
		return ConnectionDiagnostic{
			Code:   "synology_photos_unavailable",
			Detail: "DSM 已连接，但没有发现可用的 Synology Photos API。",
		}
	}
	if errors.Is(err, ErrAuthentication) {
		return ConnectionDiagnostic{
			Code:   "synology_auth_failed",
			Detail: "DSM 登录失败；请检查用户名、密码以及账号登录限制。",
		}
	}
	if errors.Is(err, ErrUnavailable) {
		detail := strings.TrimSpace(err.Error())
		detail = strings.TrimPrefix(detail, ErrUnavailable.Error()+": ")
		return ConnectionDiagnostic{
			Code:   "synology_unavailable",
			Detail: detail,
		}
	}
	return ConnectionDiagnostic{
		Code:   "source_connection_failed",
		Detail: strings.TrimSpace(err.Error()),
	}
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
		baseURL: baseURL, username: username, password: password,
		http:                  &http.Client{Timeout: defaultAPITimeout},
		apiMaxAttempts:        defaultAPIMaxAttempts,
		apiRetryBaseDelay:     defaultAPIRetryBaseDelay,
		apiRetryMaxDelay:      defaultAPIRetryMaxDelay,
		downloadHeaderTimeout: defaultDownloadResponseHeaderTimeout,
		downloadIdleTimeout:   defaultDownloadIdleTimeout,
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
	var bodyBytes []byte
	if body != nil {
		data, err := io.ReadAll(io.LimitReader(body, maxRequestBodyBytes+1))
		if err != nil {
			return err
		}
		if len(data) > maxRequestBodyBytes {
			return fmt.Errorf("Synology request body exceeds %d bytes", maxRequestBodyBytes)
		}
		bodyBytes = data
	}

	attempts := c.apiAttempts()
	for attempt := 0; attempt < attempts; attempt++ {
		var requestBody io.Reader
		if bodyBytes != nil {
			requestBody = bytes.NewReader(bodyBytes)
		}
		req, err := http.NewRequestWithContext(ctx, method, endpoint, requestBody)
		if err != nil {
			return err
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("User-Agent", "xdrive-synology-pull/1")
		if requestBody != nil {
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		}

		resp, err := c.http.Do(req)
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
			return fmt.Errorf("%w: %w", ErrUnavailable, err)
		}

		data, readErr := io.ReadAll(io.LimitReader(resp.Body, maxJSONBytes+1))
		retryAfter := resp.Header.Get("Retry-After")
		_ = resp.Body.Close()

		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			return fmt.Errorf("%w: HTTP %s", ErrAuthentication, resp.Status)
		}
		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			if attempt+1 < attempts {
				if delay, allowed := c.apiRetryDelay(attempt, retryAfter); allowed {
					if err := sleepContext(ctx, delay); err != nil {
						return err
					}
					continue
				}
			}
			return fmt.Errorf("%w: HTTP %s", ErrUnavailable, resp.Status)
		}
		if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
			return fmt.Errorf("%w: HTTP %s", ErrUnavailable, resp.Status)
		}
		if readErr != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return ctxErr
			}
			if attempt+1 < attempts {
				if err := c.waitAPIRetry(ctx, attempt, ""); err != nil {
					return err
				}
				continue
			}
			return fmt.Errorf("%w: read response: %v", ErrUnavailable, readErr)
		}
		if len(data) > maxJSONBytes {
			return fmt.Errorf("%w: response exceeds %d bytes", ErrUnavailable, maxJSONBytes)
		}
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("%w: decode response: %v", ErrUnavailable, err)
		}
		if envelope, ok := out.(*apiEnvelope); ok && !envelope.Success {
			code := 0
			if envelope.Error != nil {
				code = envelope.Error.Code
			}
			if transientAPIErrorCode(code) && attempt+1 < attempts {
				if err := c.waitAPIRetry(ctx, attempt, ""); err != nil {
					return err
				}
				continue
			}
			return apiError(*envelope)
		}
		return nil
	}
	return fmt.Errorf("%w: retries exhausted", ErrUnavailable)
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
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func transientAPIErrorCode(code int) bool {
	switch code {
	case 109, 110, 111, 117, 118:
		return true
	default:
		return false
	}
}

func apiError(envelope apiEnvelope) error {
	code := 0
	if envelope.Error != nil {
		code = envelope.Error.Code
	}
	switch code {
	case 106, 107, 119:
		return &DSMAPIError{Code: code, Cause: ErrSessionExpired}
	case 400, 401, 402, 403, 404:
		return &DSMAPIError{Code: code, Cause: ErrAuthentication}
	default:
		return &DSMAPIError{Code: code, Cause: ErrUnavailable}
	}
}
