package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

// S4C3-B2c2 tests actual Gin TCP HTTP and isolated PostgreSQL/Local CAS.
// Only test-issued tickets expire quickly; production TTL and APIs stay intact.
func TestPWAS4C3SignedTicketExpiryRevocationRangeRecoveryRealHTTP(t *testing.T) {
	srv, peer, owner, ownerJWT, foreignJWT, node := newNativeDownloadProgressFixture(t)
	httpServer := httptest.NewServer(peer.Router())
	defer httpServer.Close()
	client := &http.Client{Timeout: 12 * time.Second}
	const original = "0123456789"
	ticketPath := fmt.Sprintf("/api/v1/files/%d/download-ticket", node.ID)

	// Never log bearer, signed URL, file content, or local path on failure.
	do := func(method, endpoint, bearer, rangeHeader string, want int) ([]byte, http.Header) {
		t.Helper()
		req, err := http.NewRequest(method, httpServer.URL+endpoint, nil)
		if err != nil {
			t.Fatal("could not construct isolated HTTP request")
		}
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		if rangeHeader != "" {
			req.Header.Set("Range", rangeHeader)
		}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("isolated HTTP transport failed: %T", err)
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
		if err != nil {
			t.Fatal("isolated HTTP body read failed")
		}
		if resp.StatusCode != want {
			t.Fatalf("signed HTTP status=%d expected=%d", resp.StatusCode, want)
		}
		return body, resp.Header.Clone()
	}
	issue := func(bearer string, want int) nativeDownloadTestTicket {
		t.Helper()
		body, _ := do(http.MethodPost, ticketPath, bearer, "", want)
		if want != http.StatusOK {
			return nativeDownloadTestTicket{}
		}
		var ticket nativeDownloadTestTicket
		if err := json.Unmarshal(body, &ticket); err != nil ||
			ticket.TransferID == "" || !strings.HasPrefix(ticket.URL,
			fmt.Sprintf("/api/v1/file-download/%d?ticket=", node.ID)) {
			t.Fatal("real signed download ticket was not issued")
		}
		return ticket
	}
	readRange := func(endpoint string, from, to int, want string) []byte {
		t.Helper()
		data, headers := do(http.MethodGet, endpoint, "",
			fmt.Sprintf("bytes=%d-%d", from, to), http.StatusPartialContent)
		if string(data) != want ||
			headers.Get("Content-Range") != fmt.Sprintf("bytes %d-%d/%d", from, to, len(original)) ||
			headers.Get("Content-Length") != strconv.Itoa(to-from+1) ||
			!strings.Contains(headers.Get("Cache-Control"), "no-store") {
			t.Fatal("actual HTTP Range, source bytes or private cache headers mismatch")
		}
		return data
	}
	denyRange := func(endpoint string, from, to int) {
		t.Helper()
		body, headers := do(http.MethodGet, endpoint, "",
			fmt.Sprintf("bytes=%d-%d", from, to), http.StatusUnauthorized)
		if headers.Get("Content-Range") != "" ||
			headers.Get("X-Content-SHA256") != "" ||
			bytes.Contains(body, []byte(original)) {
			t.Fatal("rejected signed Range exposed private byte or Range metadata")
		}
	}
	loadProgress := func(id, state string, sent int64) {
		t.Helper()
		var observed meta.DownloadProgress
		if err := srv.DB.Where("id = ? AND owner_id = ?", id, owner.ID).
			First(&observed).Error; err != nil {
			t.Fatal("signed transfer progress not found")
		}
		if observed.State != state || observed.BytesSent != sent ||
			observed.ActiveRequests != 0 || observed.BytesTotal != int64(len(original)) {
			t.Fatalf("signed progress state=%s sent=%d active=%d (expected %s/%d/0)",
				observed.State, observed.BytesSent, observed.ActiveRequests, state, sent)
		}
	}

	// 1: The owner signs and receives a genuine five-byte HTTP Range.
	first := issue(ownerJWT, http.StatusOK)
	part0 := readRange(first.URL, 0, 4, "01234")
	loadProgress(first.TransferID, "completed", 5)

	// 2: A real production-format JWT with TEST-only one-second lifetime.
	// The server may never activate its queued progress after expiry.
	short, expires, err := srv.Auth.IssueDownloadStream(
		owner.ID, owner.SessionVersion, "file", strconv.FormatUint(node.ID, 10),
		node.Revision, time.Second)
	if err != nil {
		t.Fatal("failed to issue time-limited signed download ticket")
	}
	shortID := srv.createDownloadProgress(context.Background(), short, int64(len(original)))
	if shortID == "" {
		t.Fatal("short-lived ticket has no authoritative progress record")
	}
	shortURL := fmt.Sprintf("/api/v1/file-download/%d?ticket=%s",
		node.ID, url.QueryEscape(short))
	time.Sleep(time.Until(expires.Add(1100 * time.Millisecond)))
	denyRange(shortURL, 5, 9)
	loadProgress(shortID, "queued", 0)
	loadProgress(first.TransferID, "completed", 5)

	// 3: A new owner-authorized ticket recovers the missing Range.
	// This proves explicit Range recovery, not OS-managed auto-resume.
	fresh := issue(ownerJWT, http.StatusOK)
	if fresh.TransferID == first.TransferID || fresh.TransferID == shortID {
		t.Fatal("fresh authorization reused an old transfer ID")
	}
	part1 := readRange(fresh.URL, 5, 9, "56789")
	combined := append(append([]byte(nil), part0...), part1...)
	wantSHA := sha256.Sum256([]byte(original))
	if len(combined) != len(original) || sha256.Sum256(combined) != wantSHA {
		t.Fatal("re-authorized Range reconstruction SHA-256 mismatch")
	}
	loadProgress(fresh.TransferID, "completed", 5)
	// Same legitimate signature is not authority for another resource.
	parsed, err := url.Parse(fresh.URL)
	if err != nil {
		t.Fatal("real signed ticket returned invalid URL")
	}
	wrongResource := fmt.Sprintf("/api/v1/file-download/%d?ticket=%s",
		node.ID+1, url.QueryEscape(parsed.Query().Get("ticket")))
	denyRange(wrongResource, 0, 4)
	loadProgress(fresh.TransferID, "completed", 5)
	issue(foreignJWT, http.StatusNotFound)

	// 4: Real PostgreSQL session revocation fences old tickets and bearer.
	if err := srv.DB.Model(&meta.User{}).Where("id = ?", owner.ID).
		Update("session_version", owner.SessionVersion+1).Error; err != nil {
		t.Fatal("failed to revoke old owner session")
	}
	denyRange(first.URL, 5, 9)
	denyRange(fresh.URL, 0, 4)
	issue(ownerJWT, http.StatusUnauthorized)
	loadProgress(first.TransferID, "completed", 5)
	loadProgress(fresh.TransferID, "completed", 5)
	newJWT, err := srv.Auth.Issue(owner.ID, owner.SessionVersion+1)
	if err != nil {
		t.Fatal("failed to issue newly authorized owner session")
	}
	// Neither the newly authenticated owner nor another owner may access old
	// SessionVersion-scoped progress metadata.
	do(http.MethodGet, "/api/v1/download/progress/"+fresh.TransferID,
		newJWT, "", http.StatusNotFound)
	do(http.MethodGet, "/api/v1/download/progress/"+fresh.TransferID,
		foreignJWT, "", http.StatusNotFound)

	// 5: New session, new ticket and genuine unchanged CAS Range bytes.
	recoveredTicket := issue(newJWT, http.StatusOK)
	if recoveredTicket.TransferID == fresh.TransferID {
		t.Fatal("new and revoked sessions share signed transfer identity")
	}
	resumed := readRange(recoveredTicket.URL, 0, 4, "01234")
	if sha256.Sum256(append(append([]byte(nil), resumed...), part1...)) != wantSHA {
		t.Fatal("post-revocation independent Range reconstruction SHA-256 mismatch")
	}
	loadProgress(recoveredTicket.TransferID, "completed", 5)
	denyRange(fresh.URL, 0, 4)
	loadProgress(fresh.TransferID, "completed", 5)
	t.Log("PWA_S4C3_B2C2_VERIFIED realTCP=true postgres=true expired401=true revoked401=true newTicket=true rangeSHA=true")
}
