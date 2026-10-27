package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

// PWA P1Q: real TCP Gin/PostgreSQL/LocalCAS, two independent Owners and
// production file-preview tickets used by the routed Web/PWA Viewer.
// This test verifies NEW requests after a session revocation; it does not
// claim to interrupt a previously admitted HTTP Range or emulate iOS Safari.
func TestPWAViewerOriginalPreviewOwnerSwitchRevocationRealHTTP(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL integration database required")
	}
	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{}); err != nil {
		t.Fatal(err)
	}
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{DB: db, Store: local, Auth: auth.New("pwa-viewer-original-owner-revoke", time.Hour)}
	httpServer := httptest.NewServer(server.Router())
	defer httpServer.Close()
	client := &http.Client{Timeout: 12 * time.Second}

	alice := meta.User{Username: "pwa-viewer-owner-a", PasswordHash: "fixture-only",
		Role: meta.UserRoleUser, SessionVersion: 1}
	bob := meta.User{Username: "pwa-viewer-owner-b", PasswordHash: "fixture-only",
		Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&alice).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&bob).Error; err != nil {
		t.Fatal(err)
	}
	oldA, err := server.Auth.Issue(alice.ID, alice.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	tokenB, err := server.Auth.Issue(bob.ID, bob.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}

	makeJPEG := func(c color.RGBA) []byte {
		t.Helper()
		img := image.NewRGBA(image.Rect(0, 0, 16, 16))
		for y := 0; y < 16; y++ {
			for x := 0; x < 16; x++ {
				img.SetRGBA(x, y, color.RGBA{R: c.R + uint8(x), G: c.G + uint8(y), B: c.B, A: 255})
			}
		}
		var out bytes.Buffer
		if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: 80}); err != nil {
			t.Fatal(err)
		}
		return out.Bytes()
	}
	movie, err := base64.StdEncoding.DecodeString(galleryFirstVisibleVideoMP4Base64)
	if err != nil || len(movie) < 1000 || !bytes.Contains(movie[:min(len(movie), 128)], []byte("ftyp")) {
		t.Fatal("validated real H264 original fixture unavailable")
	}
	makeNode := func(owner uint64, name string, payload []byte) uint64 {
		t.Helper()
		digest := fmt.Sprintf("%x", sha256.Sum256(payload))
		key, err := storage.ContentAddressedKey(digest)
		if err != nil {
			t.Fatal(err)
		}
		if size, err := local.Put(t.Context(), key, bytes.NewReader(payload)); err != nil ||
			size != int64(len(payload)) {
			t.Fatal("isolated physical CAS source could not be written")
		}
		node := meta.Node{OwnerID: owner, Name: name, Type: meta.NodeTypeFile, Revision: 1}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.File{NodeID: node.ID, Size: int64(len(payload)),
			StorageKey: key, SHA256: digest}).Error; err != nil {
			t.Fatal(err)
		}
		return node.ID
	}
	stillA := makeJPEG(color.RGBA{R: 24, G: 48, B: 72, A: 255})
	stillB := makeJPEG(color.RGBA{R: 91, G: 16, B: 33, A: 255})
	aJPG := makeNode(alice.ID, "a-original.jpg", stillA)
	aMP4 := makeNode(alice.ID, "a-original.mp4", movie)
	bJPG := makeNode(bob.ID, "b-original.jpg", stillB)
	if aJPG == aMP4 || aJPG == bJPG || aMP4 == bJPG {
		t.Fatal("Owner physical CAS nodes are not independently identified")
	}

	type httpResult struct {
		code int
		body []byte
		head http.Header
	}
	doHTTP := func(method, route, bearer, byteRange string) httpResult {
		t.Helper()
		req, err := http.NewRequestWithContext(t.Context(), method, httpServer.URL+route, nil)
		if err != nil {
			t.Fatal("invalid isolated HTTP path")
		}
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		if byteRange != "" {
			req.Header.Set("Range", byteRange)
		}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("isolated preview HTTP request failed: %T", err)
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
		if err != nil {
			t.Fatal("isolated preview HTTP body read failed")
		}
		return httpResult{code: resp.StatusCode, body: body, head: resp.Header.Clone()}
	}
	issue := func(token string, nodeID uint64, want int) string {
		t.Helper()
		res := doHTTP(http.MethodPost,
			"/api/v1/files/"+strconv.FormatUint(nodeID, 10)+"/preview-ticket", token, "")
		if res.code != want {
			t.Fatalf("Owner preview ticket admission status=%d expected=%d", res.code, want)
		}
		if want != http.StatusOK {
			return ""
		}
		var ticket filePreviewTicketDTO
		if err := json.Unmarshal(res.body, &ticket); err != nil ||
			!strings.HasPrefix(ticket.URL, "/api/v1/file-preview/"+
				strconv.FormatUint(nodeID, 10)+"?ticket=") ||
			ticket.ExpiresAt.Before(time.Now()) {
			t.Fatal("Owner preview ticket missing legitimate signed URL")
		}
		return ticket.URL // test-only bearer: never put into logs or CI artifacts
	}
	readRange := func(route, mime string, source []byte) {
		t.Helper()
		res := doHTTP(http.MethodGet, route, "", "bytes=0-31")
		if res.code != http.StatusPartialContent ||
			!bytes.Equal(res.body, source[:32]) ||
			res.head.Get("Content-Type") != mime ||
			res.head.Get("Content-Range") != fmt.Sprintf("bytes 0-31/%d", len(source)) ||
			!strings.Contains(res.head.Get("Cache-Control"), "no-store") ||
			res.head.Get("X-Content-Type-Options") != "nosniff" ||
			res.head.Get("Referrer-Policy") != "no-referrer" {
			t.Fatal("authorized Viewer original did not return genuine private 206 Range")
		}
	}
	deny := func(route string, want int) {
		t.Helper()
		res := doHTTP(http.MethodGet, route, "", "bytes=0-31")
		if res.code != want ||
			res.head.Get("Content-Range") != "" ||
			res.head.Get("Content-Disposition") != "" ||
			res.head.Get("ETag") != "" ||
			bytes.Contains(res.body, stillA[:32]) ||
			bytes.Contains(res.body, movie[:32]) {
			t.Fatalf("revoked or wrong-resource Viewer Range leaked private source/status: HTTP %d", res.code)
		}
	}

	// Real Owner A and B have isolated preview admissions. The returned URL
	// is a deliberately scoped bearer capability (not an ambient account cookie).
	ticketAStill := issue(oldA, aJPG, http.StatusOK)
	ticketAMovie := issue(oldA, aMP4, http.StatusOK)
	ticketBStill := issue(tokenB, bJPG, http.StatusOK)
	issue(tokenB, aJPG, http.StatusNotFound)
	issue(tokenB, aMP4, http.StatusNotFound)
	issue(oldA, bJPG, http.StatusNotFound)
	readRange(ticketAStill, "image/jpeg", stillA)
	readRange(ticketAMovie, "video/mp4", movie)
	readRange(ticketBStill, "image/jpeg", stillB)
	deny("/api/v1/file-preview/"+strconv.FormatUint(bJPG, 10)+
		strings.TrimPrefix(ticketAStill, "/api/v1/file-preview/"+strconv.FormatUint(aJPG, 10)),
		http.StatusUnauthorized)

	// Simulate server-authoritative logout/password-change invalidation by
	// rotating ONLY Owner A's persisted session version. A new login to B
	// must never resurrect A's signed original or A's prior access token.
	if err := db.Model(&meta.User{}).Where("id = ?", alice.ID).
		Update("session_version", alice.SessionVersion+1).Error; err != nil {
		t.Fatal(err)
	}
	issue(oldA, aJPG, http.StatusUnauthorized)
	issue(oldA, aMP4, http.StatusUnauthorized)
	deny(ticketAStill, http.StatusUnauthorized)
	deny(ticketAMovie, http.StatusUnauthorized)
	readRange(ticketBStill, "image/jpeg", stillB)

	freshA, err := server.Auth.Issue(alice.ID, alice.SessionVersion+1)
	if err != nil {
		t.Fatal(err)
	}
	freshStill := issue(freshA, aJPG, http.StatusOK)
	freshMovie := issue(freshA, aMP4, http.StatusOK)
	readRange(freshStill, "image/jpeg", stillA)
	readRange(freshMovie, "video/mp4", movie)
	deny(ticketAStill, http.StatusUnauthorized)
	deny(ticketAMovie, http.StatusUnauthorized)
	issue(freshA, bJPG, http.StatusNotFound)

	// Old signed media from the valid replacement session must also become
	// stale on asset revision changes, without affecting Owner B's original.
	if err := db.Model(&meta.Node{}).Where("id = ? AND owner_id = ?", aMP4, alice.ID).
		Update("revision", 2).Error; err != nil {
		t.Fatal(err)
	}
	deny(freshMovie, http.StatusGone)
	readRange(freshStill, "image/jpeg", stillA)
	readRange(ticketBStill, "image/jpeg", stillB)
	t.Log("PWA_VIEWER_P1Q_VERIFIED nativeTCP=true postgres=true cas=true jpg206=true h264206=true ownerIsolation=true revoked401=true replacementTicket=true revision410=true")
}
