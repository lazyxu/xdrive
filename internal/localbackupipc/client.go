package localbackupipc

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const (
	discoveryName     = "desktop-ipc.json"
	maxDiscoveryBytes = 4096
	maxReplyBytes     = 1 << 20
	protocolVersion   = 2
)

type discovery struct {
	Version int    `json:"version"`
	BaseURL string `json:"base_url"`
	Token   string `json:"token"`
	PID     int    `json:"pid"`
}

type hello struct {
	DiscoveryVersion int      `json:"discovery_version"`
	ProtocolMin      int      `json:"protocol_min"`
	ProtocolMax      int      `json:"protocol_max"`
	PID              int      `json:"pid"`
	Platform         string   `json:"platform"`
	RuntimeMode      string   `json:"runtime_mode"`
	Capabilities     []string `json:"capabilities"`
}

// Client is a same-user, authenticated, loopback-only observer/controller for
// the existing owning Agent. No credential/Root/Operation/path enters its API.
type Client struct {
	baseURL      string
	token        string
	pid          int
	runtimeMode  string
	capabilities []string
	http         *http.Client
}

func readDiscovery(dir string) (discovery, error) {
	var zero discovery
	path := filepath.Join(dir, discoveryName)
	before, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return zero, ErrAgentUnavailable
	}
	if err != nil {
		return zero, err
	}
	if !before.Mode().IsRegular() || before.Size() < 2 || before.Size() > maxDiscoveryBytes ||
		(runtime.GOOS != "windows" && before.Mode().Perm()&0077 != 0) {
		return zero, errors.New("unsafe local Agent discovery file")
	}
	f, err := os.Open(path)
	if err != nil {
		return zero, err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(before, opened) {
		return zero, errors.New("local Agent discovery changed")
	}
	data, err := io.ReadAll(io.LimitReader(f, maxDiscoveryBytes+1))
	if err != nil || len(data) > maxDiscoveryBytes {
		return zero, errors.New("invalid local Agent discovery length")
	}
	var d discovery
	if err := json.Unmarshal(data, &d); err != nil {
		return zero, errors.New("malformed local Agent discovery")
	}
	u, err := url.Parse(d.BaseURL)
	if err != nil || u == nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" ||
		u.Port() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" ||
		u.Fragment != "" || u.Opaque != "" || d.Version != 1 || d.PID <= 0 ||
		len(d.Token) != 64 {
		return zero, errors.New("invalid local Agent endpoint or identity")
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil || port < 1 || port > 65535 {
		return zero, errors.New("invalid local Agent port")
	}
	decoded, err := hex.DecodeString(d.Token)
	if err != nil || len(decoded) != 32 || hex.EncodeToString(decoded) != d.Token {
		return zero, errors.New("invalid local Agent bearer token")
	}
	return d, nil
}

// Connect checks both the protected discovery file and the live Agent hello;
// a stale token, wrong PID/protocol or missing Backup-only capability fails
// closed. No server-side Source API or browser IPC is used as a fallback.
func Connect(ctx context.Context, configDir string) (*Client, error) {
	if ctx == nil || ctx.Err() != nil {
		return nil, errors.New("Agent context is unavailable")
	}
	if runtime.GOOS != "linux" && runtime.GOOS != "windows" {
		return nil, errors.New("native Backup-only requires Linux or Windows")
	}
	d, err := readDiscovery(configDir)
	if err != nil {
		return nil, err
	}
	tr := &http.Transport{Proxy: nil, MaxIdleConns: 2, ResponseHeaderTimeout: 30 * time.Second}
	c := &Client{baseURL: d.BaseURL, token: d.Token, pid: d.PID,
		http: &http.Client{Transport: tr, CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}}}
	readyCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	var h hello
	if err := c.request(readyCtx, http.MethodGet, "/v1/hello", nil, &h); err != nil {
		var netErr *url.Error
		if errors.As(err, &netErr) {
			return nil, fmt.Errorf("%w: %v", ErrAgentUnavailable, netErr.Err)
		}
		return nil, err
	}
	if h.DiscoveryVersion != d.Version || h.PID != d.PID ||
		h.ProtocolMin > protocolVersion || h.ProtocolMax < protocolVersion ||
		h.Platform != runtime.GOOS ||
		!hasCapability(h.Capabilities, "device-backup-local-common-batch") ||
		!hasCapability(h.Capabilities, "device-backup-local-schedule") {
		return nil, errors.New("Agent identity, protocol or Backup-only capability mismatch")
	}
	c.runtimeMode = h.RuntimeMode
	c.capabilities = append([]string(nil), h.Capabilities...)
	return c, nil
}

