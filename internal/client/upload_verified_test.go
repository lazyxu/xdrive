package client

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func verifiedTestInit() UploadInit {
	parent := uint64(9)
	return UploadInit{
		ParentID: &parent, Name: "empty.txt", Size: 0,
		SHA256:    hex.EncodeToString(sha256.New().Sum(nil)),
		ResumeKey: "lp2_" + strings.Repeat("a", 64),
	}
}

func TestVerifiedStreamRejectsInvalidPlanBeforeNetwork(t *testing.T) {
	var requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		http.Error(w, "unexpected", http.StatusInternalServerError)
	}))
	defer srv.Close()
	c := New(srv.URL, "token")
	cases := []func(*UploadInit){
		func(p *UploadInit) { p.SHA256 = "" },
		func(p *UploadInit) { p.SHA256 = strings.Repeat("A", 64) },
		func(p *UploadInit) { p.ResumeKey = "" },
		func(p *UploadInit) { p.ConflictPolicy = UploadConflictPolicyKeepBoth },
		func(p *UploadInit) { p.NodeID = p.ParentID },
		func(p *UploadInit) { p.ParentID = nil },
		func(p *UploadInit) { p.Size = -1 },
		func(p *UploadInit) { p.ExpectedRevision = 2 },
	}
	for i, change := range cases {
		init := verifiedTestInit()
		change(&init)
		if _, err := c.UploadStreamResumableVerifiedResult(context.Background(), init, nil, nil); err == nil {
			t.Fatalf("unsafe case %d was accepted", i)
		}
	}
	if requests.Load() != 0 {
		t.Fatalf("invalid plan touched network: %d", requests.Load())
	}
}

func TestVerifiedStreamUsesSharedFinalizeAndRecoversExactResult(t *testing.T) {
	init := verifiedTestInit()
	var alreadyFinalized atomic.Bool
	var initCount, finalCount atomic.Int32
	makeFinal := func() UploadSession {
		return UploadSession{
			ID: "existing", ParentID: init.ParentID, Name: init.Name, Size: 0,
			SHA256: init.SHA256, ResumeKey: init.ResumeKey, Status: "finalized",
			Result: &Node{ID: 12, ParentID: init.ParentID, Name: init.Name, Type: "file", Size: 0, Revision: 1, SHA256: init.SHA256},
		}
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/api/v1/uploads" {
			initCount.Add(1)
			var got UploadInit
			if err := json.NewDecoder(r.Body).Decode(&got); err != nil || got.ResumeKey != init.ResumeKey || got.SHA256 != init.SHA256 {
				t.Errorf("wrong verified init: %+v %v", got, err)
			}
			resp := makeFinal()
			if !alreadyFinalized.Load() {
				resp.Status = "active"
				resp.Result = nil
			}
			_ = json.NewEncoder(w).Encode(resp)
			return
		}
		if r.Method == http.MethodPost && r.URL.Path == "/api/v1/uploads/existing/finalize" {
			finalCount.Add(1)
			_ = json.NewEncoder(w).Encode(makeFinal())
			return
		}
		t.Errorf("unexpected endpoint %s %s", r.Method, r.URL.Path)
		http.NotFound(w, r)
	}))
	defer srv.Close()
	c := New(srv.URL, "token")
	first, err := c.UploadStreamResumableVerifiedResult(context.Background(), init, nil, nil)
	if err != nil || first.Node.ID != 12 || first.SHA256 != init.SHA256 {
		t.Fatalf("first verified finalize: %+v %v", first, err)
	}
	alreadyFinalized.Store(true)
	second, err := c.UploadStreamResumableVerifiedResult(context.Background(), init, nil, nil)
	if err != nil || second.Node.ID != 12 || second.SHA256 != init.SHA256 {
		t.Fatalf("lost ACK recover: %+v %v", second, err)
	}
	if initCount.Load() != 2 || finalCount.Load() != 1 {
		t.Fatalf("new upload after finalized: init=%d final=%d", initCount.Load(), finalCount.Load())
	}
}

func TestVerifiedStreamRejectsStaleOrAlteredFinalizedNode(t *testing.T) {
	init := verifiedTestInit()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(UploadSession{
			ID: "stale", ParentID: init.ParentID, Name: init.Name, Status: "finalized", Size: 0,
			SHA256: init.SHA256,
			Result: &Node{ID: 19, ParentID: init.ParentID, Name: init.Name, Type: "file", Size: 0, SHA256: strings.Repeat("f", 64)},
		})
	}))
	defer srv.Close()
	c := New(srv.URL, "token")
	if _, err := c.UploadStreamResumableVerifiedResult(context.Background(), init, nil, nil); err == nil {
		t.Fatal("stale current Node was accepted as original finalized receipt")
	}
}
