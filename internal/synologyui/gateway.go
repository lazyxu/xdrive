package synologyui

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

// Gateway is an on-demand DSM CGI handler. It never exposes a TCP listener or
// the protected Agent bearer to the browser. Every request rechecks DSM auth.
const (
	authorityName = "synology-ui-authority.json"
	maxSources    = 512
)

type authority struct {
	DSMUser string `json:"dsm_user"`
	CSRFKey string `json:"csrf_key"`
}

// Remote owner-scoped read capability is optional and has no local Source/Root
// authority. Existing old Agents continue to work for native-only Backup.
// Optional, fixed read-only Server Owner capacity projection.
// Optional Server Owner-scoped file list capability; no preview, write
// or arbitrary proxy surface is inherited from Desktop's full Agent.
type OwnerFileReader interface {
	OwnerFileRoot(context.Context) (localbackupipc.OwnerFileNode, error)
	OwnerFilePage(context.Context, uint64, int, string, string, string) (localbackupipc.OwnerFilesPage, error)
}

// Optional independent capability; old Agents still browse Owner directories.
// No binary stream, signed URL or Server credential reaches the DSM browser.
type OwnerTextPreviewReader interface {
	OwnerFileTextPreview(context.Context, uint64) (localbackupipc.OwnerTextPreview, error)
}

// Owner media reads are separately capability-gated by the existing Agent.
type OwnerMediaRangeReader interface {
	OwnerFileMediaRange(context.Context, uint64, uint64, int64, int) (localbackupipc.OwnerMediaRange, error)
}

// Separate thumbnail-only capability, never an arbitrary image proxy.
// Optional read-only Live Photo motion projection; DSM still uses the
// canonical Web/Desktop LivePhotoSurface and never receives an Agent token.
type OwnerLiveMotionReader interface {
	OwnerLiveMotion(context.Context, uint64, uint64) (localbackupipc.OwnerLiveMotion, error)
}

type OwnerThumbnailReader interface {
	OwnerFileThumbnail(context.Context, uint64, uint64) (localbackupipc.OwnerThumbnail, error)
}

type OwnerQuotaReader interface {
	OwnerQuota(context.Context) (localbackupipc.OwnerQuota, error)
}

type OwnerDeviceBackupReader interface {
	DeviceBackupOverview(context.Context) (localbackupipc.DeviceBackupOverview, error)
	DeviceBackupRuns(context.Context, uint64, int, int) (localbackupipc.DeviceBackupRunPage, error)
}

// Only newer Agents implement the Owner keyset extension. Old versions remain
// usable for the first overview and current-device Backup-only Runner.
type OwnerDeviceBackupPager interface {
	DeviceBackupOverviewPage(context.Context, int, string) (localbackupipc.DeviceBackupOverview, error)
	DeviceBackupFoldersPage(context.Context, string, int, uint64) (localbackupipc.DeviceBackupFolderPage, error)
}

type Agent interface {
	Sources(context.Context) ([]localbackupipc.BackupSource, error)
	ReadSchedule(context.Context, uint64) (localbackupipc.Schedule, error)
	SaveSchedule(context.Context, uint64, uint64, localbackupipc.Schedule) (localbackupipc.Schedule, error)
	Start(context.Context, uint64) (localbackupipc.Summary, error)
	Status(context.Context, uint64) (localbackupipc.Summary, error)
	History(context.Context, uint64) (localbackupipc.HistoryPage, error)
	Control(context.Context, uint64, string) (localbackupipc.Summary, error)
}

type Gateway struct {
	ConfigDir    string
	Authenticate func(context.Context) (string, error)
	Connect      func(context.Context) (Agent, error)
	Now          func() time.Time
	HTTPS        bool
	// Test-only substitute for "/", inaccessible to the production caller.
	nasShareRoot string
}

// The owner must run this from the SAME restricted DSM package account as the
// Agent. No web request can create or change this owner-approved allowlist.
func Authorize(configDir, dsmUser string) error {
	if !validUser(dsmUser) {
		return errors.New("invalid DSM username")
	}
	if err := privateDir(configDir); err != nil {
		return err
	}
	path := filepath.Join(configDir, authorityName)
	if _, err := privateFile(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return err
	}
	payload, err := json.Marshal(authority{DSMUser: dsmUser, CSRFKey: base64.RawURLEncoding.EncodeToString(key)})
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(configDir, ".synology-ui-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if err := file.Chmod(0600); err != nil {
		file.Close()
		return err
	}
	if _, err := file.Write(payload); err != nil {
		file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}

func validUser(value string) bool {
	if len(value) < 1 || len(value) > 64 || value == "." || value == ".." {
		return false
	}
	for _, r := range value {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-' || r == '.') {
			return false
		}
	}
	return true
}

func privateDir(dir string) error {
	st, err := os.Lstat(dir)
	if err != nil {
		return err
	}
	if !st.IsDir() || st.Mode()&os.ModeSymlink != 0 || (runtime.GOOS != "windows" && st.Mode().Perm()&0077 != 0) {
		return errors.New("unsafe private xDrive config directory")
	}
	return nil
}

func privateFile(path string) (os.FileInfo, error) {
	st, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !st.Mode().IsRegular() || st.Size() < 10 || st.Size() > 512 || (runtime.GOOS != "windows" && st.Mode().Perm()&0077 != 0) {
		return nil, errors.New("unsafe private DSM UI authority")
	}
	return st, nil
}