func hasCapability(capabilities []string, want string) bool {
	for _, item := range capabilities {
		if item == want {
			return true
		}
	}
	return false
}

func (c *Client) request(ctx context.Context, method, path string, body any, target any) error {
	return c.requestWithLimit(ctx, method, path, body, target, maxReplyBytes)
}

// A larger, explicitly bounded reply is reserved for the existing Server
// text-preview endpoint; ordinary Agent IPC replies retain the 1 MiB limit.
func (c *Client) requestWithLimit(
	ctx context.Context, method, path string, body any, target any, maxBytes int64,
) error {
	if maxBytes < 1 || maxBytes > 8<<20 {
		return errors.New("invalid Agent reply limit")
	}
	if c == nil || ctx == nil || ctx.Err() != nil || c.http == nil {
		return errors.New("local Agent request unavailable")
	}
	var payload io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		payload = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, payload)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted &&
		resp.StatusCode != http.StatusCreated {
		// Never relay remote error bodies; they can contain private data.
		return fmt.Errorf("owning Agent rejected %s (HTTP %d)", method, resp.StatusCode)
	}
	if target == nil {
		return nil
	}
	decoder := json.NewDecoder(io.LimitReader(resp.Body, maxBytes+1))
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("invalid Agent reply: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return errors.New("oversized or trailing Agent reply")
	}
	return nil
}

func sourcePath(path string, sourceID uint64) (string, error) {
	if !ValidSourceID(sourceID) {
		return "", errors.New("invalid owning Backup-only Source ID")
	}
	return path + "?source_id=" + strconv.FormatUint(sourceID, 10), nil
}

func (c *Client) Start(ctx context.Context, id uint64) (Summary, error) {
	var result Summary
	path, err := sourcePath("/v1/device-backups/local-common-batch", id)
	if err == nil {
		err = c.request(ctx, http.MethodPost, path, nil, &result)
	}
	if err != nil {
		return Summary{}, err
	}
	if !ValidateSummary(result, id) {
		return Summary{}, errors.New("invalid backup start acknowledgement")
	}
	return result, nil
}

func (c *Client) Status(ctx context.Context, id uint64) (Summary, error) {
	var result Summary
	path, err := sourcePath("/v1/device-backups/local-common-batch", id)
	if err == nil {
		err = c.request(ctx, http.MethodGet, path, nil, &result)
	}
	if err != nil {
		return Summary{}, err
	}
	if !ValidateSummary(result, id) {
		return Summary{}, errors.New("invalid backup status")
	}
	return result, nil
}

func (c *Client) Control(ctx context.Context, id uint64, action string) (Summary, error) {
	if action != "pause" && action != "cancel" {
		return Summary{}, errors.New("only pause or cancel at next-file boundary are supported")
	}
	path, err := sourcePath("/v1/device-backups/local-common-batch/control", id)
	if err != nil {
		return Summary{}, err
	}
	var result Summary
	err = c.request(ctx, http.MethodPost, path+"&action="+url.QueryEscape(action), nil, &result)
	if err != nil {
		return Summary{}, err
	}
	if !ValidateSummary(result, id) || !result.Running || result.StopRequested != action {
		return Summary{}, errors.New("invalid backup control result")
	}
	return result, nil
}

func (c *Client) History(ctx context.Context, id uint64) (HistoryPage, error) {
	path, err := sourcePath("/v1/device-backups/local-common-batch/history", id)
	if err != nil {
		return HistoryPage{}, err
	}
	var result HistoryPage
	if err := c.request(ctx, http.MethodGet, path, nil, &result); err != nil {
		return HistoryPage{}, err
	}
	if !ValidateHistory(result, id) {
		return HistoryPage{}, errors.New("invalid private backup history")
	}
	return result, nil
}

func (c *Client) ReadSchedule(ctx context.Context, id uint64) (Schedule, error) {
	path, err := sourcePath("/v1/device-backups/local-schedule", id)
	if err != nil {
		return Schedule{}, err
	}
	var result Schedule
	if err := c.request(ctx, http.MethodGet, path, nil, &result); err != nil {
		return Schedule{}, err
	}
	if !ValidateSchedule(result, id) {
		return Schedule{}, errors.New("invalid owning Agent schedule")
	}
	return result, nil
}

