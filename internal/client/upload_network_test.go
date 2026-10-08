package client

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type uploadNetworkRoundTripper func(*http.Request) (*http.Response, error)

func (f uploadNetworkRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func uploadNetworkResponse(status int, value any) (*http.Response, error) {
	body, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(body))}, nil
}

type uploadNetworkSamples struct {
	mu     sync.Mutex
	values []int64
}

func (s *uploadNetworkSamples) observe(sent int64) {
	s.mu.Lock()
	s.values = append(s.values, sent)
	s.mu.Unlock()
}

func (s *uploadNetworkSamples) snapshot() []int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]int64(nil), s.values...)
}

func writeNetworkUploadFile(t *testing.T, data []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "network.bin")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestUploadNetworkProgressBeforeFirstChunkCompletes(t *testing.T) {
	data := bytes.Repeat([]byte("x"), 32<<10)
	path := writeNetworkUploadFile(t, data)
	read := make(chan struct{})
	release := make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	t.Cleanup(unblock)
	samples := make(chan int64, 128)
	var logicalMu sync.Mutex
	var logical []int64
	cli := New("http://upload.test", "token")
	cli.HTTP = &http.Client{Transport: uploadNetworkRoundTripper(func(r *http.Request) (*http.Response, error) {
		defer r.Body.Close()
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/uploads":
			var init UploadInit
			if err := json.NewDecoder(r.Body).Decode(&init); err != nil {
				return nil, err
			}
			return uploadNetworkResponse(http.StatusOK, UploadSession{ID: "live", Size: init.Size, ChunkSize: DefaultUploadChunkSize, ChunkCount: 1})
		case r.Method == http.MethodPut:
			if r.ContentLength != int64(len(data)) || r.GetBody == nil {
				return nil, fmt.Errorf("request replay metadata changed: length=%d get_body=%t", r.ContentLength, r.GetBody != nil)
			}
			if _, err := io.CopyN(io.Discard, r.Body, 4096); err != nil {
				return nil, err
			}
			close(read)
			<-release
			if _, err := io.ReadFull(r.Body, make([]byte, len(data)-4096)); err != nil {
				return nil, err
			}
			return uploadNetworkResponse(http.StatusOK, UploadPart{Size: int64(len(data))})
		case strings.HasSuffix(r.URL.Path, "/finalize"):
			return uploadNetworkResponse(http.StatusOK, UploadSession{Status: "finalized", Result: &Node{ID: 1}})
		default:
			return nil, fmt.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	})}
	ctx := WithUploadNetworkProgress(context.Background(), func(sent int64) { samples <- sent })
	done := make(chan error, 1)
	go func() {
		_, err := cli.UploadFileResumableResult(ctx, 1, path, "network.bin", func(done, _ int64) {
			logicalMu.Lock()
			logical = append(logical, done)
			logicalMu.Unlock()
		})
		done <- err
	}()
	select {
	case <-read:
	case err := <-done:
		t.Fatalf("upload ended before body consumption: %v", err)
	case <-time.After(3 * time.Second):
		t.Fatal("transport did not consume the first bytes")
	}
	deadline := time.After(2 * time.Second)
	positive := 0
	for positive == 0 {
		select {
		case sent := <-samples:
			if sent == 0 {
				continue
			}
			if sent != 4096 {
				t.Fatalf("live bytes=%d, want only the 4096 consumed body bytes", sent)
			}
			positive++
		case <-deadline:
			t.Fatal("no network progress while the first chunk response is blocked")
		}
	}
	logicalMu.Lock()
	if len(logical) != 1 || logical[0] != 0 {
		t.Errorf("logical callbacks changed before chunk completion: %v", logical)
	}
	logicalMu.Unlock()
	unblock()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("upload did not finish")
	}
	last := int64(4096)
	for len(samples) > 0 {
		last = <-samples
		if last > 0 {
			positive++
		}
	}
	if last != int64(len(data)) || positive > 3 {
		t.Fatalf("network samples final=%d positive_callbacks=%d, want final=%d and throttled callbacks", last, positive, len(data))
	}
	logicalMu.Lock()
	defer logicalMu.Unlock()
	if fmt.Sprint(logical) != fmt.Sprint([]int64{0, int64(len(data)), int64(len(data))}) {
		t.Fatalf("logical progress frequency changed: %v", logical)
	}
}

