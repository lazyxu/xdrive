package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestIOSResumeKeyLookupIsOwnerExactReadOnlyAndNoDuplicateCreate(t *testing.T) {
	db, server, owner, foreign, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.UploadSession{}, &meta.UploadPart{}); err != nil {
		t.Fatal(err)
	}
	server.MaxUploadBytes = 128 << 20
	server.Auth = auth.New("ios-readonly-upload-lookup-test", time.Hour)
	server.RefreshTTL = 24 * time.Hour
	gin.SetMode(gin.TestMode)
	router := server.Router()
	token, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	otherToken, err := server.Auth.Issue(foreign.ID, foreign.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}

	const size = int64(7)
	const chunk = int64(8 << 20)
	key := "ios_" + strings.Repeat("a", 64)
	sha := strings.Repeat("b", 64)
	parent := root.ID
	expires := time.Now().Add(time.Hour)
	stored := meta.UploadSession{
		ID: uuid.NewString(), OwnerID: owner.ID, ParentID: &parent,
		Name: "one-photo.heic", RequestedName: "one-photo.heic",
		ConflictPolicy: meta.UploadConflictPolicyFail,
		TotalSize: size, ChunkSize: chunk, ChunkCount: 1,
		SHA256: sha, ResumeKey: key, Status: meta.UploadStatusActive,
		ExpiresAt: expires,
	}
	if err := db.Create(&stored).Error; err != nil {
		t.Fatal(err)
	}
	body := func(k, file, hash string, bytes int64) string {
		return fmt.Sprintf(
			`{"resume_key":%q,"parent_id":%d,"name":%q,"size":%d,"chunk_size":%d,"sha256":%q}`,
			k, parent, file, bytes, chunk, hash,
		)
	}
	url := "/api/v1/uploads/resume-lookup"
	lookup := request(t, router, http.MethodPost, url, token,
		strings.NewReader(body(key, stored.Name, sha, size)), http.StatusOK)
	if lookup.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal("upload reconciliation response is cacheable")
	}
	var received uploadSessionDTO
	if err := json.Unmarshal(lookup.Body.Bytes(), &received); err != nil {
		t.Fatal(err)
	}
	if received.ID != stored.ID || received.ParentID == nil ||
		*received.ParentID != root.ID || received.SHA256 != sha ||
		received.Status != meta.UploadStatusActive || received.ResumeKey != key {
		t.Fatalf("wrong Owner upload returned: %+v", received)
	}
	if received.Result != nil {
		t.Fatal("an unfinalized session returned a finalized file receipt")
	}
	// A replayed read-only recovery cannot allocate a second UploadSession.
	var before int64
	if err := db.Model(&meta.UploadSession{}).Count(&before).Error; err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodPost, url, token,
		strings.NewReader(body(key, stored.Name, sha, size)), http.StatusOK)
	var after int64
	if err := db.Model(&meta.UploadSession{}).Count(&after).Error; err != nil {
		t.Fatal(err)
	}
	if before != 1 || after != before {
		t.Fatal("read-only session lookup mutated the upload table")
	}

	// Strong HMAC identity, full hash, size and file destination MUST match.
	for _, requestBody := range []string{
		body("ios_"+strings.Repeat("c", 64), stored.Name, sha, size),
		body(key, stored.Name, strings.Repeat("c", 64), size),
		body(key, stored.Name, sha, size+1),
		body(key, "different.heic", sha, size),
	} {
		request(t, router, http.MethodPost, url, token,
			strings.NewReader(requestBody), http.StatusNotFound)
	}
	for _, requestBody := range []string{
		body("lp2_"+strings.Repeat("a", 64), stored.Name, sha, size),
		body("ios_"+strings.Repeat("x", 64), stored.Name, sha, size),
		body("", stored.Name, sha, size),
		body(key, "../bad.jpg", sha, size),
	} {
		request(t, router, http.MethodPost, url, token,
			strings.NewReader(requestBody), http.StatusBadRequest)
	}
	request(t, router, http.MethodPost, url, otherToken,
		strings.NewReader(body(key, stored.Name, sha, size)), http.StatusNotFound)
	request(t, router, http.MethodPost, url, "",
		strings.NewReader(body(key, stored.Name, sha, size)), http.StatusUnauthorized)

	// Duplicate exact keys are ambiguous (possibly concurrent create ACKs):
	// never silently choose a newer session and mislabel it as the same intent.
	duplicate := stored
	duplicate.ID = uuid.NewString()
	if err := db.Create(&duplicate).Error; err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodPost, url, token,
		strings.NewReader(body(key, stored.Name, sha, size)), http.StatusConflict)
	if err := db.Delete(&duplicate).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.Model(&meta.UploadSession{}).Where("id = ?", stored.ID).
		Update("expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodPost, url, token,
		strings.NewReader(body(key, stored.Name, sha, size)), http.StatusGone)
	var remaining int64
	if err := db.Model(&meta.UploadSession{}).Where("id = ?", stored.ID).
		Count(&remaining).Error; err != nil {
		t.Fatal(err)
	}
	if remaining != 1 {
		t.Fatal("read-only expired lookup unexpectedly deleted the old session")
	}
}

func TestIOSResumeKeyLookupKeyRequires256BitLowercaseHMAC(t *testing.T) {
	for _, key := range []string{
		"ios_" + strings.Repeat("0", 64),
		"ios_" + strings.Repeat("f", 64),
	} {
		if !validIOSUploadResumeLookupKey(key) {
			t.Fatalf("valid iOS HMAC key rejected")
		}
	}
	for _, key := range []string{
		"", "lp2_" + strings.Repeat("a", 64),
		"ios_" + strings.Repeat("A", 64),
		"ios_" + strings.Repeat("a", 63),
		"ios_" + strings.Repeat("a", 65),
		"ios_" + strings.Repeat("g", 64),
	} {
		if validIOSUploadResumeLookupKey(key) {
			t.Fatal("weak or non-native resume key accepted")
		}
	}
}
