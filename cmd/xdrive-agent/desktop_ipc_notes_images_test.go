package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

const ipcNotesImageName = "00000000-0000-4000-8000-000000000000.gif"

type notesImageIPCFixture struct {
	*notesIPCControllerFixture
	imageCalls []string
}

func (f *notesImageIPCFixture) CloudNotesUploadImage(
	_ context.Context, id string, data []byte,
) (client.NotesImageReceipt, error) {
	f.imageCalls = append(f.imageCalls, "upload:"+id)
	sum := sha256.Sum256(data)
	return client.NotesImageReceipt{
		NodeID:       123,
		Filename:     ipcNotesImageName,
		RelativePath: "_assets/" + id + "/" + ipcNotesImageName,
		ContentType:  "image/gif",
		Bytes:        int64(len(data)),
		SHA256:       hex.EncodeToString(sum[:]),
	}, nil
}

func (f *notesImageIPCFixture) CloudNotesImportIOSImage(
	_ context.Context, id string, data []byte,
) (client.NotesImageReceipt, error) {
	f.imageCalls = append(f.imageCalls, "import-ios:"+id)
	sum := sha256.Sum256(data)
	return client.NotesImageReceipt{
		NodeID: 124, Filename: ipcNotesImageName,
		RelativePath: "_assets/" + id + "/" + ipcNotesImageName,
		ContentType: "image/gif", Bytes: int64(len(data)),
		SHA256: hex.EncodeToString(sum[:]),
	}, nil
}

func (f *notesImageIPCFixture) CloudNotesReadImage(
	_ context.Context, id, relative string,
) ([]byte, error) {
	f.imageCalls = append(f.imageCalls, "read:"+id+":"+relative)
	return []byte("GIF89a"), nil
}

