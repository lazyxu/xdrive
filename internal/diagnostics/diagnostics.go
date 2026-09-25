package diagnostics

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	xupdate "github.com/lazyxu/xdrive/internal/update"
	"github.com/lazyxu/xdrive/internal/userconfig"
	"github.com/lazyxu/xdrive/internal/version"
)

const (
	Pass = "PASS"
	Warn = "WARN"
	Fail = "FAIL"
)

type Check struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

type Summary struct {
	Pass int `json:"pass"`
	Warn int `json:"warn"`
	Fail int `json:"fail"`
}

type Report struct {
	GeneratedAt time.Time `json:"generated_at"`
	Platform    string    `json:"platform"`
	Arch        string    `json:"arch"`
	Checks      []Check   `json:"checks"`
	Summary     Summary   `json:"summary"`
}

func Run(ctx context.Context) Report {
	if ctx == nil {
		ctx = context.Background()
	}
	checks := []Check{{Name: "client version", Status: Pass, Detail: version.String()}}

	channel, commit, err := xupdate.AutomaticTarget(version.String())
	if err != nil {
		checks = append(checks, Check{Name: "update channel", Status: Fail, Detail: err.Error()})
	} else if channel == "" {
		checks = append(checks, Check{Name: "update channel", Status: Warn, Detail: "development build; no automatic channel"})
	} else {
		detail := channel
		if channel == xupdate.ChannelCommit && commit != "" {
			detail += " @ " + ShortID(commit)
		}
		checks = append(checks, Check{Name: "update channel", Status: Pass, Detail: detail})
		checkCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
		result, checkErr := xupdate.CheckTarget(checkCtx, version.String(), channel, commit)
		cancel()
		if checkErr != nil {
			checks = append(checks, Check{Name: "update metadata", Status: Warn, Detail: checkErr.Error()})
		} else {
			if result.UpdateAvailable {
				detail := "update available: " + result.Latest
				if result.Asset.Size > 0 {
					detail += " (" + FormatBytes(uint64(result.Asset.Size)) + ")"
				}
				checks = append(checks, Check{Name: "update metadata", Status: Warn, Detail: detail})
			} else {
				checks = append(checks, Check{Name: "update metadata", Status: Pass, Detail: "channel metadata reachable; client is current"})
			}
			if result.Asset.Name != "" {
				probeCtx, probeCancel := context.WithTimeout(ctx, 8*time.Second)
				source, probeErr := xupdate.ProbeAssetDownload(probeCtx, version.String(), result.Asset)
				probeCancel()
				if probeErr != nil {
					checks = append(checks, Check{Name: "update download", Status: Warn, Detail: probeErr.Error()})
				} else {
					detail := source
					if result.Asset.Size > 0 {
						detail += "; asset " + FormatBytes(uint64(result.Asset.Size))
					}
					checks = append(checks, Check{Name: "update download", Status: Pass, Detail: detail})
				}
			}
		}
	}

	cfg, err := userconfig.Load()
	if err != nil {
		checks = append(checks,
			Check{Name: "local config", Status: Fail, Detail: err.Error()},
			Check{Name: "login session", Status: Warn, Detail: "skipped because local config is unavailable"},
			Check{Name: "cache policy", Status: Warn, Detail: "skipped because local config is unavailable"},
		)
		checks = append(checks, PlatformChecks("")...)
		return NewReport(checks)
	}

	checks = append(checks, Check{Name: "local config", Status: Pass, Detail: "loaded for " + MaskUser(cfg.Username)})
	backend := userconfig.CredentialBackend(cfg)
	backendStatus := Pass
	if backend == "unavailable" {
		backendStatus = Fail
	}
	checks = append(checks, Check{Name: "credential store", Status: backendStatus, Detail: backend})

	cacheDetail := "unlimited"
	if cfg.CacheLimitBytes > 0 {
		cacheDetail = "limit " + FormatBytes(uint64(cfg.CacheLimitBytes))
	}
	checks = append(checks, Check{Name: "cache policy", Status: Pass, Detail: cacheDetail})

	mountPath, mountErr := userconfig.EffectiveMountPath(cfg)
	if mountErr != nil {
		checks = append(checks, Check{Name: "sync root", Status: Fail, Detail: mountErr.Error()})
		mountPath = ""
	} else if st, statErr := os.Stat(mountPath); statErr != nil {
		if errors.Is(statErr, os.ErrNotExist) {
			checks = append(checks, Check{Name: "sync root", Status: Warn, Detail: DisplayPath(mountPath) + " does not exist yet"})
		} else {
			checks = append(checks, Check{Name: "sync root", Status: Fail, Detail: statErr.Error()})
		}
	} else if !st.IsDir() {
		checks = append(checks, Check{Name: "sync root", Status: Fail, Detail: DisplayPath(mountPath) + " is not a directory"})
	} else {
		checks = append(checks, Check{Name: "sync root", Status: Pass, Detail: DisplayPath(mountPath)})
	}

	checks = append(checks, ServerChecks(ctx, cfg.Server)...)

	cli, cliErr := userconfig.NewClient(cfg)
	if cliErr != nil {
		checks = append(checks, Check{Name: "login session", Status: Fail, Detail: cliErr.Error()})
	} else {
		loginCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		_, rootErr := cli.Root(loginCtx)
		cancel()
		if rootErr != nil {
			checks = append(checks, Check{Name: "login session", Status: Fail, Detail: rootErr.Error()})
		} else if cfg.MustChangePassword {
			checks = append(checks, Check{Name: "login session", Status: Warn, Detail: "authenticated; password change required before sync"})
		} else {
			checks = append(checks, Check{Name: "login session", Status: Pass, Detail: "authenticated API request succeeded"})
		}
	}

	checks = append(checks, PlatformChecks(mountPath)...)
	return NewReport(checks)
}

