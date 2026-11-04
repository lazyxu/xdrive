package synologyui

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

const dsmNotesImageFixtureName = "00000000-0000-4000-8000-000000000000.gif"

type dsmNotesImagesFixture struct {
	*dsmNotesFixture
	imageEnabled bool
	uploads      int
	reads        int
}

func (f *dsmNotesImagesFixture) OwnerNotesImagesAvailable() bool { return f.imageEnabled }
func (f *dsmNotesImagesFixture) OwnerNotesUploadImage(
	_ context.Context, id string, data []byte,
) (client.NotesImageReceipt, error) {
	f.uploads++
	if id != dsmNotesFixtureID || !bytes.Equal(data, []byte("GIF89a")) {
		return client.NotesImageReceipt{}, errors.New("invalid uploaded Owner Note image")
	}
	sum := sha256.Sum256(data)
	return client.NotesImageReceipt{
		NodeID:       123,
		Filename:     dsmNotesImageFixtureName,
		RelativePath: "_assets/" + id + "/" + dsmNotesImageFixtureName,
		ContentType:  "image/gif",
		Bytes:        int64(len(data)),
		SHA256:       hex.EncodeToString(sum[:]),
	}, nil
}

func (f *dsmNotesImagesFixture) OwnerNotesReadImage(
	_ context.Context, id, path string,
) (localbackupipc.OwnerNotesImageData, error) {
	f.reads++
	if id != dsmNotesFixtureID ||
		path != "_assets/"+id+"/"+dsmNotesImageFixtureName {
		return localbackupipc.OwnerNotesImageData{}, errors.New("cross-Owner Notes path")
	}
	data := []byte("GIF89a")
	sum := sha256.Sum256(data)
	return localbackupipc.OwnerNotesImageData{
		ContentType: "image/gif", Bytes: int64(len(data)),
		SHA256: hex.EncodeToString(sum[:]), Image: data,
	}, nil
}

func TestDSMNotesImageCGIRequiresExactOwnerCSRFAndPaths(t *testing.T) {
	g, base := newFixture(t)
	f := &dsmNotesImagesFixture{
		dsmNotesFixture: &dsmNotesFixture{fakeAgent: base, owner: "alice", enabled: true},
		imageEnabled:    true,
	}
	g.Connect = func(context.Context) (Agent, error) { return f, nil }
	handler := CGIHandler(g)
	_, key, err := loadAuthority(g.ConfigDir)
	if err != nil {
		t.Fatal(err)
	}
	scope := dsmOwnerScope(key, "dsmadmin", "id=dsm-session",
		"nas.example:5001", "https://server.example", "alice")
	csrf := getCSRF(t, g)
	asset := "_assets/" + dsmNotesFixtureID + "/" + dsmNotesImageFixtureName
	check := func(method, op, query, body, token string, want int) {
		t.Helper()
		r := dsmNotesRequest(handler, method, op, query, body, token)
		if r.Code != want {
			t.Fatalf("%s %s expected HTTP %d, got %d: %s",
				method, op, want, r.Code, r.Body.String())
		}
	}
	check(http.MethodGet, "cloud-notes-image-capability", "", "", "", 200)
	body, err := json.Marshal(map[string]any{
		"owner_scope": scope, "id": dsmNotesFixtureID, "image": []byte("GIF89a"),
	})
	if err != nil {
		t.Fatal(err)
	}
	check(http.MethodPost, "cloud-notes-image-upload", "", string(body), csrf, 200)
	read := dsmNotesRequest(handler, http.MethodGet, "cloud-notes-image-read",
		"id="+dsmNotesFixtureID+"&relative_path="+url.QueryEscape(asset), "", "")
	if read.Code != 200 {
		t.Fatalf("Owner Notes image read: %d %s", read.Code, read.Body.String())
	}
	var result localbackupipc.OwnerNotesImageData
	if json.Unmarshal(read.Body.Bytes(), &result) != nil ||
		!bytes.Equal(result.Image, []byte("GIF89a")) {
		t.Fatalf("Owner Notes image bytes lost: %+v", result)
	}
	if f.uploads != 1 || f.reads != 1 {
		t.Fatalf("unexpected Owner Notes image RPC counts: %d %d", f.uploads, f.reads)
	}

	check(http.MethodPost, "cloud-notes-image-upload", "", string(body), "", 403)
	check(http.MethodGet, "cloud-notes-image-upload", "", "", "", 405)
	check(http.MethodPost, "cloud-notes-image-read", "", "", csrf, 405)
	check(http.MethodGet, "cloud-notes-image-read",
		"id="+dsmNotesFixtureID+"&relative_path="+url.QueryEscape("../"+asset), "", "", 400)
	check(http.MethodGet, "cloud-notes-image-read",
		"id="+dsmNotesFixtureID+"&relative_path="+url.QueryEscape("https://evil.example/img.gif"), "", "", 400)
	check(http.MethodGet, "cloud-notes-image-read",
		"id="+dsmNotesFixtureID+"&id="+dsmNotesFixtureID+"&relative_path="+url.QueryEscape(asset), "", "", 400)
	check(http.MethodGet, "cloud-notes-image-arbitrary", "", "", "", 404)

	foreign := strings.Repeat("0", 64)
	crossScope, _ := json.Marshal(map[string]any{
		"owner_scope": foreign, "id": dsmNotesFixtureID, "image": []byte("GIF89a"),
	})
	check(http.MethodPost, "cloud-notes-image-upload", "", string(crossScope), csrf, 409)
	check(http.MethodPost, "cloud-notes-image-upload", "",
		`{"owner_scope":"`+scope+`","id":"`+dsmNotesFixtureID+`","image":"R0lGODlh","image":"R0lGODlh"}`,
		csrf, 400)
	check(http.MethodPost, "cloud-notes-image-upload", "",
		`{"owner_scope":"`+scope+`","id":"`+dsmNotesFixtureID+`","image":""}`,
		csrf, 400)
	if f.uploads != 1 || f.reads != 1 {
		t.Fatalf("untrusted Notes image request reached Agent: %d %d", f.uploads, f.reads)
	}

	f.owner = "bob"
	check(http.MethodPost, "cloud-notes-image-upload", "", string(body), csrf, 409)
	f.owner = "alice"
	f.imageEnabled = false
	check(http.MethodGet, "cloud-notes-image-capability", "", "", "", 501)
	if f.uploads != 1 || f.reads != 1 {
		t.Fatalf("Agent without image capability performed RPC: %d %d", f.uploads, f.reads)
	}
}

func TestDSMNotesImageCGIFailsClosedOnLargeAndMalformedBody(t *testing.T) {
	for _, body := range []string{
		`{"owner_scope":"` + strings.Repeat("a", 64) + `","id":"` + dsmNotesFixtureID + `","image":"?"}`,
		`{"owner_scope":"` + strings.Repeat("a", 64) + `","id":"` + dsmNotesFixtureID + `","image":null}`,
		`{"owner_scope":"` + strings.Repeat("a", 64) + `","id":"` + dsmNotesFixtureID + `","image":"R0lGODlh","extra":true}`,
	} {
		req := httptest.NewRequest(http.MethodPost, "/v1/cloud-notes-image-upload",
			strings.NewReader(body))
		if _, err := parseDSMNotesImageMutation(req); err == nil {
			t.Fatalf("invalid Notes image JSON unexpectedly admitted")
		}
	}
}