func TestDesktopNotesImagesAreOwnerAndLoopbackOnly(t *testing.T) {
	f := &notesImageIPCFixture{notesIPCControllerFixture: &notesIPCControllerFixture{}}
	h := newDesktopIPCHandler(f, "secret", nil)
	asset := "_assets/" + ipcNotesTestID + "/" + ipcNotesImageName
	postBody, _ := json.Marshal(map[string]any{"image": []byte("GIF89a")})
	upload := "/v1/cloud/notes/" + ipcNotesTestID + "/images"
	readURL := upload + "?relative_path=" + url.QueryEscape(asset)
	if res := invokeNotesIPC(h, http.MethodPost, upload, string(postBody), ""); res.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated Notes image write allowed: HTTP %d", res.Code)
	}
	req := httptest.NewRequest(http.MethodGet, readURL, nil)
	req.RemoteAddr = "203.0.113.7:2222"
	req.Header.Set("Authorization", "Bearer secret")
	out := httptest.NewRecorder()
	h.ServeHTTP(out, req)
	if out.Code != http.StatusForbidden || len(f.imageCalls) != 0 {
		t.Fatalf("non-loopback image access was permitted: %d", out.Code)
	}

	reply := invokeNotesIPC(h, http.MethodPost, upload, string(postBody), "secret")
	if reply.Code != http.StatusCreated {
		t.Fatalf("Owner image upload failed: %d %s", reply.Code, reply.Body.String())
	}
	var receipt client.NotesImageReceipt
	if json.Unmarshal(reply.Body.Bytes(), &receipt) != nil ||
		receipt.RelativePath != asset || receipt.Bytes != 6 {
		t.Fatalf("unexpected Notes image receipt: %+v", receipt)
	}

	read := invokeNotesIPC(h, http.MethodGet, readURL, "", "secret")
	if read.Code != http.StatusOK {
		t.Fatalf("Owner image read failed: %d %s", read.Code, read.Body.String())
	}
	var result struct {
		ContentType string `json:"content_type"`
		Bytes       int    `json:"bytes"`
		SHA256      string `json:"sha256"`
		Image       []byte `json:"image"`
	}
	if err := json.Unmarshal(read.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(result.Image)
	if result.ContentType != "image/gif" || result.Bytes != len(result.Image) ||
		!bytes.Equal(result.Image, []byte("GIF89a")) ||
		result.SHA256 != hex.EncodeToString(sum[:]) {
		t.Fatalf("Notes image JSON bytes or hash mismatch: %+v", result)
	}
	if len(f.imageCalls) != 2 {
		t.Fatalf("unexpected Owner image method count: %v", f.imageCalls)
	}

	for _, attempt := range []struct{ method, path, body string }{
		{http.MethodGet, upload + "?relative_path=" + url.QueryEscape("https://evil.invalid/x.gif"), ""},
		{http.MethodGet, upload + "?relative_path=" + url.QueryEscape("../"+asset), ""},
		{http.MethodGet, upload + "?relative_path=" + url.QueryEscape("_assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/"+ipcNotesImageName), ""},
		{http.MethodGet, upload + "?relative_path=" + url.QueryEscape(asset) + "&relative_path=x", ""},
		{http.MethodGet, upload + "?other=value", ""},
		{http.MethodPost, upload + "?other=value", string(postBody)},
		{http.MethodPost, upload, `{"image":"not-base64"}`},
		{http.MethodPost, upload, `{"image":"","unexpected":true}`},
		{http.MethodPost, upload, `{"image":""}`},
	} {
		res := invokeNotesIPC(h, attempt.method, attempt.path, attempt.body, "secret")
		if res.Code < 400 {
			t.Fatalf("unsafe Notes image request admitted: %s %s HTTP %d", attempt.method, attempt.path, res.Code)
		}
	}
	if len(f.imageCalls) != 2 {
		t.Fatalf("invalid image request reached Owner Agent: %v", f.imageCalls)
	}

	backup := newDesktopIPCHandler(f, "secret", nil, true)
	if res := invokeNotesIPC(backup, http.MethodGet, readURL, "", "secret"); res.Code != http.StatusOK {
		t.Fatalf("bounded Backup-only Owner Notes image read unavailable: HTTP %d", res.Code)
	}
	if res := invokeNotesIPC(backup, http.MethodPost, upload, string(postBody), "secret"); res.Code != http.StatusCreated {
		t.Fatalf("bounded Backup-only Owner Notes image upload unavailable: HTTP %d", res.Code)
	}
	for _, tc := range []struct{ method, path string }{
		{http.MethodDelete, upload},
		{http.MethodGet, "/v1/cloud/notes/" + strings.ToUpper(ipcNotesTestID) + "/images"},
		{http.MethodGet, upload + "/other"},
		{http.MethodPost, upload + "/other"},
	} {
		if !fullAgentOnlyRequest(tc.method, tc.path) {
			t.Fatalf("Backup-only admitted unknown binary Notes action: %s %s", tc.method, tc.path)
		}
		if res := invokeNotesIPC(backup, tc.method, tc.path, "", "secret"); res.Code != http.StatusConflict {
			t.Fatalf("Backup-only path guard did not reject %s %s: HTTP %d", tc.method, tc.path, res.Code)
		}
	}
	if len(f.imageCalls) != 4 {
		t.Fatalf("rejected image calls reached owner Agent: %v", f.imageCalls)
	}
}

func TestDesktopNotesImagesCapabilityIsNotImpliedByTextNotes(t *testing.T) {
	textOnly := &notesIPCControllerFixture{}
	full := newDesktopIPCHandler(textOnly, "secret", nil)
	hello := invokeNotesIPC(full, http.MethodGet, "/v1/hello", "", "secret")
	if hello.Code != http.StatusOK {
		t.Fatalf("Notes-only hello failed: %d", hello.Code)
	}
	var result desktopIPCHello
	if json.Unmarshal(hello.Body.Bytes(), &result) != nil {
		t.Fatal("invalid hello JSON")
	}
	for _, cap := range result.Capabilities {
		if cap == "cloud-notes-images" {
			t.Fatal("image IPC advertised without Owner image port")
		}
	}
	withImages := &notesImageIPCFixture{notesIPCControllerFixture: textOnly}
	imageHost := newDesktopIPCHandler(withImages, "secret", nil)
	hello = invokeNotesIPC(imageHost, http.MethodGet, "/v1/hello", "", "secret")
	result = desktopIPCHello{}
	if json.Unmarshal(hello.Body.Bytes(), &result) != nil {
		t.Fatal("invalid image Agent hello")
	}
	found := false
	for _, cap := range result.Capabilities {
		if cap == "cloud-notes-images" {
			found = true
		}
	}
	if !found {
		t.Fatal("Owner image capable Agent omitted image capability")
	}
	backup := newDesktopIPCHandler(withImages, "secret", nil, true)
	hello = invokeNotesIPC(backup, http.MethodGet, "/v1/hello", "", "secret")
	result = desktopIPCHello{}
	if json.Unmarshal(hello.Body.Bytes(), &result) != nil {
		t.Fatal("invalid Backup-only hello")
	}
	if !strings.Contains(strings.Join(result.Capabilities, ","), "cloud-notes-images") {
		t.Fatal("Owner-capable Backup-only Agent omitted verified Notes image capability")
	}
	textBackup := newDesktopIPCHandler(textOnly, "secret", nil, true)
	hello = invokeNotesIPC(textBackup, http.MethodGet, "/v1/hello", "", "secret")
	result = desktopIPCHello{}
	if json.Unmarshal(hello.Body.Bytes(), &result) != nil {
		t.Fatal("invalid text-only Backup-only hello")
	}
	if strings.Contains(strings.Join(result.Capabilities, ","), "cloud-notes-images") {
		t.Fatal("text-only Backup-only Agent falsely advertised binary image support")
	}
}


