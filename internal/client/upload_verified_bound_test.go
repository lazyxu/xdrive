package client

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestVerifiedStreamBindOccursBeforeBytesAndFinalize(t *testing.T) {
	data := []byte("x")
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])
	parent := uint64(17)
	id := uuid.NewString()
	init := UploadInit{ParentID: &parent, Name: "first.txt", Size: int64(len(data)),
		SHA256: hash, ResumeKey: "lp2_" + strings.Repeat("a", 64)}
	var mu sync.Mutex
	events := make([]string, 0, 4)
	emit := func(v string) { mu.Lock(); events = append(events, v); mu.Unlock() }
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/uploads":
			var received UploadInit
			if err := json.NewDecoder(r.Body).Decode(&received); err != nil ||
				received.ResumeKey != init.ResumeKey || received.SHA256 != hash {
				t.Errorf("incorrect common upload init: %+v %v", received, err)
			}
			emit("start")
			_ = json.NewEncoder(w).Encode(UploadSession{
				ID: id, Status: "active", Size: init.Size, ChunkSize: DefaultUploadChunkSize,
				ChunkCount: 1, SHA256: hash, ResumeKey: init.ResumeKey,
				ExpiresAt: time.Now().Add(time.Hour),
			})
		case r.Method == http.MethodPut && r.URL.Path == "/api/v1/uploads/"+id+"/chunks/0":
			body, err := io.ReadAll(r.Body)
			if err != nil || string(body) != string(data) ||
				r.Header.Get("X-Chunk-SHA256") != hash {
				t.Errorf("unexpected chunk: %q err=%v", body, err)
			}
			emit("chunk")
			_ = json.NewEncoder(w).Encode(UploadPart{Index: 0, Size: 1, SHA256: hash})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/uploads/"+id+"/finalize":
			emit("finalize")
			_ = json.NewEncoder(w).Encode(UploadSession{
				ID: id, Status: "finalized", SHA256: hash,
				Result: &Node{ID: 88, ParentID: &parent, Name: init.Name,
					Type: "file", Size: 1, Revision: 1, SHA256: hash},
			})
		default:
			t.Errorf("unexpected method/path %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	api := New(srv.URL, "token")
	open := func(_ context.Context, offset int64) (io.ReadCloser, error) {
		if offset != 0 {
			return nil, errors.New("bad source offset")
		}
		emit("open")
		return io.NopCloser(strings.NewReader("x")), nil
	}
	out, err := api.UploadStreamResumableVerifiedBoundResult(context.Background(),
		init, open, func(_ context.Context, session UploadSession) error {
			if session.ID != id || session.Status != "active" {
				t.Fatalf("gate received wrong original session: %+v", session)
			}
			emit("bind")
			return nil
		}, nil)
	if err != nil || out.Node.ID != 88 || out.SHA256 != hash {
		t.Fatalf("verified bound upload: %+v err=%v", out, err)
	}
	mu.Lock()
	defer mu.Unlock()
	if strings.Join(events, ",") != "start,bind,open,chunk,finalize" {
		t.Fatalf("not one common upload with pre-finalize bind: %v", events)
	}
}

func TestVerifiedStreamDeniedBindSendsNoChunkOrFinalize(t *testing.T) {
	init := verifiedTestInit()
	sessionID := uuid.NewString()
	var mu sync.Mutex
	events := make([]string, 0, 4)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		events = append(events, r.URL.Path)
		mu.Unlock()
		if r.Method == http.MethodPost && r.URL.Path == "/api/v1/uploads" {
			_ = json.NewEncoder(w).Encode(UploadSession{ID: sessionID,
				Status: "active", ChunkSize: DefaultUploadChunkSize, Size: 0})
			return
		}
		t.Errorf("unauthorized local Push sent %s after denied binding", r.URL.Path)
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()
	api := New(srv.URL, "token")
	_, err := api.UploadStreamResumableVerifiedBoundResult(context.Background(),
		init, nil, func(_ context.Context, s UploadSession) error {
			if s.ID != sessionID {
				t.Fatal("unexpected session")
			}
			return errors.New("owning Source was revoked")
		}, nil)
	if err == nil {
		t.Fatal("unbound common upload accepted")
	}
	mu.Lock()
	defer mu.Unlock()
	if len(events) != 1 || events[0] != "/api/v1/uploads" {
		t.Fatalf("bytes/finalize sent without bind: %v", events)
	}
}

func TestVerifiedStreamRejectsAlreadyFinalizedGenericSessionBeforeBinding(t *testing.T) {
	init := verifiedTestInit()
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/api/v1/uploads" {
			t.Fatal("unexpected endpoint")
		}
		_ = json.NewEncoder(w).Encode(UploadSession{ID: uuid.NewString(),
			Status: "finalized", Result: &Node{ID: 123, Type: "file", SHA256: init.SHA256}})
	}))
	defer srv.Close()
	api := New(srv.URL, "token")
	gated := false
	_, err := api.UploadStreamResumableVerifiedBoundResult(context.Background(), init, nil,
		func(context.Context, UploadSession) error { gated = true; return nil }, nil)
	if err == nil || gated || calls.Load() != 1 {
		t.Fatalf("generic finalized Node was treated as original operation receipt, gate=%v calls=%d err=%v",
			gated, calls.Load(), err)
	}
}
