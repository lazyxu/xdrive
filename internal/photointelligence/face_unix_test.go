package photointelligence

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestUnixFaceAnalyzerContract(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix sockets are not available on Windows")
	}
	socket := filepath.Join(t.TempDir(), "face.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	info := testFaceAnalyzerInfo()
	server := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if got := r.Header.Get("Authorization"); got != "Bearer secret" {
				t.Fatalf("authorization=%q", got)
			}
			if got := r.Header.Get("X-XDrive-Face-Protocol"); got != "1" {
				t.Fatalf("protocol=%q", got)
			}
			switch r.URL.Path {
			case "/v1/info":
				_ = json.NewEncoder(w).Encode(info)
			case "/v1/analyze":
				if r.Method != http.MethodPost {
					t.Fatalf("method=%s", r.Method)
				}
				if got := r.Header.Get("Content-Type"); got != "application/json" {
					t.Fatalf("content-type=%q", got)
				}
				var task FaceAnalysisTask
				if err := json.NewDecoder(r.Body).Decode(&task); err != nil {
					t.Fatal(err)
				}
				if task.PreviewURL !=
					"http://server:8080/api/v1/media-analysis-preview/42?ticket=abc" ||
					task.PreviewVersion != 1 ||
					task.PreviewEdge != 1280 ||
					task.InputFingerprint != "media-analysis-test-v1-1280" {
					t.Fatalf("task=%+v", task)
				}
				_ = json.NewEncoder(w).Encode(map[string]any{
					"faces": []FaceObservation{
						{
							Box: NormalizedBox{
								X: 0.1, Y: 0.2,
								Width: 0.3, Height: 0.4,
							},
							Landmarks: []NormalizedPoint{
								{X: 0.15, Y: 0.3},
								{X: 0.3, Y: 0.3},
								{X: 0.225, Y: 0.4},
								{X: 0.17, Y: 0.5},
								{X: 0.28, Y: 0.5},
							},
							Confidence: 0.99,
							Embedding:  testEmbedding(info.EmbeddingDimensions),
						},
					},
				})
			default:
				http.NotFound(w, r)
			}
		}),
	}
	go func() {
		_ = server.Serve(listener)
	}()
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()

	analyzer, err := NewUnixFaceAnalyzer(socket, "secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	gotInfo, err := analyzer.Info(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if gotInfo.Name != info.Name ||
		gotInfo.Detector.SHA256 != info.Detector.SHA256 ||
		gotInfo.Embedding.SHA256 != info.Embedding.SHA256 {
		t.Fatalf("info=%+v", gotInfo)
	}
	faces, err := analyzer.Analyze(
		context.Background(),
		FaceAnalysisTask{
			PreviewURL:       "http://server:8080/api/v1/media-analysis-preview/42?ticket=abc",
			PreviewVersion:   1,
			PreviewEdge:      1280,
			InputFingerprint: "media-analysis-test-v1-1280",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(faces) != 1 ||
		faces[0].Confidence != 0.99 ||
		len(faces[0].Embedding) != info.EmbeddingDimensions*4 {
		t.Fatalf("faces=%+v", faces)
	}
}

func TestNewUnixFaceAnalyzerRejectsRelativeSocket(t *testing.T) {
	if _, err := NewUnixFaceAnalyzer(
		"relative.sock",
		"",
		time.Second,
	); err == nil {
		t.Fatal("relative Unix socket path was accepted")
	}
}

func TestUnixFaceAnalyzerRejectsOversizedResponse(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix sockets are not available on Windows")
	}
	socket := filepath.Join(t.TempDir(), "face.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	server := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = io.WriteString(
				w,
				strings.Repeat("x", faceAnalyzerMaxResponseBytes+1),
			)
		}),
	}
	go func() {
		_ = server.Serve(listener)
	}()
	defer server.Close()

	analyzer, err := NewUnixFaceAnalyzer(socket, "", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := analyzer.Info(context.Background()); err == nil {
		t.Fatal("oversized analyzer response was accepted")
	}
}