func TestUploadNetworkProgressExcludesReuseAndCountsRetries(t *testing.T) {
	for _, partial := range []bool{false, true} {
		t.Run(fmt.Sprintf("partial_failure_%t", partial), func(t *testing.T) {
			data := bytes.Repeat([]byte("r"), int(DefaultUploadChunkSize)+6)
			path := writeNetworkUploadFile(t, data)
			var samples uploadNetworkSamples
			attempts := 0
			cli := New("http://upload.test", "token")
			cli.HTTP = &http.Client{Transport: uploadNetworkRoundTripper(func(r *http.Request) (*http.Response, error) {
				defer r.Body.Close()
				switch {
				case r.URL.Path == "/api/v1/uploads":
					var init UploadInit
					if err := json.NewDecoder(r.Body).Decode(&init); err != nil {
						return nil, err
					}
					return uploadNetworkResponse(http.StatusOK, UploadSession{ID: "resume", Size: init.Size, ChunkSize: DefaultUploadChunkSize, ChunkCount: 2,
						Received: []UploadPart{{Index: 0, Size: DefaultUploadChunkSize, SHA256: init.ChunkSHA256[0], Reused: true}}})
				case r.Method == http.MethodPut:
					if !strings.HasSuffix(r.URL.Path, "/chunks/1") {
						return nil, fmt.Errorf("reused chunk was sent: %s", r.URL.Path)
					}
					attempts++
					if attempts == 1 && partial {
						if _, err := io.CopyN(io.Discard, r.Body, 3); err != nil {
							return nil, err
						}
						return nil, io.ErrUnexpectedEOF
					}
					if _, err := io.Copy(io.Discard, r.Body); err != nil {
						return nil, err
					}
					if attempts == 1 {
						return uploadNetworkResponse(http.StatusInternalServerError, map[string]string{"error": "retry"})
					}
					return uploadNetworkResponse(http.StatusOK, UploadPart{Index: 1, Size: 6})
				case strings.HasSuffix(r.URL.Path, "/finalize"):
					return uploadNetworkResponse(http.StatusOK, UploadSession{Status: "finalized", Result: &Node{ID: 1}})
				default:
					return nil, fmt.Errorf("unexpected request %s", r.URL.Path)
				}
			})}
			ctx := WithUploadNetworkProgress(context.Background(), samples.observe)
			result, err := cli.UploadFileResumableResult(ctx, 1, path, "network.bin", nil)
			if err != nil {
				t.Fatal(err)
			}
			want := int64(12)
			if partial {
				want = 9
			}
			got := samples.snapshot()
			if len(got) == 0 || got[len(got)-1] != want {
				t.Fatalf("network samples=%v, want cumulative %d (reuse excluded, retry included)", got, want)
			}
			if attempts != 2 || result.TransferredBytes != 6 {
				t.Fatalf("logical result changed: attempts=%d transferred_bytes=%d", attempts, result.TransferredBytes)
			}
		})
	}
}

