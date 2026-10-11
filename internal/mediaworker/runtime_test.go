package mediaworker

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func validFixtureInfo() Info {
	return Info{ProtocolVersion: 1, Ready: true,
		FFmpegVersion:          "ffmpeg version fixture",
		FFprobeVersion:         "ffprobe version fixture",
		TaskExecutionSupported: false}
}

func TestMediaWorkerProtocolAndSocketValidation(t *testing.T) {
	for _, path := range []string{"", "relative.sock", "/tmp/no-suffix", "/tmp/../temp.sock",
		"/tmp/with.sock/"} {
		if ValidateSocket(path) == nil {
			t.Errorf("accepted unsafe socket %q", path)
		}
	}
	if !ValidInfo(validFixtureInfo()) {
		t.Fatal("valid FFmpeg fixture rejected")
	}
	invalid := validFixtureInfo()
	invalid.Ready = false
	if ValidInfo(invalid) {
		t.Fatal("unready worker accepted")
	}
	invalid = validFixtureInfo()
	invalid.TaskExecutionSupported = true
	if ValidInfo(invalid) {
		t.Fatal("unimplemented job support accepted")
	}
	invalid = validFixtureInfo()
	invalid.FFprobeVersion = "not ffprobe"
	if ValidInfo(invalid) {
		t.Fatal("fictitious ffprobe accepted")
	}
	invalid = validFixtureInfo()
	invalid.FFmpegVersion = "ffmpeg version good\nleaked path"
	if ValidInfo(invalid) {
		t.Fatal("multiline executable version accepted")
	}
}

func TestMediaWorkerLiveFFmpegFFprobeExecutables(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell executable fixture requires Unix")
	}
	dir := t.TempDir()
	for _, name := range []string{"ffmpeg", "ffprobe"} {
		script := "#!/bin/sh\n[ \"$1\" = '-version' ] || exit 1\nprintf '" + name + " version fixture\\n'\n"
		if err := os.WriteFile(filepath.Join(dir, name), []byte(script), 0700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", dir)
	info, err := LiveInfo(context.Background())
	if err != nil || !ValidInfo(info) {
		t.Fatalf("real subprocess probe failed: %+v %v", info, err)
	}
	if err := os.Remove(filepath.Join(dir, "ffprobe")); err != nil {
		t.Fatal(err)
	}
	if _, err := LiveInfo(context.Background()); err == nil {
		t.Fatal("missing ffprobe was advertised healthy")
	}
}

func TestMediaWorkerUnixServeHealthAndShutdown(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix socket not required on Windows")
	}
	socket := filepath.Join(t.TempDir(), "media-worker.sock")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	fake := ProbeFunc(func(context.Context) (Info, error) { return validFixtureInfo(), nil })
	finished := make(chan error, 1)
	go func() { finished <- ServeUnix(ctx, socket, fake) }()
	for i := 0; i < 100; i++ {
		if _, err := os.Lstat(socket); err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	mode, err := os.Lstat(socket)
	if err != nil || mode.Mode().Perm() != 0600 {
		t.Fatalf("private socket missing/wrong mode: %v %v", mode, err)
	}
	client, err := NewUnixClient(socket, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	info, err := client.Info(context.Background())
	if err != nil || !ValidInfo(info) {
		t.Fatalf("live worker probe rejected: %+v %v", info, err)
	}
	req, err := http.NewRequest(http.MethodPost, "http://xdrive-media-worker/v1/info", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set(headerName, "1")
	resp, err := client.http.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("task-like POST incorrectly accepted: %d", resp.StatusCode)
	}
	req, _ = http.NewRequest(http.MethodGet, "http://xdrive-media-worker/v1/info", nil)
	resp, err = client.http.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("missing protocol accepted: %d", resp.StatusCode)
	}
	cancel()
	select {
	case err := <-finished:
		if err != nil {
			t.Fatalf("clean cancellation returned error: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("worker failed to stop on cancellation")
	}
	if _, err := os.Lstat(socket); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("stopped worker did not clean up its socket")
	}
}

func TestMediaWorkerSocketNeverOverwritesRegularOrActiveEntry(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix sockets not required on Windows")
	}
	dir := t.TempDir()
	socket := filepath.Join(dir, "worker.sock")
	fake := ProbeFunc(func(context.Context) (Info, error) { return validFixtureInfo(), nil })
	if err := os.WriteFile(socket, []byte("important"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := ServeUnix(context.Background(), socket, fake); err == nil {
		t.Fatal("overwrote regular file")
	}
	content, err := os.ReadFile(socket)
	if err != nil || string(content) != "important" {
		t.Fatal("overwrote existing regular file bytes")
	}
	if err := os.Remove(socket); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(dir, "missing"), socket); err != nil {
		t.Fatal(err)
	}
	if err := ServeUnix(context.Background(), socket, fake); err == nil {
		t.Fatal("overwrote symlink")
	}
	if err := os.Remove(socket); err != nil {
		t.Fatal(err)
	}
	active, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	defer active.Close()
	if err := ServeUnix(context.Background(), socket, fake); err == nil {
		t.Fatal("overwrote active private listener")
	}
}

func TestMediaWorkerUnixClientRejectsFakeHealthAndOversizedOutput(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix sockets not required on Windows")
	}
	socket := filepath.Join(t.TempDir(), "fake.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	response := func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(headerName) != "1" {
			t.Error("protocol version header not sent")
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Query().Get("test") {
		default:
			_, _ = io.WriteString(w, `{"protocol_version":1,"ready":true,"ffmpeg_version":"ffmpeg version mock","ffprobe_version":"fake","task_execution_supported":false}`)
		}
	}
	server := &http.Server{Handler: http.HandlerFunc(response)}
	go func() { _ = server.Serve(listener) }()
	defer server.Close()
	client, err := NewUnixClient(socket, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Info(context.Background()); err == nil {
		t.Fatal("client trusted falsified ffprobe result")
	}
}

func TestMediaWorkerUnixClientRejectsOversizedAndRedirectedProbe(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix sockets not required on Windows")
	}
	for _, mode := range []string{"oversized", "redirect"} {
		t.Run(mode, func(t *testing.T) {
			socket := filepath.Join(t.TempDir(), "bad.sock")
			listener, err := net.Listen("unix", socket)
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if mode == "redirect" {
					http.Redirect(w, r, "http://untrusted.example.org/", http.StatusFound)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, strings.Repeat("x", maxResponse+10))
			})}
			go func() { _ = server.Serve(listener) }()
			defer server.Close()
			client, err := NewUnixClient(socket, time.Second)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := client.Info(context.Background()); err == nil {
				t.Fatal("accepted untrusted worker response")
			}
		})
	}
}
