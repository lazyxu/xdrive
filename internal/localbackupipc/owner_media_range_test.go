package localbackupipc

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestOwnerMediaRangeProjectionAndAgentCapability(t *testing.T) {
	good := OwnerMediaRange{
		Offset: 4, Total: 10, Revision: 7,
		SHA256: strings.Repeat("a", 64), Data: []byte("4567"),
	}
	if !ValidateOwnerMediaRange(good, 4, 4, 7) {
		t.Fatal("valid immutable slice rejected")
	}
	for _, changed := range []func(*OwnerMediaRange){
		func(x *OwnerMediaRange) { x.Offset = 0 },
		func(x *OwnerMediaRange) { x.Total = 4 },
		func(x *OwnerMediaRange) { x.Revision = 8 },
		func(x *OwnerMediaRange) { x.SHA256 = strings.Repeat("Z", 64) },
		func(x *OwnerMediaRange) { x.SHA256 = "secret" },
		func(x *OwnerMediaRange) { x.Data = nil },
		func(x *OwnerMediaRange) { x.Data = []byte("45678") },
		func(x *OwnerMediaRange) { x.Data = []byte("45") },
	} {
		value := good
		changed(&value)
		if ValidateOwnerMediaRange(value, 4, 4, 7) {
			t.Fatal("invalid Owner media slice was accepted")
		}
	}
	hits := 0
	badData := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if r.Method != http.MethodGet || r.URL.Path != "/v1/cloud/media-range" ||
			r.Header.Get("Authorization") != "Bearer "+strings.Repeat("a", 64) ||
			r.URL.Query().Get("node_id") != "42" || r.URL.Query().Get("revision") != "7" ||
			r.URL.Query().Get("offset") != "4" || r.URL.Query().Get("length") != "4" {
			t.Errorf("unexpected owning Agent range selector or token: %s %s", r.Method, r.URL)
		}
		w.Header().Set("Content-Type", "application/json")
		response := good
		if badData {
			response.Offset = 3
		}
		_ = json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()
	ipc := &Client{baseURL: server.URL, token: strings.Repeat("a", 64), http: server.Client()}
	if _, err := ipc.OwnerFileMediaRange(context.Background(), 42, 7, 4, 4); err == nil {
		t.Fatal("Agent without capability read media")
	}
	if hits != 0 {
		t.Fatal("capability missing yet Agent contacted")
	}
	ipc.capabilities = []string{"cloud-media-range-read"}
	for _, bad := range []struct {
		id, revision uint64
		offset       int64
		length       int
	}{
		{0, 7, 4, 4}, {42, 0, 4, 4}, {MaxSafeSourceID + 1, 7, 4, 4},
		{42, 7, -1, 4}, {42, 7, 0, 0}, {42, 7, 0, client.OwnerMediaRangeMaxBytes + 1},
	} {
		if _, err := ipc.OwnerFileMediaRange(context.Background(), bad.id, bad.revision, bad.offset, bad.length); err == nil {
			t.Fatal("invalid Owner range selector accepted")
		}
	}
	if hits != 0 {
		t.Fatal("bad Owner range selector reached Agent")
	}
	actual, err := ipc.OwnerFileMediaRange(context.Background(), 42, 7, 4, 4)
	if err != nil || string(actual.Data) != "4567" || actual.SHA256 != good.SHA256 {
		t.Fatalf("bounded Owner media range read failed: %+v %v", actual, err)
	}
	badData = true
	if _, err := ipc.OwnerFileMediaRange(context.Background(), 42, 7, 4, 4); err == nil {
		t.Fatal("modified media range bypassed validation")
	}
	if hits != 2 {
		t.Fatalf("bad IPC range request count %d", hits)
	}
}
