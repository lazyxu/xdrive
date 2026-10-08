package photointelligence

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestUnixSmartAnalyzerContract(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix sockets are not available on Windows")
	}
	socket := filepath.Join(t.TempDir(), "smart.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	info := testSmartAnalyzerInfo()
	server := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if got := r.Header.Get("Authorization"); got != "Bearer secret" {
				t.Fatalf("authorization=%q", got)
			}
			if got := r.Header.Get("X-XDrive-Smart-Protocol"); got != "1" {
				t.Fatalf("protocol=%q", got)
			}
			switch r.URL.Path {
			case "/v1/smart-info":
				_ = json.NewEncoder(w).Encode(info)
			case "/v1/smart-analyze":
				var task SmartAnalysisTask
				if err := json.NewDecoder(r.Body).Decode(&task); err != nil {
					t.Fatal(err)
				}
				if task.PreviewEdge != 1280 ||
					task.InputFingerprint != "media-analysis-test-v1-1280" {
					t.Fatalf("task=%+v", task)
				}
				_ = json.NewEncoder(w).Encode(SmartAnalysisResult{
					Labels: []SmartVisualLabel{
						{Index: 978, Label: "beach", Confidence: 0.8},
					},
					OCRText:     "上海",
					OCRLanguage: "zh-en",
				})
			default:
				http.NotFound(w, r)
			}
		}),
	}
	go func() { _ = server.Serve(listener) }()
	defer server.Close()

	analyzer, err := NewUnixSmartAnalyzer(socket, "secret", time.Second)
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
	result, err := analyzer.Analyze(
		context.Background(),
		SmartAnalysisTask{
			PreviewURL:       "http://server:8080/api/v1/media-analysis-preview/42?ticket=abc",
			PreviewVersion:   1,
			PreviewEdge:      1280,
			InputFingerprint: "media-analysis-test-v1-1280",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Labels) != 1 ||
		result.Labels[0].Label != "beach" ||
		result.OCRText != "上海" {
		t.Fatalf("result=%+v", result)
	}
}

func TestNewUnixSmartAnalyzerRejectsRelativeSocket(t *testing.T) {
	if _, err := NewUnixSmartAnalyzer(
		"relative.sock",
		"",
		time.Second,
	); err == nil {
		t.Fatal("relative Unix socket path was accepted")
	}
}