func TestUploadNetworkProgressInstantReuseSendsNoPayload(t *testing.T) {
	var samples uploadNetworkSamples
	cli := New("http://upload.test", "token")
	cli.HTTP = &http.Client{Transport: uploadNetworkRoundTripper(func(r *http.Request) (*http.Response, error) {
		defer r.Body.Close()
		if r.URL.Path != "/api/v1/uploads" {
			return nil, fmt.Errorf("unexpected request %s", r.URL.Path)
		}
		_, _ = io.Copy(io.Discard, r.Body)
		return uploadNetworkResponse(http.StatusOK, UploadSession{Status: "finalized", Result: &Node{ID: 1}})
	})}
	ctx := WithUploadNetworkProgress(context.Background(), samples.observe)
	result, err := cli.UploadFileResumableResult(ctx, 1, writeNetworkUploadFile(t, bytes.Repeat([]byte("h"), 10000)), "reused.bin", nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.TransferredBytes != 0 || fmt.Sprint(samples.snapshot()) != "[0]" {
		t.Fatalf("hashing/reuse counted as network: result=%+v samples=%v", result, samples.snapshot())
	}
}

func TestUploadNetworkProgressStreamExcludesReadingReusedSource(t *testing.T) {
	data := []byte("abcdEFGHijkl")
	sum := sha256.Sum256(data[4:8])
	var samples uploadNetworkSamples
	cli := New("http://upload.test", "token")
	cli.HTTP = &http.Client{Transport: uploadNetworkRoundTripper(func(r *http.Request) (*http.Response, error) {
		defer r.Body.Close()
		switch {
		case r.URL.Path == "/api/v1/uploads":
			_, _ = io.Copy(io.Discard, r.Body)
			return uploadNetworkResponse(http.StatusOK, UploadSession{ID: "stream", Size: 12, ChunkSize: 4, ChunkCount: 3,
				Received: []UploadPart{{Index: 1, Size: 4, SHA256: hex.EncodeToString(sum[:]), Reused: true}}})
		case r.Method == http.MethodPut:
			body, err := io.ReadAll(r.Body)
			if err != nil {
				return nil, err
			}
			return uploadNetworkResponse(http.StatusOK, UploadPart{Size: int64(len(body))})
		case strings.HasSuffix(r.URL.Path, "/finalize"):
			return uploadNetworkResponse(http.StatusOK, UploadSession{Status: "finalized", Result: &Node{ID: 1}})
		default:
			return nil, fmt.Errorf("unexpected request %s", r.URL.Path)
		}
	})}
	ctx := WithUploadNetworkProgress(context.Background(), samples.observe)
	result, err := cli.UploadStreamResumableResult(ctx, 1, "stream.bin", 12, "", func(_ context.Context, offset int64) (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(data[offset:])), nil
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	got := samples.snapshot()
	if result.TransferredBytes != 8 || len(got) == 0 || got[len(got)-1] != 8 {
		t.Fatalf("source reads leaked into network bytes: result=%+v samples=%v", result, got)
	}
}

func TestUploadNetworkProgressPreservesRequestReplay(t *testing.T) {
	var samples uploadNetworkSamples
	cli := New("http://upload.test", "token")
	cli.HTTP = &http.Client{Transport: uploadNetworkRoundTripper(func(r *http.Request) (*http.Response, error) {
		defer r.Body.Close()
		if r.ContentLength != 6 || r.GetBody == nil || r.Header.Get("X-Chunk-SHA256") != "hash" {
			return nil, fmt.Errorf("request metadata changed")
		}
		if _, err := io.CopyN(io.Discard, r.Body, 2); err != nil {
			return nil, err
		}
		replay, err := r.GetBody()
		if err != nil {
			return nil, err
		}
		defer replay.Close()
		body, err := io.ReadAll(replay)
		if err != nil || string(body) != "abcdef" {
			return nil, fmt.Errorf("replay body=%q err=%v", body, err)
		}
		return uploadNetworkResponse(http.StatusOK, UploadPart{Size: 6})
	})}
	ctx := WithUploadNetworkProgress(context.Background(), samples.observe)
	if _, err := cli.PutUploadChunk(ctx, "replay", 0, "hash", bytes.NewReader([]byte("abcdef"))); err != nil {
		t.Fatal(err)
	}
	got := samples.snapshot()
	if len(got) == 0 || got[len(got)-1] != 8 {
		t.Fatalf("replayed body bytes missing: %v", got)
	}
}

type partialUploadBody struct{ closes int }

func (r *partialUploadBody) Read(p []byte) (int, error) {
	return copy(p, "xy"), io.ErrUnexpectedEOF
}

func (r *partialUploadBody) Close() error {
	r.closes++
	return nil
}

func TestUploadNetworkProgressCountsPartialReadAndPreservesClose(t *testing.T) {
	var samples uploadNetworkSamples
	body := &partialUploadBody{}
	cli := New("http://upload.test", "token")
	cli.HTTP = &http.Client{Transport: uploadNetworkRoundTripper(func(r *http.Request) (*http.Response, error) {
		defer r.Body.Close()
		_, err := io.ReadAll(r.Body)
		return nil, err
	})}
	ctx := WithUploadNetworkProgress(context.Background(), samples.observe)
	_, err := cli.PutUploadChunk(ctx, "partial", 0, "hash", body)
	if !errors.Is(err, io.ErrUnexpectedEOF) || body.closes != 1 {
		t.Fatalf("body semantics changed: error=%v closes=%d", err, body.closes)
	}
	got := samples.snapshot()
	if len(got) == 0 || got[len(got)-1] != 2 {
		t.Fatalf("successful bytes from partial read missing: %v", got)
	}
}
