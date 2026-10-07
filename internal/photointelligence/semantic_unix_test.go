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

func TestUnixSemanticAnalyzerContract(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix sockets are not available on Windows")
	}
	socket := filepath.Join(t.TempDir(), "semantic.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	info := testSemanticAnalyzerInfo()
	server := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if got := r.Header.Get("Authorization"); got != "Bearer secret" {
				t.Fatalf("authorization=%q", got)
			}
			if got := r.Header.Get("X-XDrive-Semantic-Protocol"); got != "1" {
				t.Fatalf("protocol=%q", got)
			}
			switch r.URL.Path {
			case "/v1/semantic-info":
				_ = json.NewEncoder(w).Encode(info)
			case "/v1/semantic-image":
				var task SemanticImageTask
				if err := json.NewDecoder(r.Body).Decode(&task); err != nil {
					t.Fatal(err)
				}
				if task.PreviewEdge != 1280 {
					t.Fatalf("task=%+v", task)
				}
				raw := make([]byte, info.EmbeddingDimensions)
				raw[0] = 127
				_ = json.NewEncoder(w).Encode(SemanticEmbedding{
					Embedding:  raw,
					Format:     SemanticEmbeddingFormatI8Norm,
					Dimensions: info.EmbeddingDimensions,
				})
			case "/v1/semantic-text":
				var payload map[string]string
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Fatal(err)
				}
				if strings.TrimSpace(payload["text"]) != "海边的狗" {
					t.Fatalf("payload=%+v", payload)
				}
				raw := make([]byte, info.EmbeddingDimensions)
				raw[1] = 127
				_ = json.NewEncoder(w).Encode(SemanticEmbedding{
					Embedding:  raw,
					Format:     SemanticEmbeddingFormatI8Norm,
					Dimensions: info.EmbeddingDimensions,
				})
			default:
				http.NotFound(w, r)
			}
		}),
	}
	go func() { _ = server.Serve(listener) }()
	defer server.Close()

	analyzer, err := NewUnixSemanticAnalyzer(socket, "secret", time.Second)
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
	image, err := analyzer.EmbedImage(
		context.Background(),
		SemanticImageTask{
			PreviewURL:       "http://server:8080/api/v1/media-analysis-preview/42?ticket=abc",
			PreviewVersion:   1,
			PreviewEdge:      1280,
			InputFingerprint: "media-analysis-test-v1-1280",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	image, err = ValidateSemanticEmbedding(info, image)
	if err != nil {
		t.Fatal(err)
	}
	if len(image.Embedding) != info.EmbeddingDimensions || int8(image.Embedding[0]) != 127 {
		t.Fatalf("image embedding=%+v", image)
	}
	textEmbedding, err := analyzer.EmbedText(context.Background(), "海边的狗")
	if err != nil {
		t.Fatal(err)
	}
	textEmbedding, err = ValidateSemanticEmbedding(info, textEmbedding)
	if err != nil {
		t.Fatal(err)
	}
	if int8(textEmbedding.Embedding[1]) != 127 {
		t.Fatalf("text embedding=%+v", textEmbedding)
	}
}

func TestNewUnixSemanticAnalyzerRejectsRelativeSocket(t *testing.T) {
	if _, err := NewUnixSemanticAnalyzer("relative.sock", "", time.Second); err == nil {
		t.Fatal("relative Unix socket path was accepted")
	}
}
