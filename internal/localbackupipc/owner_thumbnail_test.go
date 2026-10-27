package localbackupipc

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func ownerIPCTestPNG(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewNRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestOwnerThumbnailAgentCapabilityAndRevisionAreMandatory(t *testing.T) {
	pngBytes := ownerIPCTestPNG(t)
	thumbnail := OwnerThumbnail{ContentType: "image/png", AlphaState: "opaque", Data: pngBytes}
	hits := 0
	corrupt := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if r.Method != http.MethodGet || r.URL.Path != "/v1/cloud/thumbnail" ||
			r.URL.Query().Get("node_id") != "42" || r.URL.Query().Get("revision") != "7" ||
			r.Header.Get("Authorization") != "Bearer "+strings.Repeat("a", 64) {
			t.Errorf("unapproved private Agent read: %s %s", r.Method, r.URL)
		}
		w.Header().Set("Content-Type", "application/json")
		reply := thumbnail
		if corrupt {
			reply.ContentType = "text/html"
		}
		_ = json.NewEncoder(w).Encode(reply)
	}))
	defer server.Close()
	client := &Client{
		baseURL: server.URL, token: strings.Repeat("a", 64), http: server.Client(),
	}
	if _, err := client.OwnerFileThumbnail(context.Background(), 42, 7); err == nil {
		t.Fatal("Agent without thumbnail capability fetched Server image")
	}
	if hits != 0 {
		t.Fatal("capability failure contacted private Agent")
	}
	client.capabilities = []string{"cloud-thumbnail-read"}
	for _, pair := range [][2]uint64{
		{0, 7}, {42, 0}, {MaxSafeSourceID + 1, 7},
		{42, MaxSafeSourceID + 1},
	} {
		if _, err := client.OwnerFileThumbnail(context.Background(), pair[0], pair[1]); err == nil {
			t.Fatal("invalid Owner selector sent to private Agent")
		}
	}
	if hits != 0 {
		t.Fatal("invalid thumbnail IDs contacted private Agent")
	}
	read, err := client.OwnerFileThumbnail(context.Background(), 42, 7)
	if err != nil || !ValidateOwnerThumbnail(read) || !bytes.Equal(read.Data, pngBytes) {
		t.Fatalf("current Owner thumbnail refused: %+v %v", read, err)
	}
	corrupt = true
	if _, err := client.OwnerFileThumbnail(context.Background(), 42, 7); err == nil {
		t.Fatal("unsafe JPEG/PNG metadata escaped private Agent")
	}
	if hits != 2 {
		t.Fatalf("expected two bounded Agent requests, got %d", hits)
	}
}