func TestDesktopNotesIOSArchiveImageImportIsOwnerAndBackupOnlyBounded(t *testing.T) {
	f := &notesImageIPCFixture{notesIPCControllerFixture: &notesIPCControllerFixture{}}
	h := newDesktopIPCHandler(f, "secret", nil)
	path := "/v1/cloud/notes/ios-import/" + ipcNotesTestID + "/images"
	body, _ := json.Marshal(map[string]any{"image": []byte("GIF89a")})

	if res := invokeNotesIPC(h, http.MethodPost, path, string(body), ""); res.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated iOS archive image import allowed: HTTP %d", res.Code)
	}
	res := invokeNotesIPC(h, http.MethodPost, path, string(body), "secret")
	if res.Code != http.StatusCreated {
		t.Fatalf("iOS archive image import failed: %d %s", res.Code, res.Body.String())
	}
	var receipt client.NotesImageReceipt
	if err := json.Unmarshal(res.Body.Bytes(), &receipt); err != nil {
		t.Fatal(err)
	}
	want := "_assets/" + ipcNotesTestID + "/" + ipcNotesImageName
	if receipt.NodeID != 124 || receipt.RelativePath != want || receipt.Bytes != 6 ||
		len(f.imageCalls) != 1 || f.imageCalls[0] != "import-ios:"+ipcNotesTestID {
		t.Fatalf("unexpected immutable iOS image receipt/calls: %+v %v", receipt, f.imageCalls)
	}

	for _, attempt := range []struct{ method, path, body string }{
		{http.MethodGet, path, ""},
		{http.MethodPost, path + "?other=value", string(body)},
		{http.MethodPost, "/v1/cloud/notes/ios-import/" + strings.ToUpper(ipcNotesTestID) + "/images", string(body)},
		{http.MethodPost, "/v1/cloud/notes/ios-import/not-a-note/images", string(body)},
		{http.MethodPost, path, `{"image":"not-base64"}`},
		{http.MethodPost, path, `{"image":"","unexpected":true}`},
	} {
		out := invokeNotesIPC(h, attempt.method, attempt.path, attempt.body, "secret")
		if out.Code < 400 {
			t.Fatalf("unsafe iOS archive image request admitted: %s %s HTTP %d",
				attempt.method, attempt.path, out.Code)
		}
	}
	if len(f.imageCalls) != 1 {
		t.Fatalf("invalid image requests reached Owner controller: %v", f.imageCalls)
	}

	backup := newDesktopIPCHandler(f, "secret", nil, true)
	if fullAgentOnlyRequest(http.MethodPost, path) ||
		!fullAgentOnlyRequest(http.MethodGet, path) ||
		!fullAgentOnlyRequest(http.MethodPut, path) {
		t.Fatal("Backup-only iOS archive image route must admit POST only")
	}
	out := invokeNotesIPC(backup, http.MethodPost, path, string(body), "secret")
	if out.Code != http.StatusCreated {
		t.Fatalf("bounded Backup-only iOS archive image import unavailable: %d %s",
			out.Code, out.Body.String())
	}
	if len(f.imageCalls) != 2 || f.imageCalls[1] != "import-ios:"+ipcNotesTestID {
		t.Fatalf("unexpected Backup-only image import calls: %v", f.imageCalls)
	}
}
