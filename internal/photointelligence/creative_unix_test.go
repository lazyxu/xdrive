package photointelligence

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
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

func TestUnixCreativeFixedCutoutCanaryStrictResponse(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix sockets are not available on Windows")
	}
	socket := filepath.Join(t.TempDir(), "fixed-creative.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	var scenario atomic.Int32
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v1/creative-cutout-canary" ||
			r.URL.RawQuery != "" || r.Header.Get("Authorization") != "Bearer secret" ||
			r.Header.Get("X-XDrive-Creative-Protocol") != "1" {
			http.Error(w, "bad private creative request", http.StatusBadRequest)
			return
		}
		switch scenario.Load() {
		case 0:
			_, _ = w.Write([]byte(`{"cutout_executed":true}`))
		case 1:
			_, _ = w.Write([]byte(`{"cutout_executed":false}`))
		case 2:
			_, _ = w.Write([]byte(`{"cutout_executed":1}`))
		case 3:
			_, _ = w.Write([]byte(`{"cutout_executed":true,"mask":"private"}`))
		case 4:
			_, _ = w.Write([]byte(`{"cutout_executed":true,"cutout_executed":false}`))
		case 5:
			http.NotFound(w, r)
		case 6:
			_, _ = w.Write([]byte(strings.Repeat("x", 512)))
		case 7:
			_, _ = w.Write([]byte(`{"cutout_executed":true}{}`))
		}
	})}
	go func() { _ = server.Serve(listener) }()
	defer server.Close()
	analyzer, err := NewUnixCreativeAnalyzer(socket, "secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	for _, candidate := range []struct {
		name   string
		mode   int32
		want   bool
		legacy bool
	}{
		{"valid", 0, true, false},
		{"model failed", 1, false, false},
		{"non-Boolean", 2, false, false},
		{"leaked mask field", 3, false, false},
		{"duplicate result", 4, false, false},
		{"old model", 5, false, true},
		{"oversize", 6, false, false},
		{"trailing object", 7, false, false},
	} {
		t.Run(candidate.name, func(t *testing.T) {
			scenario.Store(candidate.mode)
			executed, err := analyzer.ProbeSyntheticCutout(context.Background())
			if candidate.legacy {
				if !errors.Is(err, ErrCreativeCutoutCanaryUnavailable) || executed {
					t.Fatalf("older model status=%t err=%v", executed, err)
				}
			} else if candidate.mode == 0 || candidate.mode == 1 {
				if err != nil || executed != candidate.want {
					t.Fatalf("fixed result=%t err=%v", executed, err)
				}
			} else if err == nil || executed {
				t.Fatalf("invalid fixed result accepted: executed=%t err=%v", executed, err)
			}
		})
	}
	legacy, err := NewUnixCreativeAnalyzer(socket, "", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if accepted, err := legacy.ProbeSyntheticCutout(context.Background()); err == nil || accepted {
		t.Fatal("model canary without a configured Bearer token was accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if accepted, err := analyzer.ProbeSyntheticCutout(ctx); err == nil || accepted {
		t.Fatal("canceled Creative canary performed an HTTP request")
	}
}