func (c *Client) SaveSchedule(ctx context.Context, id uint64, oldRevision uint64, spec Schedule) (Schedule, error) {
	if !ValidSourceID(id) || oldRevision == 0 ||
		spec.ScheduleType == "" || spec.SourceID != id {
		return Schedule{}, errors.New("invalid owning Backup-only schedule request")
	}
	spec.Revision = oldRevision
	var result Schedule
	if err := c.request(ctx, http.MethodPatch, "/v1/device-backups/local-schedule", spec, &result); err != nil {
		return Schedule{}, err
	}
	if !ValidateSchedule(result, id) || result.Revision <= oldRevision ||
		result.ScheduleType != spec.ScheduleType ||
		result.ScheduleExpression != spec.ScheduleExpression ||
		result.ScheduleTimezone != spec.ScheduleTimezone {
		return Schedule{}, errors.New("unverified saved Backup-only schedule")
	}
	return result, nil
}

// BackupSource is a public Owner-readable index only, never a grant to use
// a foreign device's local folder. Call ReadSchedule to prove local ownership
// before showing a candidate in xd backup list.
type BackupSource struct {
	ID        uint64 `json:"id"`
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	Direction string `json:"direction"`
	SyncMode  string `json:"sync_mode"`
}

func (c *Client) Sources(ctx context.Context) ([]BackupSource, error) {
	var out []BackupSource
	if err := c.request(ctx, http.MethodGet, "/v1/sources", nil, &out); err != nil {
		return nil, err
	}
	if len(out) > 10000 {
		return nil, errors.New("excessive Backup-only Source index")
	}
	return out, nil
}

// RequireFullMode is a separate CLI mount precondition. Ordinary xd backup
// continues to attach to either full or Backup-only Agent without new scope.
func (c *Client) RequireFullMode() error {
	if c == nil {
		return errors.New("owning xdrive-agent is unavailable")
	}
	switch c.runtimeMode {
	case "backup_only":
		return errors.New("xdrive-agent is running Backup-only; do not interrupt an active backup. Stop the owning user service safely before launching full Agent mode")
	case "full":
		if !hasCapability(c.capabilities, "settings") ||
			!hasCapability(c.capabilities, "sync-control") {
			return errors.New("full Agent is missing mount/settings capabilities; update the matching xd and xdrive-agent binaries")
		}
		return nil
	default:
		return errors.New("Agent runtime mode is unknown; update the matching xd and xdrive-agent binaries before mounting (existing backup work was not interrupted)")
	}
}

// MountSettings is an Agent-provided configuration acknowledgement, not a
// claim that FUSE or CfAPI mounting has already finished.
type MountSettings struct {
	MountPath string `json:"mount_path"`
}

func validMountPath(path string) bool {
	return strings.TrimSpace(path) != "" && filepath.IsAbs(path) &&
		filepath.Clean(path) == path
}

func (c *Client) MountSettings(ctx context.Context) (MountSettings, error) {
	if err := c.RequireFullMode(); err != nil {
		return MountSettings{}, err
	}
	var result MountSettings
	if err := c.request(ctx, http.MethodGet, "/v1/settings", nil, &result); err != nil {
		return MountSettings{}, err
	}
	if !validMountPath(result.MountPath) {
		return MountSettings{}, errors.New("Agent returned invalid mount settings")
	}
	return result, nil
}

func (c *Client) UpdateMountPath(ctx context.Context, path string) (MountSettings, error) {
	if err := c.RequireFullMode(); err != nil {
		return MountSettings{}, err
	}
	if !validMountPath(path) {
		return MountSettings{}, errors.New("mount path must be an absolute normalized local directory")
	}
	var result MountSettings
	if err := c.request(ctx, http.MethodPatch, "/v1/settings",
		struct {
			MountPath string `json:"mount_path"`
		}{MountPath: path}, &result); err != nil {
		return MountSettings{}, err
	}
	if !validMountPath(result.MountPath) {
		return MountSettings{}, errors.New("Agent returned invalid updated mount settings")
	}
	confirmed := result.MountPath == path ||
		(runtime.GOOS == "windows" && strings.EqualFold(result.MountPath, path))
	if !confirmed {
		return MountSettings{}, errors.New("Agent mount-path acknowledgement did not match requested directory; inspect Agent settings before retrying")
	}
	return result, nil
}
