package photointelligence

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestUnixCreativeAnalyzerContract(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix sockets are not available on Windows")
	}
	socket := filepath.Join(t.TempDir(), "creative.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	info := testCreativeInfo()
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer secret" {
			t.Fatalf("authorization=%q", got)
		}
		if got := r.Header.Get("X-XDrive-Creative-Protocol"); got != "1" {
			t.Fatalf("protocol=%q", got)
		}
		switch r.URL.Path {
		case "/v1/creative-info":
			_ = json.NewEncoder(w).Encode(info)
		case "/v1/creative-generate":
			var task CreativeTask
			if err := json.NewDecoder(r.Body).Decode(&task); err != nil {
				t.Fatal(err)
			}
			if task.Kind != CreativeCapabilityCutout || task.CutoutMode != "object" {
				t.Fatalf("task=%+v", task)
			}
			_ = json.NewEncoder(w).Encode(CreativeResult{
				Data: []byte{1, 2, 3, 4}, MIMEType: "image/png", Width: 80, Height: 60,
			})
		default:
			http.NotFound(w, r)
		}
	})}
	go func() { _ = server.Serve(listener) }()
	defer server.Close()

	analyzer, err := NewUnixCreativeAnalyzer(socket, "secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	gotInfo, err := analyzer.Info(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if gotInfo.Name != info.Name {
		t.Fatalf("info=%+v", gotInfo)
	}

	result, err := analyzer.Generate(context.Background(), CreativeTask{
		Kind:           CreativeCapabilityCutout,
		PreviewURL:     "http://server:8080/api/v1/media-creative-preview/42?ticket=abc",
		PreviewVersion: 1, PreviewEdge: 2048, InputFingerprint: "creative-test",
		CutoutMode: "object",
		Points:     []CreativePoint{{X: 0.5, Y: 0.5, Foreground: true}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.MIMEType != "image/png" || len(result.Data) != 4 {
		t.Fatalf("result=%+v", result)
	}
}

func TestNewUnixCreativeAnalyzerRejectsRelativeSocket(t *testing.T) {
	if _, err := NewUnixCreativeAnalyzer("relative.sock", "", time.Second); err == nil ||
		!strings.Contains(err.Error(), "absolute") {
		t.Fatalf("relative socket error=%v", err)
	}
}
