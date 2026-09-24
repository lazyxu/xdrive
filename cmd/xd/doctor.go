package main

import (
	"context"
	"crypto/tls"
	"errors"
	"flag"
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

type doctorCheck struct {
	Name   string
	Status string
	Detail string
}

const (
	doctorPass = "PASS"
	doctorWarn = "WARN"
	doctorFail = "FAIL"
)

func doctorCmd(args []string) error {
	fs := flag.NewFlagSet("doctor", flag.ContinueOnError)
	strict := fs.Bool("strict", false, "exit non-zero when a diagnostic check fails")
	if err := fs.Parse(args); err != nil {
		return err
	}

	checks := runDoctorChecks()
	pass, warn, fail := 0, 0, 0
	fmt.Printf("xDrive diagnostic report\n")
	fmt.Printf("generated: %s\n", time.Now().UTC().Format(time.RFC3339))
	fmt.Printf("platform: %s/%s\n", runtime.GOOS, runtime.GOARCH)
	fmt.Println("redaction: secrets/tokens/session IDs are never printed; home paths are shortened")
	fmt.Println()

	for _, c := range checks {
		switch c.Status {
		case doctorPass:
			pass++
		case doctorWarn:
			warn++
		case doctorFail:
			fail++
		}
		fmt.Printf("[%s] %-20s %s\n", c.Status, c.Name, redactDoctorDetail(c.Detail))
	}
	fmt.Println()
	fmt.Printf("summary: %d pass, %d warn, %d fail\n", pass, warn, fail)
	if fail == 0 {
		fmt.Println("doctor result: usable; review warnings if present")
	} else {
		fmt.Println("doctor result: attention required")
	}
	if *strict && fail > 0 {
		return fmt.Errorf("doctor found %d failing check(s)", fail)
	}
	return nil
}

func runDoctorChecks() []doctorCheck {
	checks := []doctorCheck{{
		Name: "client version", Status: doctorPass, Detail: version.String(),
	}}

	channel, commit, err := xupdate.AutomaticTarget(version.String())
	if err != nil {
		checks = append(checks, doctorCheck{Name: "update channel", Status: doctorFail, Detail: err.Error()})
	} else if channel == "" {
		checks = append(checks, doctorCheck{Name: "update channel", Status: doctorWarn, Detail: "development build; no automatic channel"})
	} else {
		detail := channel
		if channel == xupdate.ChannelCommit && commit != "" {
			detail += " @ " + shortDoctorID(commit)
		}
		checks = append(checks, doctorCheck{Name: "update channel", Status: doctorPass, Detail: detail})
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		result, checkErr := xupdate.CheckTarget(ctx, version.String(), channel, commit)
		cancel()
		if checkErr != nil {
			checks = append(checks, doctorCheck{Name: "update metadata", Status: doctorWarn, Detail: checkErr.Error()})
		} else {
			if result.UpdateAvailable {
				detail := "update available: " + result.Latest
				if result.Asset.Size > 0 {
					detail += " (" + formatStorageBytes(result.Asset.Size) + ")"
				}
				checks = append(checks, doctorCheck{Name: "update metadata", Status: doctorWarn, Detail: detail})
			} else {
				checks = append(checks, doctorCheck{Name: "update metadata", Status: doctorPass, Detail: "channel metadata reachable; client is current"})
			}
			if result.Asset.Name != "" {
				probeCtx, probeCancel := context.WithTimeout(context.Background(), 8*time.Second)
				source, probeErr := xupdate.ProbeAssetDownload(probeCtx, version.String(), result.Asset)
				probeCancel()
				if probeErr != nil {
					checks = append(checks, doctorCheck{Name: "update download", Status: doctorWarn, Detail: probeErr.Error()})
				} else {
					detail := source
					if result.Asset.Size > 0 {
						detail += "; asset " + formatStorageBytes(result.Asset.Size)
					}
					checks = append(checks, doctorCheck{Name: "update download", Status: doctorPass, Detail: detail})
				}
			}
		}
	}

	cfg, err := userconfig.Load()
	if err != nil {
		checks = append(checks,
			doctorCheck{Name: "local config", Status: doctorFail, Detail: err.Error()},
			doctorCheck{Name: "login session", Status: doctorWarn, Detail: "skipped because local config is unavailable"},
		)
		return append(checks, platformDoctorChecks("")...)
	}

	checks = append(checks, doctorCheck{Name: "local config", Status: doctorPass, Detail: "loaded for " + maskDoctorUser(cfg.Username)})
	backend := userconfig.CredentialBackend(cfg)
	backendStatus := doctorPass
	if backend == "unavailable" {
		backendStatus = doctorFail
	}
	checks = append(checks, doctorCheck{Name: "credential store", Status: backendStatus, Detail: backend})

	mountPath, mountErr := userconfig.EffectiveMountPath(cfg)
	if mountErr != nil {
		checks = append(checks, doctorCheck{Name: "sync root", Status: doctorFail, Detail: mountErr.Error()})
		mountPath = ""
	} else if st, statErr := os.Stat(mountPath); statErr != nil {
		if errors.Is(statErr, os.ErrNotExist) {
			checks = append(checks, doctorCheck{Name: "sync root", Status: doctorWarn, Detail: doctorPath(mountPath) + " does not exist yet"})
		} else {
			checks = append(checks, doctorCheck{Name: "sync root", Status: doctorFail, Detail: statErr.Error()})
		}
	} else if !st.IsDir() {
		checks = append(checks, doctorCheck{Name: "sync root", Status: doctorFail, Detail: doctorPath(mountPath) + " is not a directory"})
	} else {
		checks = append(checks, doctorCheck{Name: "sync root", Status: doctorPass, Detail: doctorPath(mountPath)})
	}

	checks = append(checks, doctorServerChecks(cfg.Server)...)

	cli, cliErr := userconfig.NewClient(cfg)
	if cliErr != nil {
		checks = append(checks, doctorCheck{Name: "login session", Status: doctorFail, Detail: cliErr.Error()})
	} else {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		_, rootErr := cli.Root(ctx)
		cancel()
		if rootErr != nil {
			checks = append(checks, doctorCheck{Name: "login session", Status: doctorFail, Detail: rootErr.Error()})
		} else if cfg.MustChangePassword {
			checks = append(checks, doctorCheck{Name: "login session", Status: doctorWarn, Detail: "authenticated; password change required before sync"})
		} else {
			checks = append(checks, doctorCheck{Name: "login session", Status: doctorPass, Detail: "authenticated API request succeeded"})
		}
	}

	checks = append(checks, platformDoctorChecks(mountPath)...)
	return checks
}

func doctorServerChecks(server string) []doctorCheck {
	u, err := url.Parse(strings.TrimSpace(server))
	if err != nil || u.Scheme == "" || u.Host == "" {
		if err == nil {
			err = fmt.Errorf("invalid server URL")
		}
		return []doctorCheck{{Name: "server URL", Status: doctorFail, Detail: err.Error()}}
	}
	checks := []doctorCheck{{Name: "server URL", Status: doctorPass, Detail: u.Scheme + "://" + u.Host}}

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(server, "/")+"/api/v1/healthz", nil)
	if err != nil {
		return append(checks, doctorCheck{Name: "server health", Status: doctorFail, Detail: err.Error()})
	}
	transport := &http.Transport{
		Proxy:           http.ProxyFromEnvironment,
		DialContext:     (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
		TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12},
	}
	resp, err := (&http.Client{Transport: transport}).Do(req)
	if err != nil {
		checks = append(checks, doctorCheck{Name: "server health", Status: doctorFail, Detail: err.Error()})
		if u.Scheme == "https" {
			checks = append(checks, doctorCheck{Name: "TLS", Status: doctorFail, Detail: "TLS/HTTPS connection failed"})
		}
		return checks
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		checks = append(checks, doctorCheck{Name: "server health", Status: doctorFail, Detail: fmt.Sprintf("HTTP %d", resp.StatusCode)})
	} else {
		checks = append(checks, doctorCheck{Name: "server health", Status: doctorPass, Detail: fmt.Sprintf("HTTP %d", resp.StatusCode)})
	}
	if u.Scheme == "https" {
		if resp.TLS == nil || len(resp.TLS.PeerCertificates) == 0 {
			checks = append(checks, doctorCheck{Name: "TLS", Status: doctorFail, Detail: "HTTPS response had no peer certificate"})
		} else {
			cert := resp.TLS.PeerCertificates[0]
			remaining := time.Until(cert.NotAfter)
			status := doctorPass
			if remaining < 7*24*time.Hour {
				status = doctorWarn
			}
			checks = append(checks, doctorCheck{Name: "TLS", Status: status, Detail: "certificate valid until " + cert.NotAfter.UTC().Format("2006-01-02")})
		}
	} else {
		checks = append(checks, doctorCheck{Name: "TLS", Status: doctorWarn, Detail: "server uses plaintext HTTP"})
	}
	return checks
}

func shortDoctorID(v string) string {
	v = strings.TrimSpace(v)
	if len(v) > 12 {
		return v[:12]
	}
	return v
}

func maskDoctorUser(v string) string {
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

func doctorPath(p string) string {
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

func redactDoctorDetail(s string) string {
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
	for _, p := range patterns {
		s = p.re.ReplaceAllString(s, p.repl)
	}
	return strings.TrimSpace(s)
}
