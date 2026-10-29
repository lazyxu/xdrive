package synologyui

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type testDSMLiveReader struct {
	Agent
	calls int
	value localbackupipc.OwnerLiveMotion
}

func (f *testDSMLiveReader) OwnerLiveMotion(_ context.Context, nodeID, revision uint64) (localbackupipc.OwnerLiveMotion, error) {
	f.calls++
	if nodeID != f.value.NodeID || revision != f.value.Revision {
		return localbackupipc.OwnerLiveMotion{}, context.Canceled
	}
	return f.value, nil
}

func TestDSMLiveMotionRequiresExactCanonicalOwnerSelector(t *testing.T) {
	data := []byte{0, 0, 0, 20, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm', 1, 2, 3, 4}
	sum := sha256.Sum256(data)
	f := &testDSMLiveReader{value: client.OwnerLiveMotion{
		NodeID: 42, Revision: 7, MIMEType: "video/mp4", Size: len(data),
		SHA256: hex.EncodeToString(sum[:]), Data: data,
	}}
	for _, suffix := range []string{"", "node_id=42", "node_id=42&revision=07",
		"node_id=42&revision=7&token=x", "node_id=42&revision=7&revision=8"} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/v1/cloud-live-motion?"+suffix, nil)
		serveOwnerLiveMotion(recorder, request, f)
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("invalid %q => %d", suffix, recorder.Code)
		}
	}
	if f.calls != 0 {
		t.Fatal("invalid selector reached Agent")
	}
	recorder := httptest.NewRecorder()
	serveOwnerLiveMotion(recorder, httptest.NewRequest(http.MethodGet,
		"/v1/cloud-live-motion?node_id=42&revision=7", nil), f)
	if recorder.Code != http.StatusOK || f.calls != 1 {
		t.Fatalf("valid Owner read %d, calls %d", recorder.Code, f.calls)
	}
	var body client.OwnerLiveMotion
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil || !client.ValidateOwnerLiveMotion(body, 42, 7) {
		t.Fatal("DSM corrupted verified Owner motion")
	}
	// Revoke the original revision: a stale Viewer still asking for 7
	// must fail despite possessing the old, correctly hashed media identity.
	recorder = httptest.NewRecorder()
	f.value.Revision = 8
	serveOwnerLiveMotion(recorder, httptest.NewRequest(http.MethodGet,
		"/v1/cloud-live-motion?node_id=42&revision=7", nil), f)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("stale Owner revision served media: HTTP %d", recorder.Code)
	}
}