func loadAuthority(configDir string) (authority, []byte, error) {
	if err := privateDir(configDir); err != nil {
		return authority{}, nil, err
	}
	path := filepath.Join(configDir, authorityName)
	before, err := privateFile(path)
	if err != nil {
		return authority{}, nil, err
	}
	f, err := os.Open(path)
	if err != nil {
		return authority{}, nil, err
	}
	defer f.Close()
	after, err := f.Stat()
	if err != nil || !os.SameFile(before, after) {
		return authority{}, nil, errors.New("authority file changed")
	}
	data, err := io.ReadAll(io.LimitReader(f, 513))
	if err != nil || len(data) > 512 {
		return authority{}, nil, errors.New("invalid authority size")
	}
	var a authority
	if err := json.Unmarshal(data, &a); err != nil {
		return authority{}, nil, errors.New("invalid authority encoding")
	}
	key, err := base64.RawURLEncoding.DecodeString(a.CSRFKey)
	if err != nil || len(key) != 32 || !validUser(a.DSMUser) {
		return authority{}, nil, errors.New("invalid DSM authority")
	}
	return a, key, nil
}

// AuthenticateDSM executes the documented DSM 7 per-CGI-request session
// validator, inheriting the web server's actual HTTP_COOKIE and REMOTE_ADDR.
// A supplied username, HTTP header or query string is never authentication.
func AuthenticateDSM(ctx context.Context) (string, error) {
	if runtime.GOOS != "linux" || os.Getenv("GATEWAY_INTERFACE") == "" || os.Getenv("HTTP_COOKIE") == "" || os.Getenv("REMOTE_ADDR") == "" {
		return "", errors.New("DSM CGI request required")
	}
	check, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(check, "/usr/syno/synoman/webman/modules/authenticate.cgi")
	output, err := cmd.Output()
	if err != nil || len(output) > 128 {
		return "", errors.New("DSM session rejected")
	}
	username := strings.TrimSpace(string(output))
	if !validUser(username) || strings.ContainsAny(string(output), "\x00\r") {
		return "", errors.New("DSM session rejected")
	}
	return username, nil
}

func (g *Gateway) now() time.Time {
	if g.Now != nil {
		return g.Now()
	}
	return time.Now()
}

// CSRF tokens are bound to the DSM session Cookie, allowed principal, and
// exact same-origin Host. CGI processes share the owner-protected key file.
func csrf(key []byte, username, cookie, host string, interval int64) string {
	mac := hmac.New(sha256.New, key)
	fmt.Fprintf(mac, "xdrive-dsm-ui-v1\x00%s\x00%s\x00%s\x00%d", username, cookie, host, interval)
	return hex.EncodeToString(mac.Sum(nil))
}

func validOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	u, err := url.Parse(origin)
	return err == nil && u.Scheme == "https" && u.Host != "" && strings.EqualFold(u.Host, r.Host) &&
		u.User == nil && u.Path == "" && u.RawQuery == "" && u.Fragment == "" && u.Opaque == ""
}

func sourceID(r *http.Request, expectedArgs int) (uint64, bool) {
	vals := r.URL.Query()
	if len(vals) != expectedArgs || len(vals["source_id"]) != 1 ||
		(expectedArgs == 2 && len(vals["action"]) != 1) {
		return 0, false
	}
	id, err := strconv.ParseUint(vals.Get("source_id"), 10, 64)
	return id, err == nil && localbackupipc.ValidSourceID(id)
}

// scheduleMutation contains only the schedule specification and optimistic
// revision. The Source ID comes exclusively from the owner-scoped CGI route.
type scheduleMutation struct {
	Revision           uint64
	ScheduleType       string
	ScheduleExpression string
	ScheduleTimezone   string
}

// Parse a bounded, exact-field JSON object. Reject duplicate fields, unknown
// keys, trailing values and unsupported kinds before contacting the Agent.
// Scheduling semantics and the optimistic revision remain Agent/Server-owned.
func parseScheduleMutation(r *http.Request) (scheduleMutation, error) {
	var value scheduleMutation
	if r == nil || r.Body == nil || r.ContentLength < 2 || r.ContentLength > 1024 {
		return value, errors.New("invalid schedule request size")
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, 1025))
	if err != nil || len(data) > 1024 || int64(len(data)) != r.ContentLength {
		return value, errors.New("invalid schedule request body")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	first, err := decoder.Token()
	if err != nil || first != json.Delim('{') {
		return value, errors.New("schedule request must be an object")
	}
	seen := make(map[string]bool, 4)
	for decoder.More() {
		tok, err := decoder.Token()
		name, ok := tok.(string)
		if err != nil || !ok || seen[name] {
			return value, errors.New("duplicate or invalid schedule field")
		}
		seen[name] = true
		switch name {
		case "revision":
			err = decoder.Decode(&value.Revision)
		case "schedule_type":
			err = decoder.Decode(&value.ScheduleType)
		case "schedule_expression":
			err = decoder.Decode(&value.ScheduleExpression)
		case "schedule_timezone":
			err = decoder.Decode(&value.ScheduleTimezone)
		default:
			return value, errors.New("unexpected schedule field")
		}
		if err != nil {
			return value, errors.New("invalid schedule field value")
		}
	}
	last, err := decoder.Token()
	if err != nil || last != json.Delim('}') || len(seen) != 4 {
		return value, errors.New("incomplete schedule request")
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return value, errors.New("trailing schedule request data")
	}
	if value.Revision == 0 || len(value.ScheduleExpression) > 256 || len(value.ScheduleTimezone) > 128 ||
		strings.ContainsAny(value.ScheduleExpression, "\x00\r\n") ||
		strings.ContainsAny(value.ScheduleTimezone, "\x00\r\n") {
		return value, errors.New("unsafe schedule revision or values")
	}
	switch value.ScheduleType {
	case "manual":
		if value.ScheduleExpression != "" || value.ScheduleTimezone != "" {
			return value, errors.New("manual schedule must not include parameters")
		}
	case "interval":
		interval, err := time.ParseDuration(value.ScheduleExpression)
		if err != nil || interval < time.Minute || interval > 365*24*time.Hour || value.ScheduleTimezone != "" {
			return value, errors.New("invalid interval schedule")
		}
	case "cron":
		if len(strings.Fields(value.ScheduleExpression)) != 5 || value.ScheduleTimezone == "" ||
			strings.TrimSpace(value.ScheduleTimezone) != value.ScheduleTimezone {
			return value, errors.New("invalid cron schedule")
		}
	default:
		return value, errors.New("unsupported schedule type")
	}
	return value, nil
}

