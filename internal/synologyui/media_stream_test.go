package synologyui

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type fakeOwnerNativeStreamReader struct {
	*fakeOwnerFilesReader
	content []byte
	sha     string
	reads   int
	corrupt bool
	cancel  context.CancelFunc
}

func (f *fakeOwnerNativeStreamReader) OwnerFileMediaRange(
	ctx context.Context, nodeID, revision uint64, offset int64, length int,
) (localbackupipc.OwnerMediaRange, error) {
	f.reads++
	if err := ctx.Err(); err != nil {
		return localbackupipc.OwnerMediaRange{}, err
	}
	if nodeID != 42 || revision != 7 || offset < 0 ||
		length < 1 || length > ownerStreamChunkBytes ||
		offset+int64(length) > int64(len(f.content)) {
		return localbackupipc.OwnerMediaRange{}, fmt.Errorf("unexpected original Agent media slice")
	}
	data := append([]byte(nil), f.content[offset:offset+int64(length)]...)
	digest := f.sha
	if f.corrupt && offset >= ownerStreamChunkBytes {
		digest = strings.Repeat("b", 64)
	}
	if f.cancel != nil && offset >= ownerStreamChunkBytes {
		f.cancel()
	}
	return localbackupipc.OwnerMediaRange{
		Offset: offset, Total: int64(len(f.content)),
		Revision: 7, SHA256: digest, Data: data,
	}, nil
}

func TestOwnerNativeRangeParser(t *testing.T) {
	const total int64 = (2 << 20) + 13
	for _, tc := range []struct {
		rangeHeader string
		start       int64
		length      int
		unsat       bool
		bad         bool
	}{
		{"", 0, ownerStreamMaxResponseBytes, false, false},
		{"bytes=0-", 0, ownerStreamMaxResponseBytes, false, false},
		{"bytes=0-1", 0, 2, false, false},
		{"bytes=131072-262143", 131072, 131072, false, false},
		{"bytes=1048576-", 1048576, ownerStreamMaxResponseBytes, false, false},
		{"bytes=-13", total - 13, 13, false, false},
		{"bytes=-999999999", total - ownerStreamMaxResponseBytes, ownerStreamMaxResponseBytes, false, false},
		{"bytes=2097165-", total, 0, true, false},
		{"bytes=0-3,9-12", 0, 0, false, true},
		{"bytes=00-1", 0, 0, false, true},
		{"bytes=2-1", 0, 0, false, true},
		{"bytes=-0", 0, 0, false, true},
	} {
		start, count, unsat, err := parseOwnerStreamRange(tc.rangeHeader, total)
		if (err != nil) != tc.bad ||
			(!tc.bad && (start != tc.start || count != tc.length || unsat != tc.unsat)) {
			t.Fatalf("range %q -> %d %d %v %v; expected %+v",
				tc.rangeHeader, start, count, unsat, err, tc)
		}
	}
}

func TestOwnerNativeMediaMagic(t *testing.T) {
	for _, tc := range []struct {
		mime   string
		header string
	}{
		{"video/mp4", "\x00\x00\x00\x18ftypisom"},
		{"audio/mp4", "\x00\x00\x00\x18ftypM4A "},
		{"video/webm", "\x1a\x45\xdf\xa3"},
		{"audio/mpeg", "ID3\x04"},
		{"audio/ogg", "OggS"},
		{"audio/wav", "RIFF\x04\x00\x00\x00WAVE"},
		{"audio/flac", "fLaC"},
	} {
		if !ownerStreamMediaSignature([]byte(tc.header), tc.mime) ||
			ownerStreamMediaSignature([]byte("<script>alert(1)</script>"), tc.mime) {
			t.Fatalf("unsafe or valid media signature contract changed: %s", tc.mime)
		}
	}
}

