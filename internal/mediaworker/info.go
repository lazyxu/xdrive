package mediaworker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	ProtocolVersion = 1
	headerName      = "X-XDrive-Media-Protocol"
	maxResponse     = 4096
	maxVersion      = 192
)

type Info struct {
	ProtocolVersion        int    `json:"protocol_version"`
	Ready                  bool   `json:"ready"`
	FFmpegVersion          string `json:"ffmpeg_version"`
	FFprobeVersion         string `json:"ffprobe_version"`
	TaskExecutionSupported bool   `json:"task_execution_supported"`
}

type Prober interface {
	Info(context.Context) (Info, error)
}
type ProbeFunc func(context.Context) (Info, error)

func (f ProbeFunc) Info(ctx context.Context) (Info, error) { return f(ctx) }

func ValidInfo(v Info) bool {
	return v.ProtocolVersion == ProtocolVersion && v.Ready &&
		!v.TaskExecutionSupported &&
		validVersion(v.FFmpegVersion, "ffmpeg") &&
		validVersion(v.FFprobeVersion, "ffprobe")
}
func validVersion(value, name string) bool {
	return len(value) <= maxVersion && utf8.ValidString(value) &&
		strings.HasPrefix(value, name+" version ") &&
		!strings.ContainsAny(value, "\r\n\x00")
}

func ValidateSocket(socket string) error {
	if socket == "" || !filepath.IsAbs(socket) || filepath.Clean(socket) != socket ||
		!strings.HasSuffix(socket, ".sock") || len(socket) > 100 ||
		strings.ContainsRune(socket, '\x00') {
		return errors.New("media worker socket must be a bounded absolute .sock path")
	}
	return nil
}

type UnixClient struct{ http *http.Client }

func NewUnixClient(socket string, timeout time.Duration) (*UnixClient, error) {
	if err := ValidateSocket(socket); err != nil {
		return nil, err
	}
	if timeout <= 0 || timeout > 2*time.Second {
		timeout = 1500 * time.Millisecond
	}
	tr := &http.Transport{
		DisableKeepAlives: true,
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", socket)
		},
	}
	return &UnixClient{http: &http.Client{
		Transport: tr, Timeout: timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}, nil
}

func (c *UnixClient) Info(ctx context.Context) (Info, error) {
	if c == nil || c.http == nil {
		return Info{}, errors.New("media worker not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://xdrive-media-worker/v1/info", nil)
	if err != nil {
		return Info{}, err
	}
	req.Header.Set(headerName, "1")
	resp, err := c.http.Do(req)
	if err != nil {
		return Info{}, errors.New("media worker probe unavailable")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK ||
		!strings.HasPrefix(resp.Header.Get("Content-Type"), "application/json") {
		return Info{}, errors.New("media worker health response not successful")
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponse+1))
	if err != nil || len(body) > maxResponse {
		return Info{}, errors.New("media worker health response exceeded bounds")
	}
	var info Info
	if json.Unmarshal(body, &info) != nil || !ValidInfo(info) {
		return Info{}, errors.New("media worker health response unverified")
	}
	return info, nil
}

type boundedBuffer struct {
	bytes.Buffer
	overflow bool
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	n := len(p)
	remaining := maxResponse - b.Len()
	if remaining > 0 {
		if len(p) > remaining {
			_, _ = b.Buffer.Write(p[:remaining])
		} else {
			_, _ = b.Buffer.Write(p)
		}
	}
	if len(p) > remaining {
		b.overflow = true
	}
	return n, nil
}

func binaryVersion(parent context.Context, name string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, 1200*time.Millisecond)
	defer cancel()
	command := exec.CommandContext(ctx, name, "-version")
	var stdout boundedBuffer
	command.Stdout = &stdout
	command.Stderr = io.Discard
	if command.Run() != nil || stdout.overflow {
		return "", fmt.Errorf("%s executable check failed", name)
	}
	first, _, _ := strings.Cut(stdout.String(), "\n")
	first = strings.TrimSpace(first)
	if !validVersion(first, name) {
		return "", fmt.Errorf("%s returned unsupported version", name)
	}
	return first, nil
}

// LiveInfo verifies actual FFmpeg and FFprobe executables, never user media.
func LiveInfo(ctx context.Context) (Info, error) {
	ffmpeg, err := binaryVersion(ctx, "ffmpeg")
	if err != nil {
		return Info{}, err
	}
	ffprobe, err := binaryVersion(ctx, "ffprobe")
	if err != nil {
		return Info{}, err
	}
	return Info{ProtocolVersion: ProtocolVersion, Ready: true,
		FFmpegVersion: ffmpeg, FFprobeVersion: ffprobe,
		TaskExecutionSupported: false}, nil
}

// Handler intentionally has no task, filesystem, URL or command execution API.
func Handler(probe Prober) http.Handler {
	if probe == nil {
		probe = ProbeFunc(LiveInfo)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/info", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get(headerName) != "1" {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = io.WriteString(w, `{"error":"unsupported_protocol"}`)
			return
		}
		info, err := probe.Info(r.Context())
		if err != nil || !ValidInfo(info) {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = io.WriteString(w, `{"error":"runtime_unavailable"}`)
			return
		}
		_ = json.NewEncoder(w).Encode(info)
	})
	return mux
}