func sendJSON(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(data)
}

func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store, private")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Frame-Options", "SAMEORIGIN")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'self'")
	w.Header().Set("Vary", "Cookie")
	if g == nil || g.Authenticate == nil || g.Connect == nil || !g.HTTPS || r == nil || r.TLS == nil || r.Host == "" || r.Header.Get("Cookie") == "" {
		http.Error(w, "DSM authenticated HTTPS required", http.StatusForbidden)
		return
	}
	timeout := 20 * time.Second
	if r.URL.Path == "/v1/server-login" {
		timeout = 45 * time.Second // Agent TLS login has its own 30s budget.
	} else if r.URL.Path == "/v1/nas-share-create" || r.URL.Path == "/v1/nas-draft-bind" {
		timeout = 90 * time.Second // Existing native Root binding and Server Source creation.
	} else if r.URL.Path == "/v1/recovery-review" {
		timeout = 80 * time.Second // Existing owning Agent historical read has a 60s bound.
	}
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	username, err := g.Authenticate(ctx)
	if err != nil || !validUser(username) {
		http.Error(w, "DSM session required", http.StatusUnauthorized)
		return
	}
	a, key, err := loadAuthority(g.ConfigDir)
	if err != nil || subtle.ConstantTimeCompare([]byte(username), []byte(a.DSMUser)) != 1 {
		http.Error(w, "DSM user not permitted", http.StatusForbidden)
		return
	}
	interval := g.now().Unix() / 900
	if r.Method == http.MethodPost {
		token := r.Header.Get("X-CSRF-Token")
		current := csrf(key, username, r.Header.Get("Cookie"), r.Host, interval)
		previous := csrf(key, username, r.Header.Get("Cookie"), r.Host, interval-1)
		if !validOrigin(r) || len(token) != len(current) ||
			(subtle.ConstantTimeCompare([]byte(token), []byte(current)) != 1 && subtle.ConstantTimeCompare([]byte(token), []byte(previous)) != 1) ||
			(r.URL.Path != "/v1/schedule" && r.URL.Path != "/v1/nas-share-preflight" && r.URL.Path != "/v1/server-login" && r.URL.Path != "/v1/nas-share-create" && r.URL.Path != "/v1/nas-draft-bind" && r.ContentLength != 0) ||
			((r.URL.Path == "/v1/schedule" || r.URL.Path == "/v1/nas-share-preflight") && (r.ContentLength < 2 || r.ContentLength > 1024)) ||
			(r.URL.Path == "/v1/server-login" && (r.ContentLength < 2 || r.ContentLength > 8192)) ||
			((r.URL.Path == "/v1/nas-share-create" || r.URL.Path == "/v1/nas-draft-bind") && (r.ContentLength < 2 || r.ContentLength > 1024)) {
			http.Error(w, "CSRF validation failed", http.StatusForbidden)
			return
		}
	}
	if r.Method == http.MethodGet && r.URL.Path == "/v1/bootstrap" && r.URL.RawQuery == "" {
		sendJSON(w, map[string]any{"dsm_user": username, "csrf_token": csrf(key, username, r.Header.Get("Cookie"), r.Host, interval)})
		return
	}
	if r.URL.Path != "/v1/sources" && r.URL.Path != "/v1/status" && r.URL.Path != "/v1/history" && r.URL.Path != "/v1/run" && r.URL.Path != "/v1/control" && r.URL.Path != "/v1/schedule" && r.URL.Path != "/v1/device-backups" && r.URL.Path != "/v1/device-backup-runs" && r.URL.Path != "/v1/device-backup-page" && r.URL.Path != "/v1/device-backup-folders" && r.URL.Path != "/v1/cloud-quota" && r.URL.Path != "/v1/nas-volume" && r.URL.Path != "/v1/cloud-root" && r.URL.Path != "/v1/cloud-children" && r.URL.Path != "/v1/cloud-text-preview" && r.URL.Path != "/v1/cloud-media-range" && r.URL.Path != "/v1/cloud-media-stream" && r.URL.Path != "/v1/cloud-thumbnail" && r.URL.Path != "/v1/cloud-gallery-items" && r.URL.Path != "/v1/cloud-gallery-albums" && r.URL.Path != "/v1/cloud-live-motion" && r.URL.Path != "/v1/nas-shares" && r.URL.Path != "/v1/nas-share-preflight" && r.URL.Path != "/v1/server-connection" && r.URL.Path != "/v1/server-login" && r.URL.Path != "/v1/nas-share-create" && r.URL.Path != "/v1/nas-draft-bind" && r.URL.Path != "/v1/nas-drafts" && r.URL.Path != "/v1/recovery-review" {
		http.NotFound(w, r)
		return
	}
	if r.URL.Path == "/v1/run" || r.URL.Path == "/v1/control" || r.URL.Path == "/v1/nas-share-preflight" || r.URL.Path == "/v1/server-login" || r.URL.Path == "/v1/nas-share-create" || r.URL.Path == "/v1/nas-draft-bind" {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
	} else if r.URL.Path == "/v1/schedule" {
		if r.Method != http.MethodGet && r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
	} else if r.URL.Path == "/v1/cloud-media-stream" {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "media stream allows only GET/HEAD", http.StatusMethodNotAllowed)
			return
		}
	} else if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	agent, err := g.Connect(ctx) // Same-user protected discovery; never spawn a new Agent.
	if err != nil {
		http.Error(w, "owning Agent unavailable", http.StatusServiceUnavailable)
		return
	}
	if r.URL.Path == "/v1/recovery-review" {
		serveDSMRecoveryReview(w, r, ctx, agent)
		return
	}
	if r.URL.Path == "/v1/nas-drafts" {
		serveDSMNativeDrafts(w, r, ctx, agent, key, username)
		return
	}
	if r.URL.Path == "/v1/nas-draft-bind" {
		serveDSMNativeDraftBind(w, r, ctx, agent, key, username, g.nasShareRoot)
		return
	}

	// DSM permits an explicit, initial or same-Owner re-login through the
	// original backup-only Agent. Neither the CGI nor the browser stores the
	// password; no arbitrary Agent proxy, local Root grant or Source change.
	if r.URL.Path == "/v1/server-connection" || r.URL.Path == "/v1/server-login" {
		if r.URL.RawQuery != "" {
			http.Error(w, "DSM Server login accepts no query", http.StatusBadRequest)
			return
		}
		login, ok := agent.(ServerLoginAgent)
		if !ok {
			http.Error(w, "owning Agent login unavailable", http.StatusNotImplemented)
			return
		}
		if r.URL.Path == "/v1/server-connection" {
			status, err := login.ServerConnection(ctx)
			if err != nil {
				http.Error(w, "DSM Server connection unavailable", http.StatusServiceUnavailable)
				return
			}
			scope := ""
			if status.Configured {
				scope = dsmOwnerScope(key, username, r.Header.Get("Cookie"), r.Host, status.Server, status.Username)
				if scope == "" {
					http.Error(w, "unverified DSM Owner scope", http.StatusServiceUnavailable)
					return
				}
			}
			projection := map[string]any{
				"configured":           status.Configured,
				"must_change_password": status.MustChangePassword,
				"owner_scope":          scope,
			}
			if status.Configured {
				projection["server"] = status.Server
				projection["username"] = status.Username
			}
			sendJSON(w, projection)
			return
		}
		input, err := parseServerLogin(r)
		if err != nil {
			http.Error(w, "invalid DSM Server login request", http.StatusBadRequest)
			return
		}
		// Do not acknowledge a login unless the real Owner quota is readable
		// under the Agent's newly selected Server session.
		quotaReader, ok := agent.(OwnerQuotaReader)
		if !ok {
			http.Error(w, "owning Agent Owner proof unavailable", http.StatusNotImplemented)
			return
		}
		if err := login.LoginServer(ctx, input.Server, input.Username, input.Password); err != nil {
			http.Error(w, "owning Agent rejected DSM Server login", http.StatusConflict)
			return
		}
		quota, err := quotaReader.OwnerQuota(ctx)
		if err != nil || !localbackupipc.ValidateOwnerQuota(quota) {
			http.Error(w, "Server Owner verification unavailable after login", http.StatusServiceUnavailable)
			return
		}
		sendJSON(w, map[string]bool{"verified": true})
		return
	}
	// Fixed read-only capacity of the filesystem backing the private DSM
	// package configuration. No browser path/volume selector, storage mutation,
	// general NAS inventory or Server account quota is exposed.
	if r.URL.Path == "/v1/nas-volume" {
		if r.URL.RawQuery != "" {
			http.Error(w, "invalid DSM package volume query", http.StatusBadRequest)
			return
		}
		space, err := readNASVolumeSpace(g.ConfigDir)
		if err != nil {
			http.Error(w, "DSM package filesystem capacity unavailable", http.StatusServiceUnavailable)
			return
		}
		sendJSON(w, space)
		return
	}
	// Explicit local DSM consent, not general Server/Agent administration.
	// Selection ID is bound to DSM principal, cookie and hostname; the
	// directory path is derived only on the trusted NAS from fresh inventory.
	if r.URL.Path == "/v1/nas-share-create" {
		input, err := parseNASShareCreate(r)
		if err != nil {
			http.Error(w, "invalid DSM local backup Source setup", http.StatusBadRequest)
			return
		}
		bootstrapper, ok := agent.(NASShareBootstrapper)
		if !ok {
			http.Error(w, "owning Agent Source setup unsupported", http.StatusNotImplemented)
			return
		}
		quotaReader, ok := agent.(OwnerQuotaReader)
		if !ok {
			http.Error(w, "Owner Server verification unsupported", http.StatusNotImplemented)
			return
		}
		root := g.nasShareRoot
		if root == "" {
			root = "/"
		}
		owner, ok := agent.(ServerLoginAgent)
		if !ok {
			http.Error(w, "current Server Owner identity unavailable", http.StatusNotImplemented)
			return
		}
		connection, err := owner.ServerConnection(ctx)
		if err != nil || !connection.Configured ||
			subtle.ConstantTimeCompare([]byte(dsmOwnerScope(
				key, username, r.Header.Get("Cookie"), r.Host,
				connection.Server, connection.Username)), []byte(input.OwnerScope)) != 1 {
			http.Error(w, "Server Owner changed; reload and reselect backup target", http.StatusConflict)
			return
		}
		path, err := resolveNASSharePreflight(ctx, root, key, username, r.Header.Get("Cookie"), r.Host, input.SelectionID)
		if err != nil {
			http.Error(w, "NAS selection expired; recheck local permissions", http.StatusConflict)
			return
		}
		// Revalidate the native path and current authenticated Server before
		// any persistent Source mutation. The Server validates target_id as a
		// directory belonging to the current Owner, not merely a GUI label.
		if err := bootstrapper.PreflightLocalRoot(ctx, path); err != nil {
			http.Error(w, "native backup Root preflight unavailable", http.StatusServiceUnavailable)
			return
		}
		if quota, err := quotaReader.OwnerQuota(ctx); err != nil || !localbackupipc.ValidateOwnerQuota(quota) {
			http.Error(w, "current Server Owner cannot be verified", http.StatusServiceUnavailable)
			return
		}
		created, err := bootstrapper.CreateLocalBackupSource(ctx, input.Name, input.TargetID)
		if err != nil {
			// An uncertain Server reply may have created a paused draft. Do
			// not retry or fabricate an ID; ask for explicit native inspection.
			http.Error(w, "Source creation outcome unknown; inspect owning Agent drafts before retry", http.StatusConflict)
			return
		}
		// Re-read native Agent identity after the Server Source mutation.
		// An Owner change here leaves an inspectable Source rather than
		// granting a local Root to an unverified account.
		latest, err := owner.ServerConnection(ctx)
		if err != nil || !latest.Configured ||
			subtle.ConstantTimeCompare([]byte(dsmOwnerScope(
				key, username, r.Header.Get("Cookie"), r.Host,
				latest.Server, latest.Username)), []byte(input.OwnerScope)) != 1 {
			sendJSON(w, map[string]any{"source_id": created.ID, "state": "needs_inspection"})
			return
		}
		grant, err := bootstrapper.AuthorizeLocalRoot(ctx, created.ID, path)
		if err != nil || grant.SourceID != created.ID ||
			grant.Path != path || grant.Status != "awaiting_executor" ||
			!grant.StrongIdentity {
			// Native binding may have succeeded before a lost reply; do not
			// claim either a confirmed grant or a confirmed paused draft.
			// Return an ID for explicit native draft/binding inspection.
			sendJSON(w, map[string]any{"source_id": created.ID, "state": "needs_inspection"})
			return
		}
		// Native binding completed, but do not report authorization under a
		// different Agent Owner if a simultaneous local login rotated scope.
		postGrantOwner, err := owner.ServerConnection(ctx)
		if err != nil || !postGrantOwner.Configured ||
			subtle.ConstantTimeCompare([]byte(dsmOwnerScope(
				key, username, r.Header.Get("Cookie"), r.Host,
				postGrantOwner.Server, postGrantOwner.Username)), []byte(input.OwnerScope)) != 1 {
			sendJSON(w, map[string]any{"source_id": created.ID, "state": "needs_inspection"})
			return
		}
		sendJSON(w, map[string]any{"source_id": created.ID, "state": "authorized"})
		return
	}
	// A selected NAS directory must be verified by the original local Agent.
	// The browser can submit only a session-scoped token, never an absolute
	// path. This is still read-only: no Root grant or Source creation.
	if r.URL.Path == "/v1/nas-share-preflight" {
		selection, err := parseNASSharePreflight(r)
		if err != nil {
			http.Error(w, "invalid NAS share selection", http.StatusBadRequest)
			return
		}
		checker, ok := agent.(NASSharePreflighter)
		if !ok {
			http.Error(w, "native NAS preflight not supported", http.StatusNotImplemented)
			return
		}
		root := g.nasShareRoot
		if root == "" {
			root = "/"
		}
		path, err := resolveNASSharePreflight(ctx, root, key, username, r.Header.Get("Cookie"), r.Host, selection)
		if err != nil {
			http.Error(w, "NAS share selection expired; refresh required", http.StatusConflict)
			return
		}
		if err := checker.PreflightLocalRoot(ctx, path); err != nil {
			http.Error(w, "NAS source preflight unavailable", http.StatusServiceUnavailable)
			return
		}
		sendJSON(w, map[string]bool{"verified": true})
		return
	}
	// Only the authorized DSM principal and same-user Agent may inspect
	// readable NAS share roots. No client-specified path or native Root grant.
	if r.URL.Path == "/v1/nas-shares" {
		if r.URL.RawQuery != "" {
			http.Error(w, "NAS shares accept no path selector", http.StatusBadRequest)
			return
		}
		root := g.nasShareRoot
		if root == "" {
			root = "/"
		}
		choices, err := enumerateNASShareChoices(ctx, root, key, username, r.Header.Get("Cookie"), r.Host)
		if err != nil {
			http.Error(w, "NAS share inventory unavailable", http.StatusServiceUnavailable)
			return
		}
		items := make([]map[string]string, 0, len(choices))
		for _, choice := range choices {
			items = append(items, map[string]string{"label": choice.Label, "selection_id": choice.SelectionID})
		}
		sendJSON(w, map[string]any{"items": items})
		return
	}
	// Live Photo Motion is a separate, exact-revision, bounded Owner request
	// using the same DSM session and same-user Agent as the shared Gallery.
	if r.URL.Path == "/v1/cloud-live-motion" {
		serveOwnerLiveMotion(w, r, agent)
		return
	}
	// Same verified DSM user and same-user Agent for the read-only Gallery.
	// No arbitrary Server media query, write, credential or Root delegation.
	if r.URL.Path == "/v1/cloud-gallery-items" || r.URL.Path == "/v1/cloud-gallery-albums" {
		serveOwnerGallery(w, r, agent)
		return
	}
	// Fixed, bounded Owner cloud files GETs, using the Agent's actual Server
	// session; DSM login is not an xDrive account and grants no filesystem
	// mutation, byte streaming, arbitrary upstream URL or credential read.
	if r.URL.Path == "/v1/cloud-root" || r.URL.Path == "/v1/cloud-children" {
		reader, ok := agent.(OwnerFileReader)
		if !ok {
			http.Error(w, "Owner cloud file browsing unavailable", http.StatusNotImplemented)
			return
		}
		if r.URL.Path == "/v1/cloud-root" {
			if r.URL.RawQuery != "" {
				http.Error(w, "invalid cloud root query", http.StatusBadRequest)
				return
			}
			root, err := reader.OwnerFileRoot(ctx)
			if err != nil || !localbackupipc.ValidateOwnerFileRoot(root) {
				http.Error(w, "Server Owner cloud root unavailable", http.StatusServiceUnavailable)
				return
			}
			sendJSON(w, root)
			return
		}
		q, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil || len(q) < 4 || len(q) > 5 {
			http.Error(w, "invalid cloud children query", http.StatusBadRequest)
			return
		}
		for key, values := range q {
			switch key {
			case "parent_id", "limit", "sort", "order", "cursor":
				if len(values) != 1 {
					http.Error(w, "duplicate cloud children parameter", http.StatusBadRequest)
					return
				}
			default:
				http.Error(w, "unknown cloud children parameter", http.StatusBadRequest)
				return
			}
		}
		if len(q["parent_id"]) != 1 || len(q["limit"]) != 1 ||
			len(q["sort"]) != 1 || len(q["order"]) != 1 {
			http.Error(w, "incomplete cloud children query", http.StatusBadRequest)
			return
		}
		parent, errID := strconv.ParseUint(q.Get("parent_id"), 10, 64)
		limit, errLimit := strconv.Atoi(q.Get("limit"))
		sort, order, cursor := q.Get("sort"), q.Get("order"), q.Get("cursor")
		if errID != nil || !localbackupipc.ValidOwnerFileID(parent) ||
			strconv.FormatUint(parent, 10) != q.Get("parent_id") ||
			errLimit != nil || limit < 1 || limit > 200 ||
			strconv.Itoa(limit) != q.Get("limit") ||
			!localbackupipc.ValidOwnerFileSort(sort, order) ||
			!localbackupipc.ValidOwnerFileCursor(cursor) ||
			(len(q["cursor"]) != 0 && cursor == "") {
			http.Error(w, "invalid cloud children selector", http.StatusBadRequest)
			return
		}
		page, err := reader.OwnerFilePage(ctx, parent, limit, sort, order, cursor)
		if err != nil || !localbackupipc.ValidateOwnerFilesPage(page, parent, limit, sort, order, cursor) {
			http.Error(w, "Server Owner cloud folder unavailable", http.StatusServiceUnavailable)
			return
		}
		sendJSON(w, page)
		return
	}
	// Browser-native Range playback reuses the existing Owner media reader;
	// every request independently authenticates DSM and same-user Agent.
	if r.URL.Path == "/v1/cloud-media-stream" {
		reader, ok := agent.(OwnerMediaRangeReader)
		if !ok {
			http.Error(w, "authenticated Owner media stream unavailable", http.StatusNotImplemented)
			return
		}
		serveOwnerMediaStream(w, r, reader)
		return
	}
	// The real Server verifies the requested Owner/revision before generating
	// its JPEG/PNG derivative. This is never a NAS local-file read.
	if r.URL.Path == "/v1/cloud-thumbnail" {
		q, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil || len(q) != 2 || len(q["node_id"]) != 1 || len(q["revision"]) != 1 {
			http.Error(w, "invalid Owner thumbnail selector", http.StatusBadRequest)
			return
		}
		nodeID, errID := strconv.ParseUint(q.Get("node_id"), 10, 64)
		revision, errRevision := strconv.ParseUint(q.Get("revision"), 10, 64)
		if errID != nil || errRevision != nil ||
			!localbackupipc.ValidOwnerFileID(nodeID) ||
			!localbackupipc.ValidOwnerFileID(revision) ||
			strconv.FormatUint(nodeID, 10) != q.Get("node_id") ||
			strconv.FormatUint(revision, 10) != q.Get("revision") {
			http.Error(w, "invalid Owner thumbnail identity", http.StatusBadRequest)
			return
		}
		reader, ok := agent.(OwnerThumbnailReader)
		if !ok {
			http.Error(w, "Owner thumbnail capability unavailable", http.StatusNotImplemented)
			return
		}
		thumbnail, err := reader.OwnerFileThumbnail(ctx, nodeID, revision)
		if err != nil || !localbackupipc.ValidateOwnerThumbnail(thumbnail) {
			http.Error(w, "Owner image derivative unavailable", http.StatusServiceUnavailable)
			return
		}
		sendJSON(w, thumbnail)
		return
	}
	// Fixed 256 KiB immutable media slice. The request contains only canonical
	// positive IDs/revision and a bounded offset/length. Same-origin DSM login
	// and same-user Agent discovery are rechecked for *every* chunk.
	if r.URL.Path == "/v1/cloud-media-range" {
		q, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil || len(q) != 4 ||
			len(q["node_id"]) != 1 || len(q["revision"]) != 1 ||
			len(q["offset"]) != 1 || len(q["length"]) != 1 {
			http.Error(w, "invalid Owner media range selector", http.StatusBadRequest)
			return
		}
		nodeID, errID := strconv.ParseUint(q.Get("node_id"), 10, 64)
		revision, errRevision := strconv.ParseUint(q.Get("revision"), 10, 64)
		offset, errOffset := strconv.ParseInt(q.Get("offset"), 10, 64)
		length, errLength := strconv.Atoi(q.Get("length"))
		if errID != nil || errRevision != nil || errOffset != nil || errLength != nil ||
			!localbackupipc.ValidOwnerFileID(nodeID) ||
			!localbackupipc.ValidOwnerFileID(revision) ||
			offset < 0 || uint64(offset) > localbackupipc.MaxSafeSourceID ||
			length < 1 || length > 256<<10 ||
			strconv.FormatUint(nodeID, 10) != q.Get("node_id") ||
			strconv.FormatUint(revision, 10) != q.Get("revision") ||
			strconv.FormatInt(offset, 10) != q.Get("offset") ||
			strconv.Itoa(length) != q.Get("length") {
			http.Error(w, "invalid Owner media range metadata", http.StatusBadRequest)
			return
		}
		reader, ok := agent.(OwnerMediaRangeReader)
		if !ok {
			http.Error(w, "Owner media range unavailable", http.StatusNotImplemented)
			return
		}
		data, err := reader.OwnerFileMediaRange(ctx, nodeID, revision, offset, length)
		if err != nil || !localbackupipc.ValidateOwnerMediaRange(data, offset, length, revision) {
			http.Error(w, "Server Owner content unavailable", http.StatusServiceUnavailable)
			return
		}
		sendJSON(w, data)
		return
	}
	// Text preview is a single bounded, credential-free JSON projection from
	// the original Server Owner session, not a generic download/URL proxy.
	if r.URL.Path == "/v1/cloud-text-preview" {
		q, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil || len(q) != 1 || len(q["node_id"]) != 1 {
			http.Error(w, "invalid text preview selector", http.StatusBadRequest)
			return
		}
		nodeID, err := strconv.ParseUint(q.Get("node_id"), 10, 64)
		if err != nil || !localbackupipc.ValidOwnerFileID(nodeID) ||
			strconv.FormatUint(nodeID, 10) != q.Get("node_id") {
			http.Error(w, "invalid text preview node", http.StatusBadRequest)
			return
		}
		reader, ok := agent.(OwnerTextPreviewReader)
		if !ok {
			http.Error(w, "owning Agent text preview unavailable", http.StatusNotImplemented)
			return
		}
		preview, err := reader.OwnerFileTextPreview(ctx, nodeID)
		if err != nil || !localbackupipc.ValidateOwnerTextPreview(preview) {
			http.Error(w, "Server Owner text preview unavailable", http.StatusServiceUnavailable)
			return
		}
		sendJSON(w, preview)
		return
	}
	// Owner quota comes exclusively from the running Agent's authenticated
	// Server session. DSM identity is never a Server account, and a browser
	// never receives the protected Agent token or a general HTTP proxy.
	if r.URL.Path == "/v1/cloud-quota" {
		if r.URL.RawQuery != "" {
			http.Error(w, "invalid quota query", http.StatusBadRequest)
			return
		}
		reader, ok := agent.(OwnerQuotaReader)
		if !ok {
			http.Error(w, "owning Agent does not support Owner quota", http.StatusNotImplemented)
			return
		}
		quota, err := reader.OwnerQuota(ctx)
		if err != nil || !localbackupipc.ValidateOwnerQuota(quota) {
			http.Error(w, "Server Owner quota unavailable", http.StatusServiceUnavailable)
			return
		}
		sendJSON(w, quota)
		return
	}
	// Keyset and per-device folder continuations use the original Server
	// Owner-scoped Agent read methods. These routes are strictly GET-only
	// and are intentionally not converted into local Source ownership.
	if r.URL.Path == "/v1/device-backup-page" || r.URL.Path == "/v1/device-backup-folders" {
		pager, ok := agent.(OwnerDeviceBackupPager)
		if !ok {
			http.Error(w, "Agent has no Owner device paging capability", http.StatusNotImplemented)
			return
		}
		query, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil || len(query["limit"]) != 1 {
			http.Error(w, "invalid Owner page query", http.StatusBadRequest)
			return
		}
		limit, limitErr := strconv.Atoi(query.Get("limit"))
		if limitErr != nil || limit < 1 || limit > 100 || strconv.Itoa(limit) != query.Get("limit") {
			http.Error(w, "invalid Owner page limit", http.StatusBadRequest)
			return
		}
		if r.URL.Path == "/v1/device-backup-page" {
			cursor := query.Get("after_device_id")
			id, parseErr := uuid.Parse(cursor)
			if len(query) != 2 || len(query["after_device_id"]) != 1 ||
				parseErr != nil || id.String() != cursor {
				http.Error(w, "invalid Owner device cursor", http.StatusBadRequest)
				return
			}
			page, err := pager.DeviceBackupOverviewPage(ctx, limit, cursor)
			if err != nil || page.Devices == nil || len(page.Devices) > limit ||
				(page.HasMore && (len(page.Devices) == 0 ||
					page.NextAfterDeviceID != page.Devices[len(page.Devices)-1].ID ||
					page.NextAfterDeviceID == cursor)) ||
				(!page.HasMore && page.NextAfterDeviceID != "") {
				http.Error(w, "Owner device continuation unavailable", http.StatusServiceUnavailable)
				return
			}
			sendJSON(w, page)
			return
		}
		deviceID := query.Get("device_id")
		parsedID, parseErr := uuid.Parse(deviceID)
		if len(query["device_id"]) != 1 || parseErr != nil || parsedID.String() != deviceID ||
			(len(query) != 2 && len(query) != 3) {
			http.Error(w, "invalid Owner folder device selector", http.StatusBadRequest)
			return
		}
		var afterSourceID uint64
		if values, found := query["after_source_id"]; found {
			parsed, parseErr := strconv.ParseUint(query.Get("after_source_id"), 10, 64)
			if len(values) != 1 || parseErr != nil || !localbackupipc.ValidSourceID(parsed) ||
				strconv.FormatUint(parsed, 10) != query.Get("after_source_id") {
				http.Error(w, "invalid Owner folder cursor", http.StatusBadRequest)
				return
			}
			afterSourceID = parsed
		}
		if len(query) == 3 && len(query["after_source_id"]) != 1 {
			http.Error(w, "unknown Owner folder query field", http.StatusBadRequest)
			return
		}
		page, err := pager.DeviceBackupFoldersPage(ctx, deviceID, limit, afterSourceID)
		if err != nil || page.Folders == nil || len(page.Folders) > limit ||
			(page.HasMore && (len(page.Folders) == 0 ||
				page.NextAfterSourceID != page.Folders[len(page.Folders)-1].SourceID ||
				page.NextAfterSourceID <= afterSourceID)) ||
			(!page.HasMore && page.NextAfterSourceID != 0) {
			http.Error(w, "Owner folder continuation unavailable", http.StatusServiceUnavailable)
			return
		}
		previous := afterSourceID
		for _, folder := range page.Folders {
			if !localbackupipc.ValidSourceID(folder.SourceID) || folder.SourceID <= previous {
				http.Error(w, "Owner folder rows invalid", http.StatusServiceUnavailable)
				return
			}
			previous = folder.SourceID
		}
		sendJSON(w, page)
		return
	}
	// Server Owner-scoped B-scope is read through the existing authenticated
	// Backup-only Agent. No DSM username is ever interpreted as a Server user.
	// Do not call local ReadSchedule for another device: that proves *native*
	// ownership only and cannot grant or deny this Server Owner read scope.
	if r.URL.Path == "/v1/device-backups" || r.URL.Path == "/v1/device-backup-runs" {
		reader, ok := agent.(OwnerDeviceBackupReader)
		if !ok {
			http.Error(w, "Agent has no owner-scoped remote backup read", http.StatusNotImplemented)
			return
		}
		if r.URL.Path == "/v1/device-backups" {
			if r.URL.RawQuery != "" {
				http.Error(w, "invalid owner-scoped device query", http.StatusBadRequest)
				return
			}
			page, err := reader.DeviceBackupOverview(ctx)
			if err != nil || page.Devices == nil || len(page.Devices) > 100 ||
				(page.HasMore && page.NextAfterDeviceID == "") {
				http.Error(w, "Server Owner device overview unavailable", http.StatusServiceUnavailable)
				return
			}
			sendJSON(w, page)
			return
		}
		selector, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil || len(selector) != 3 || len(selector["source_id"]) != 1 ||
			len(selector["limit"]) != 1 || len(selector["offset"]) != 1 {
			http.Error(w, "invalid Owner history query", http.StatusBadRequest)
			return
		}
		id, idErr := strconv.ParseUint(selector.Get("source_id"), 10, 64)
		limit, limitErr := strconv.Atoi(selector.Get("limit"))
		offset, offsetErr := strconv.Atoi(selector.Get("offset"))
		if idErr != nil || !localbackupipc.ValidSourceID(id) ||
			strconv.FormatUint(id, 10) != selector.Get("source_id") ||
			limitErr != nil || limit < 1 || limit > 20 ||
			strconv.Itoa(limit) != selector.Get("limit") ||
			offsetErr != nil || offset < 0 || offset > 100000-limit ||
			strconv.Itoa(offset) != selector.Get("offset") {
			http.Error(w, "invalid Owner history selector", http.StatusBadRequest)
			return
		}
		page, err := reader.DeviceBackupRuns(ctx, id, limit, offset)
		if err != nil || page.Items == nil || len(page.Items) > limit ||
			(page.HasMore && len(page.Items) != limit) {
			http.Error(w, "Server Owner history unavailable", http.StatusServiceUnavailable)
			return
		}
		for _, item := range page.Items {
			if item.SourceID != id {
				http.Error(w, "invalid Owner history Source", http.StatusServiceUnavailable)
				return
			}
		}
		sendJSON(w, page)
		return
	}
	if r.URL.Path == "/v1/sources" {
		if r.URL.RawQuery != "" {
			http.Error(w, "invalid query", http.StatusBadRequest)
			return
		}
		all, err := agent.Sources(ctx)
		if err != nil || len(all) > maxSources {
			http.Error(w, "source list unavailable", http.StatusServiceUnavailable)
			return
		}
		items := make([]map[string]any, 0, len(all))
		for _, item := range all {
			if item.Kind != "local_folder" || item.Direction != "push" || item.SyncMode != "backup" || !localbackupipc.ValidSourceID(item.ID) {
				continue
			}
			if _, err := agent.ReadSchedule(ctx, item.ID); err != nil {
				continue
			}
			items = append(items, map[string]any{"source_id": item.ID, "name": item.Name})
		}
		sendJSON(w, map[string]any{"items": items})
		return
	}
	expectedArgs := 1
	if r.URL.Path == "/v1/control" {
		expectedArgs = 2
	}
	id, ok := sourceID(r, expectedArgs)
	if !ok {
		http.Error(w, "invalid Source selector", http.StatusBadRequest)
		return
	}
	schedule, err := agent.ReadSchedule(ctx, id)
	if err != nil || !localbackupipc.ValidateSchedule(schedule, id) {
		http.Error(w, "Source is not owned by this Agent", http.StatusForbidden)
		return
	}
	switch r.URL.Path {
	case "/v1/schedule":
		if r.Method == http.MethodGet {
			sendJSON(w, schedule)
			return
		}
		spec, err := parseScheduleMutation(r)
		if err != nil {
			http.Error(w, "invalid schedule request", http.StatusBadRequest)
			return
		}
		if spec.Revision != schedule.Revision {
			http.Error(w, "schedule revision changed; refresh required", http.StatusConflict)
			return
		}
		updated, err := agent.SaveSchedule(ctx, id, spec.Revision, localbackupipc.Schedule{
			SourceID: id, ScheduleType: spec.ScheduleType,
			ScheduleExpression: spec.ScheduleExpression, ScheduleTimezone: spec.ScheduleTimezone,
		})
		if err == nil && localbackupipc.ValidateSchedule(updated, id) &&
			updated.Revision > spec.Revision && updated.ScheduleType == spec.ScheduleType &&
			updated.ScheduleExpression == spec.ScheduleExpression &&
			updated.ScheduleTimezone == spec.ScheduleTimezone {
			sendJSON(w, updated)
			return
		}
	case "/v1/status":
		result, err := agent.Status(ctx, id)
		if err == nil && localbackupipc.ValidateSummary(result, id) {
			sendJSON(w, result)
			return
		}
	case "/v1/history":
		result, err := agent.History(ctx, id)
		if err == nil && localbackupipc.ValidateHistory(result, id) {
			sendJSON(w, result)
			return
		}
	case "/v1/run":
		result, err := agent.Start(ctx, id)
		if err == nil && localbackupipc.ValidateSummary(result, id) {
			sendJSON(w, result)
			return
		}
	case "/v1/control":
		action := r.URL.Query().Get("action")
		if action != "pause" && action != "cancel" {
			http.Error(w, "invalid action", http.StatusBadRequest)
			return
		}
		result, err := agent.Control(ctx, id, action)
		if err == nil && localbackupipc.ValidateSummary(result, id) {
			sendJSON(w, result)
			return
		}
	}
	http.Error(w, "owning Agent operation unavailable", http.StatusServiceUnavailable)
}