func NewReport(checks []Check) Report {
	report := Report{
		GeneratedAt: time.Now().UTC(),
		Platform:    runtime.GOOS,
		Arch:        runtime.GOARCH,
		Checks:      append([]Check(nil), checks...),
	}
	for _, check := range report.Checks {
		switch check.Status {
		case Pass:
			report.Summary.Pass++
		case Warn:
			report.Summary.Warn++
		case Fail:
			report.Summary.Fail++
		}
	}
	return report
}

func WithChecks(report Report, checks ...Check) Report {
	combined := append(append([]Check(nil), report.Checks...), checks...)
	next := NewReport(combined)
	next.GeneratedAt = report.GeneratedAt
	next.Platform = report.Platform
	next.Arch = report.Arch
	return next
}

func Redacted(report Report) Report {
	out := report
	out.Checks = make([]Check, len(report.Checks))
	for i, check := range report.Checks {
		check.Detail = RedactDetail(check.Detail)
		out.Checks[i] = check
	}
	return out
}

func FormatText(report Report) string {
	var b strings.Builder
	fmt.Fprintln(&b, "xDrive diagnostic report")
	fmt.Fprintf(&b, "generated: %s\n", report.GeneratedAt.UTC().Format(time.RFC3339))
	fmt.Fprintf(&b, "platform: %s/%s\n", report.Platform, report.Arch)
	fmt.Fprintln(&b, "redaction: secrets/tokens/session IDs are never printed; home paths are shortened")
	fmt.Fprintln(&b)
	for _, check := range report.Checks {
		fmt.Fprintf(&b, "[%s] %-20s %s\n", check.Status, check.Name, RedactDetail(check.Detail))
	}
	fmt.Fprintln(&b)
	fmt.Fprintf(&b, "summary: %d pass, %d warn, %d fail\n", report.Summary.Pass, report.Summary.Warn, report.Summary.Fail)
	if report.Summary.Fail == 0 {
		fmt.Fprintln(&b, "doctor result: usable; review warnings if present")
	} else {
		fmt.Fprintln(&b, "doctor result: attention required")
	}
	return b.String()
}