func TestDSMNativeOwnerMediaStreamAuthenticatedSeekAndIntegrity(t *testing.T) {
	g, native := newFixture(t)
	originalAuthenticate := g.Authenticate
	bytesOnServer := bytes.Repeat([]byte("0123456789abcdef"), (2<<20)/16+2)
	copy(bytesOnServer, []byte("\x00\x00\x00\x18ftypisom"))
	sum := sha256.Sum256(bytesOnServer)
	reader := &fakeOwnerNativeStreamReader{
		fakeOwnerFilesReader: &fakeOwnerFilesReader{fakeAgent: native},
		content:              bytesOnServer, sha: hex.EncodeToString(sum[:]),
	}
	g.Connect = func(context.Context) (Agent, error) { return reader, nil }
	params := url.Values{
		"op": {"cloud-media-stream"}, "node_id": {"42"}, "revision": {"7"},
		"total":  {strconv.Itoa(len(bytesOnServer))},
		"sha256": {reader.sha}, "mime": {"video/mp4"},
	}
	call := func(method, byteRange, ifRange string, q url.Values, withCookie bool) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "https://nas.example:5001"+DSMCGIPath+"?"+q.Encode(), nil)
		if withCookie {
			req.Header.Set("Cookie", "id=dsm-session")
		}
		if byteRange != "" {
			req.Header.Set("Range", byteRange)
		}
		if ifRange != "" {
			req.Header.Set("If-Range", ifRange)
		}
		w := httptest.NewRecorder()
		CGIHandler(g).ServeHTTP(w, req)
		return w
	}
	if first := call("GET", "bytes=0-", "", params, true); first.Code != http.StatusPartialContent ||
		first.Body.Len() != ownerStreamMaxResponseBytes ||
		first.Header().Get("Content-Range") != fmt.Sprintf("bytes 0-%d/%d",
			ownerStreamMaxResponseBytes-1, len(bytesOnServer)) ||
		first.Header().Get("Content-Type") != "video/mp4" ||
		first.Header().Get("Accept-Ranges") != "bytes" ||
		first.Header().Get("ETag") != "\""+reader.sha+"\"" ||
		!bytes.Equal(first.Body.Bytes(), bytesOnServer[:ownerStreamMaxResponseBytes]) {
		t.Fatalf("bounded browser media Range failed: HTTP %d, body %d", first.Code, first.Body.Len())
	}
	if probe := call("GET", "bytes=0-1", "", params, true); probe.Code != http.StatusPartialContent ||
		!bytes.Equal(probe.Body.Bytes(), bytesOnServer[:2]) {
		t.Fatalf("native two-byte media probe broken: HTTP %d", probe.Code)
	}
	if seek := call("GET", "bytes=786432-", "\""+reader.sha+"\"", params, true); seek.Code != http.StatusPartialContent ||
		!bytes.Equal(seek.Body.Bytes(), bytesOnServer[786432:786432+ownerStreamMaxResponseBytes]) {
		t.Fatalf("browser seek failed: HTTP %d, size %d", seek.Code, seek.Body.Len())
	}
	if suffix := call("GET", "bytes=-32", "", params, true); suffix.Code != http.StatusPartialContent ||
		!bytes.Equal(suffix.Body.Bytes(), bytesOnServer[len(bytesOnServer)-32:]) {
		t.Fatalf("bounded tail seek unavailable: HTTP %d", suffix.Code)
	}
	if head := call("HEAD", "", "", params, true); head.Code != http.StatusOK ||
		head.Body.Len() != 0 ||
		head.Header().Get("Content-Length") != strconv.Itoa(len(bytesOnServer)) {
		t.Fatalf("native media HEAD unavailable: HTTP %d", head.Code)
	}
	readsBefore := reader.reads
	for _, header := range []string{"bytes=00-1", "bytes=1-0", "bytes=0-4,6-7", "bytes=-0", "items=0-2"} {
		if invalid := call("GET", header, "", params, true); invalid.Code == http.StatusPartialContent {
			t.Fatalf("malformed native Range accepted: %q", header)
		}
	}
	if invalid := call("GET", "bytes=0-", "\"old\"", params, true); invalid.Code == http.StatusPartialContent {
		t.Fatal("stale If-Range authorized browser media")
	}
	badParam := func(key, value string) {
		t.Helper()
		q := url.Values{}
		for k, list := range params {
			q[k] = append([]string(nil), list...)
		}
		q.Set(key, value)
		if invalid := call("GET", "bytes=0-", "", q, true); invalid.Code == http.StatusPartialContent {
			t.Fatalf("unsafe Owner stream selector accepted: %s=%s", key, value)
		}
	}
	for _, tc := range [][2]string{
		{"node_id", "042"}, {"revision", "07"}, {"total", "00"},
		{"sha256", "NO_SHA"}, {"mime", "text/html"},
		{"mime", "video/unknown"},
	} {
		badParam(tc[0], tc[1])
	}
	if reader.reads != readsBefore {
		t.Fatal("invalid canonical stream selector reached original Agent")
	}
	// A correctly formatted but false size is detected by the authenticated
	// Agent's Owner content response and must not produce a partial HTTP 206.
	badParam("total", "99999")
	if missing := call("GET", "bytes=0-", "", params, false); missing.Code == http.StatusPartialContent {
		t.Fatal("native stream bypassed DSM session")
	}
	for _, site := range []string{"cross-site", "same-site"} {
		attack := httptest.NewRequest("GET",
			"https://nas.example:5001"+DSMCGIPath+"?"+params.Encode(), nil)
		attack.Header.Set("Cookie", "id=dsm-session")
		attack.Header.Set("Range", "bytes=0-")
		attack.Header.Set("Sec-Fetch-Site", site)
		response := httptest.NewRecorder()
		CGIHandler(g).ServeHTTP(response, attack)
		if response.Code != http.StatusForbidden {
			t.Fatalf("cross-origin media element admitted: %s (HTTP %d)", site, response.Code)
		}
	}
	foreignOrigin := httptest.NewRequest("GET",
		"https://nas.example:5001"+DSMCGIPath+"?"+params.Encode(), nil)
	foreignOrigin.Header.Set("Cookie", "id=dsm-session")
	foreignOrigin.Header.Set("Range", "bytes=0-")
	foreignOrigin.Header.Set("Origin", "https://foreign.example")
	crossOrigin := httptest.NewRecorder()
	CGIHandler(g).ServeHTTP(crossOrigin, foreignOrigin)
	if crossOrigin.Code != http.StatusForbidden {
		t.Fatal("cross-origin Owner video request bypassed Origin check")
	}
	g.Authenticate = func(context.Context) (string, error) { return "another-principal", nil }
	if foreign := call("GET", "bytes=0-", "", params, true); foreign.Code != http.StatusForbidden {
		t.Fatalf("changed DSM principal retained Owner stream: %d", foreign.Code)
	}
	if native.runs != 0 || native.controls != 0 {
		t.Fatal("media read dispatched native backup mutation")
	}

	// The response is atomic: a changed digest on chunk 2 is rejected before
	// an HTTP 206 commits any bytes to the browser's player.
	g.Authenticate = originalAuthenticate
	reader.corrupt = true
	if broken := call("GET", "bytes=0-", "", params, true); broken.Code == http.StatusPartialContent ||
		broken.Body.Len() == ownerStreamMaxResponseBytes {
		t.Fatal("stale Owner fragment leaked as a valid stream")
	}
}