func ServerChecks(parent context.Context, server string) []Check {
	u, err := url.Parse(strings.TrimSpace(server))
	if err != nil || u.Scheme == "" || u.Host == "" {
		if err == nil {
			err = fmt.Errorf("invalid server URL")
		}
		return []Check{{Name: "server URL", Status: Fail, Detail: err.Error()}}
	}
	checks := []Check{{Name: "server URL", Status: Pass, Detail: u.Scheme + "://" + u.Host}}

	ctx, cancel := context.WithTimeout(parent, 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(server, "/")+"/api/v1/healthz", nil)
	if err != nil {
		return append(checks, Check{Name: "server health", Status: Fail, Detail: err.Error()})
	}
	transport := &http.Transport{
		Proxy:           http.ProxyFromEnvironment,
		DialContext:     (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
		TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12},
	}
	resp, err := (&http.Client{Transport: transport}).Do(req)
	if err != nil {
		checks = append(checks, Check{Name: "server health", Status: Fail, Detail: err.Error()})
		if u.Scheme == "https" {
			checks = append(checks, Check{Name: "TLS", Status: Fail, Detail: "TLS/HTTPS connection failed"})
		}
		return checks
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		checks = append(checks, Check{Name: "server health", Status: Fail, Detail: fmt.Sprintf("HTTP %d", resp.StatusCode)})
	} else {
		checks = append(checks, Check{Name: "server health", Status: Pass, Detail: fmt.Sprintf("HTTP %d", resp.StatusCode)})
	}
	if u.Scheme == "https" {
		if resp.TLS == nil || len(resp.TLS.PeerCertificates) == 0 {
			checks = append(checks, Check{Name: "TLS", Status: Fail, Detail: "HTTPS response had no peer certificate"})
		} else {
			cert := resp.TLS.PeerCertificates[0]
			remaining := time.Until(cert.NotAfter)
			status := Pass
			if remaining < 7*24*time.Hour {
				status = Warn
			}
			checks = append(checks, Check{Name: "TLS", Status: status, Detail: "certificate valid until " + cert.NotAfter.UTC().Format("2006-01-02")})
		}
	} else {
		checks = append(checks, Check{Name: "TLS", Status: Warn, Detail: "server uses plaintext HTTP"})
	}
	return checks
}

func ShortID(v string) string {
	v = strings.TrimSpace(v)
	if len(v) > 12 {
		return v[:12]
	}
	return v
}

func MaskUser(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return "<unknown>"
	}
	r := []rune(v)
	if len(r) <= 2 {
		return string(r[0]) + "***"
	}
	return string(r[:2]) + "***"
}

func DisplayPath(p string) string {
	if p == "" {
		return ""
	}
	home, err := os.UserHomeDir()
	if err == nil {
		home = filepath.Clean(home)
		clean := filepath.Clean(p)
		if clean == home || (runtime.GOOS == "windows" && strings.EqualFold(clean, home)) {
			return "~"
		}
		prefix := home + string(os.PathSeparator)
		if strings.HasPrefix(clean, prefix) {
			return "~" + string(os.PathSeparator) + strings.TrimPrefix(clean, prefix)
		}
		if runtime.GOOS == "windows" && strings.HasPrefix(strings.ToLower(clean), strings.ToLower(prefix)) {
			return "~" + string(os.PathSeparator) + clean[len(prefix):]
		}
	}
	return filepath.Clean(p)
}

func RedactDetail(s string) string {
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	home, err := os.UserHomeDir()
	if err == nil && home != "" {
		if runtime.GOOS == "windows" {
			s = regexp.MustCompile(`(?i)`+regexp.QuoteMeta(home)).ReplaceAllString(s, "~")
		} else {
			s = strings.ReplaceAll(s, home, "~")
		}
	}
	patterns := []struct {
		re   *regexp.Regexp
		repl string
	}{
		{regexp.MustCompile(`(?i)(authorization:?\s*bearer\s+)\S+`), `${1}<redacted>`},
		{regexp.MustCompile(`(?i)((?:refresh|access)[_-]?token[=:]\s*)[^ ,;&"]+`), `${1}<redacted>`},
		{regexp.MustCompile(`(?i)((?:XD_JWT_SECRET|POSTGRES_PASSWORD|ALIYUN_ACCESS_KEY_SECRET)[=:]\s*)[^ ,;&"]+`), `${1}<redacted>`},
		{regexp.MustCompile(`(?i)(https?://)[^/@\s]+:[^/@\s]+@`), `${1}<redacted>@`},
		{regexp.MustCompile(`(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`), `<session-id>`},
	}
	for _, pattern := range patterns {
		s = pattern.re.ReplaceAllString(s, pattern.repl)
	}
	return strings.TrimSpace(s)
}

func FormatBytes(v uint64) string {
	const unit = 1024
	if v < unit {
		return fmt.Sprintf("%d B", v)
	}
	div, exp := uint64(unit), 0
	for n := v / unit; n >= unit && exp < 3; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %ciB", float64(v)/float64(div), "KMGT"[exp])
}