// A closed native video/audio element cancels the underlying HTTP request.
// No partial bytes may be committed while a 1 MiB chunk is still being
// verified by the original Agent's 256 KiB Owner reads.
func TestDSMNativeOwnerMediaCancelBefore206DoesNotLeakPartialContent(t *testing.T) {
	g, native := newFixture(t)
	contents := bytes.Repeat([]byte("0123456789abcdef"), (2<<20)/16+1)
	copy(contents, []byte("\x00\x00\x00\x18ftypisom"))
	digest := sha256.Sum256(contents)
	reader := &fakeOwnerNativeStreamReader{
		fakeOwnerFilesReader: &fakeOwnerFilesReader{fakeAgent: native},
		content:              contents, sha: hex.EncodeToString(digest[:]),
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reader.cancel = cancel
	g.Connect = func(context.Context) (Agent, error) { return reader, nil }
	params := url.Values{
		"op": {"cloud-media-stream"}, "node_id": {"42"}, "revision": {"7"},
		"total":  {strconv.Itoa(len(contents))},
		"sha256": {reader.sha}, "mime": {"video/mp4"},
	}
	request := httptest.NewRequest(http.MethodGet,
		"https://nas.example:5001"+DSMCGIPath+"?"+params.Encode(), nil).WithContext(ctx)
	request.Header.Set("Cookie", "id=dsm-session")
	request.Header.Set("Range", "bytes=0-")
	response := httptest.NewRecorder()
	CGIHandler(g).ServeHTTP(response, request)
	if !errors.Is(ctx.Err(), context.Canceled) {
		t.Fatal("native media cancellation was not propagated")
	}
	if response.Code == http.StatusPartialContent || response.Body.Len() >= ownerStreamMaxResponseBytes {
		t.Fatalf("cancelled media stream committed an incomplete 206: HTTP %d, %d bytes",
			response.Code, response.Body.Len())
	}
	if reader.reads != 3 { // header proof + first slice + cancel on second slice
		t.Fatalf("cancelled player still scheduled Owner data reads: %d", reader.reads)
	}
	if native.runs != 0 || native.controls != 0 {
		t.Fatal("cancelled video playback altered the native backup Runner")
	}
}

func TestDSMNativeHEADAllowedOnlyForOwnerMediaStream(t *testing.T) {
	g, native := newFixture(t)
	for _, route := range []string{
		"/v1/cloud-root",
		"/v1/cloud-text-preview?node_id=42",
		"/v1/cloud-media-range?node_id=42&revision=7&offset=0&length=4",
		"/v1/device-backups",
	} {
		req := httptest.NewRequest(http.MethodHead, "https://nas.example:5001"+route, nil)
		req.Header.Set("Cookie", "id=dsm-session")
		w := httptest.NewRecorder()
		g.ServeHTTP(w, req)
		if w.Code != http.StatusMethodNotAllowed {
			t.Fatalf("DSM HEAD unexpectedly enabled unrelated operation %s: HTTP %d",
				route, w.Code)
		}
	}
	if native.runs != 0 || native.controls != 0 {
		t.Fatal("rejected HEAD unexpectedly mutated Backup Runner")
	}
}

func TestDSMNativeMediaOldAgentHasNoStreamReader(t *testing.T) {
	g, _ := newFixture(t)
	params := url.Values{
		"op": {"cloud-media-stream"}, "node_id": {"42"}, "revision": {"7"},
		"total": {"10"}, "sha256": {strings.Repeat("a", 64)}, "mime": {"audio/mpeg"},
	}
	req := httptest.NewRequest("GET", "https://nas.example:5001"+DSMCGIPath+"?"+params.Encode(), nil)
	req.Header.Set("Cookie", "id=dsm-session")
	req.Header.Set("Range", "bytes=0-")
	w := httptest.NewRecorder()
	CGIHandler(g).ServeHTTP(w, req)
	if w.Code != http.StatusNotImplemented {
		t.Fatalf("old Agent acquired new native media stream: %d", w.Code)
	}
}
