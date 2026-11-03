package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm/clause"
)

func TestPublicShareInstantUploadScopeAndReceipt(t *testing.T) {
	env := newInstantUploadTestEnv(t)
	ownerToken := createTestUser(t, env.db, env.router, "share-instant-owner", "owner-password")
	foreignToken := createTestUser(t, env.db, env.router, "share-instant-foreign", "foreign-password")
	root := requestNode(t, env.router, http.MethodGet, "/api/v1/nodes/root", ownerToken, nil, http.StatusOK)
	foreignRoot := requestNode(t, env.router, http.MethodGet, "/api/v1/nodes/root", foreignToken, nil, http.StatusOK)
	directory := func(parent uint64, name string) nodeDTO {
		return requestNode(t, env.router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", parent),
			ownerToken, strings.NewReader(fmt.Sprintf(`{"name":%q}`, name)), http.StatusCreated)
	}
	shared := directory(root.ID, "shared")
	sourceDir := directory(shared.ID, "source")
	destination := directory(shared.ID, "destination")
	response := request(t, env.router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/shares", shared.ID),
		ownerToken, strings.NewReader(`{"access":"view_upload","password":"share-password"}`), http.StatusCreated)
	var share createdShareDTO
	if err := json.Unmarshal(response.Body.Bytes(), &share); err != nil {
		t.Fatal(err)
	}
	initBody := func(name, content string, size int64, intent int) []byte {
		body, err := json.Marshal(uploadInitRequest{
			ParentID: &destination.ID, Name: name, Size: size, SHA256: instantSHA256(content),
			ChunkSize: defaultUploadChunkSize, ConflictPolicy: meta.UploadConflictPolicyKeepBoth,
			ResumeKey: fmt.Sprintf("ps1_%064x", intent),
		})
		if err != nil {
			t.Fatal(err)
		}
		return body
	}
	const visibleContent = "bytes already visible inside the active share"
	seed := uploadTestFile(t, env.router, ownerToken, sourceDir.ID, "original.bin", visibleContent)
	body := initBody("new-path.bin", visibleContent, int64(len(visibleContent)), 1)
	created := guestUploadRequest(t, env.router, http.MethodPost, "/api/v1/public/share/uploads",
		share.Token, "share-password", body, http.StatusCreated, nil)
	if created["status"] != meta.UploadStatusFinalized || created["instant_cas_reused"] != true {
		t.Fatalf("visible identical bytes must finalize without chunks: %+v", created)
	}
	for _, private := range []string{"result", "owner_id", "parent_id", "storage_key", "sha256"} {
		if _, leaked := created[private]; leaked {
			t.Fatalf("guest receipt exposes %s", private)
		}
	}
	var session meta.UploadSession
	if err := env.db.First(&session, "id = ?", created["id"]).Error; err != nil {
		t.Fatal(err)
	}
	if session.ShareID == nil || *session.ShareID != share.ID || session.ResultNodeID == nil || !session.InstantCAS {
		t.Fatalf("missing durable share receipt: %+v", session)
	}
	var parts int64
	if err := env.db.Model(&meta.UploadPart{}).Where("session_id = ?", session.ID).Count(&parts).Error; err != nil || parts != 0 {
		t.Fatalf("fast upload must not create parts: parts=%d err=%v", parts, err)
	}
	var original, copy meta.File
	if err := env.db.First(&original, "node_id = ?", seed.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := env.db.First(&copy, "node_id = ?", *session.ResultNodeID).Error; err != nil {
		t.Fatal(err)
	}
	if copy.StorageKey != original.StorageKey || copy.SHA256 != original.SHA256 || copy.Size != original.Size {
		t.Fatalf("fast upload did not reuse exact CAS bytes: original=%+v copy=%+v", original, copy)
	}
	content := request(t, env.router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", *session.ResultNodeID),
		ownerToken, nil, http.StatusOK)
	if content.Body.String() != visibleContent {
		t.Fatal("fast upload receipt does not resolve to durable original bytes")
	}
	var before, after meta.ContentBlob
	if err := env.db.First(&before, "sha256 = ?", original.SHA256).Error; err != nil {
		t.Fatal(err)
	}
	retry := guestUploadRequest(t, env.router, http.MethodPost, "/api/v1/public/share/uploads",
		share.Token, "share-password", body, http.StatusOK, nil)
	finalizeRetry := guestUploadRequest(t, env.router, http.MethodPost, "/api/v1/public/share/uploads/"+session.ID+"/finalize",
		share.Token, "share-password", []byte(`{}`), http.StatusOK, nil)
	if retry["id"] != session.ID || retry["status"] != meta.UploadStatusFinalized || finalizeRetry["id"] != session.ID {
		t.Fatalf("retry changed durable receipt: retry=%+v finalize=%+v", retry, finalizeRetry)
	}
	if err := env.db.First(&after, "sha256 = ?", original.SHA256).Error; err != nil || after.RefCount != before.RefCount {
		t.Fatalf("retry retained CAS twice: before=%+v after=%+v err=%v", before, after, err)
	}
	var nodes int64
	if err := env.db.Model(&meta.Node{}).Where("parent_id = ?", destination.ID).Count(&nodes).Error; err != nil || nodes != 1 {
		t.Fatalf("retry created duplicate node: count=%d err=%v", nodes, err)
	}

	outside := "same owner bytes outside this share"
	foreign := "foreign owner bytes outside this share"
	trashed := "deleted source file bytes"
	moved := "source ancestor moved out of share"
	history := "old version is not Share-visible current content"
	uploadTestFile(t, env.router, ownerToken, root.ID, "outside.bin", outside)
	uploadTestFile(t, env.router, foreignToken, foreignRoot.ID, "foreign.bin", foreign)
	historyNode := uploadTestFile(t, env.router, ownerToken, sourceDir.ID, "history.bin", history)
	requestWithHeaders(t, env.router, http.MethodPut, fmt.Sprintf("/api/v1/files/%d/content", historyNode.ID),
		ownerToken, strings.NewReader("replacement current content"), http.StatusOK,
		map[string]string{"If-Match": fmt.Sprintf(`"%d"`, historyNode.Revision), "Content-Type": "application/octet-stream"})
	trashNode := uploadTestFile(t, env.router, ownerToken, sourceDir.ID, "trashed.bin", trashed)
	if err := env.db.Model(&meta.Node{}).Where("id = ?", trashNode.ID).Update("deleted_at", time.Now()).Error; err != nil {
		t.Fatal(err)
	}
	movedDir := directory(shared.ID, "moved")
	uploadTestFile(t, env.router, ownerToken, movedDir.ID, "moved.bin", moved)
	if err := env.db.Model(&meta.Node{}).Where("id = ?", movedDir.ID).Update("parent_id", root.ID).Error; err != nil {
		t.Fatal(err)
	}
	for i, tc := range []struct {
		name, content string
		size          int64
	}{
		{"same-owner-outside", outside, int64(len(outside))},
		{"foreign-owner", foreign, int64(len(foreign))},
		{"deleted-file", trashed, int64(len(trashed))},
		{"moved-ancestor", moved, int64(len(moved))},
		{"history-only", history, int64(len(history))},
		{"size-mismatch", visibleContent, int64(len(visibleContent) + 1)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := guestUploadRequest(t, env.router, http.MethodPost, "/api/v1/public/share/uploads",
				share.Token, "share-password", initBody(tc.name, tc.content, tc.size, i+10), http.StatusCreated, nil)
			if result["status"] != meta.UploadStatusActive || result["instant_cas_reused"] == true {
				t.Fatalf("out-of-scope or mismatched bytes disclosed by fast upload: %+v", result)
			}
		})
	}
	// Fresh fast-upload intents must pass the same current capability, password,
	// expiry, revocation and Owner checks as ordinary guest uploads.
	deniedBody := initBody("denied.bin", visibleContent, int64(len(visibleContent)), 100)
	guestUploadRequest(t, env.router, http.MethodPost, "/api/v1/public/share/uploads", share.Token, "wrong", deniedBody, http.StatusUnauthorized, nil)
	guestUploadRequest(t, env.router, http.MethodPost, "/api/v1/public/share/uploads", share.Token, "", deniedBody, http.StatusUnauthorized, nil)
	for _, tc := range []struct {
		name, column string
		value, reset any
		status       int
	}{
		{"read-only", "access", shareAccessReadOnly, shareAccessViewUpload, http.StatusForbidden},
		{"expired", "expires_at", time.Now().Add(-time.Minute), nil, http.StatusGone},
		{"revoked", "revoked_at", time.Now(), nil, http.StatusGone},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := env.db.Model(&meta.Share{}).Where("id = ?", share.ID).Update(tc.column, tc.value).Error; err != nil {
				t.Fatal(err)
			}
			guestUploadRequest(t, env.router, http.MethodPost, "/api/v1/public/share/uploads",
				share.Token, "share-password", deniedBody, tc.status, nil)
			if err := env.db.Model(&meta.Share{}).Where("id = ?", share.ID).Update(tc.column, tc.reset).Error; err != nil {
				t.Fatal(err)
			}
		})
	}
	// A valid link to the same subtree cannot read another link's receipt.
	secondResponse := request(t, env.router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/shares", shared.ID),
		ownerToken, bytes.NewBufferString(`{"access":"view_upload"}`), http.StatusCreated)
	var second createdShareDTO
	if err := json.Unmarshal(secondResponse.Body.Bytes(), &second); err != nil {
		t.Fatal(err)
	}
	guestUploadRequest(t, env.router, http.MethodGet, "/api/v1/public/share/uploads/"+session.ID,
		second.Token, "", nil, http.StatusNotFound, nil)
}

func TestPublicShareInstantUploadRechecksGrantAndSerializesRetry(t *testing.T) {
	env := newInstantUploadTestEnv(t)
	ownerToken := createTestUser(t, env.db, env.router, "share-instant-race", "owner-password")
	accountRoot := requestNode(t, env.router, http.MethodGet, "/api/v1/nodes/root", ownerToken, nil, http.StatusOK)
	root := requestNode(t, env.router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", accountRoot.ID),
		ownerToken, strings.NewReader(`{"name":"shared"}`), http.StatusCreated)
	source := requestNode(t, env.router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID),
		ownerToken, strings.NewReader(`{"name":"source"}`), http.StatusCreated)
	const content = "visible source for transactional grant checks"
	seed := uploadTestFile(t, env.router, ownerToken, source.ID, "seed.bin", content)
	response := request(t, env.router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/shares", root.ID),
		ownerToken, strings.NewReader(`{"access":"view_upload","password":"share-password"}`), http.StatusCreated)
	var created createdShareDTO
	if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	var grant meta.Share
	if err := env.db.First(&grant, created.ID).Error; err != nil {
		t.Fatal(err)
	}
	req := uploadInitRequest{
		ParentID: &root.ID, Name: "copy.bin", RequestedName: "copy.bin", Size: int64(len(content)),
		ChunkSize: defaultUploadChunkSize, SHA256: instantSHA256(content),
		ConflictPolicy: meta.UploadConflictPolicyKeepBoth, ResumeKey: fmt.Sprintf("ps1_%064x", 1),
	}
	for _, tc := range []struct {
		name, column string
		value, reset any
	}{
		{"password-changed", "password_hash", "different-password-hash", grant.PasswordHash},
		{"token-changed", "token_hash", strings.Repeat("0", 64), grant.TokenHash},
		{"capability-revoked", "access", shareAccessReadOnly, shareAccessViewUpload},
		{"expired", "expires_at", time.Now().Add(-time.Second), nil},
		{"revoked", "revoked_at", time.Now(), nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := env.db.Model(&meta.Share{}).Where("id = ?", grant.ID).Update(tc.column, tc.value).Error; err != nil {
				t.Fatal(err)
			}
			_, _, instant, err := env.server.tryInstantUploadSession(context.Background(), grant.OwnerID, req, 1, &grant)
			if !errors.Is(err, errShareUploadDenied) || instant {
				t.Fatalf("changed authorization snapshot accepted: instant=%v err=%v", instant, err)
			}
			if err := env.db.Model(&meta.Share{}).Where("id = ?", grant.ID).Update(tc.column, tc.reset).Error; err != nil {
				t.Fatal(err)
			}
		})
	}
	t.Run("owner-disabled", func(t *testing.T) {
		if err := env.db.Model(&meta.User{}).Where("id = ?", grant.OwnerID).Update("disabled_at", time.Now()).Error; err != nil {
			t.Fatal(err)
		}
		_, _, instant, err := env.server.tryInstantUploadSession(context.Background(), grant.OwnerID, req, 1, &grant)
		if !errors.Is(err, errShareUploadDenied) || instant {
			t.Fatalf("disabled Owner accepted: instant=%v err=%v", instant, err)
		}
		if err := env.db.Model(&meta.User{}).Where("id = ?", grant.OwnerID).Update("disabled_at", nil).Error; err != nil {
			t.Fatal(err)
		}
	})
	t.Run("source-ancestor-being-moved", func(t *testing.T) {
		tx := env.db.Begin()
		defer tx.Rollback()
		var locked meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&locked, source.ID).Error; err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, _, instant, err := env.server.tryInstantUploadSession(ctx, grant.OwnerID, req, 1, &grant)
		if !errors.Is(err, errShareUploadDenied) || instant {
			t.Fatalf("concurrent source mutation did not fail closed: instant=%v err=%v", instant, err)
		}
	})
	// Two in-flight copies of one guest intent serialize at the Share lock.
	// The second must return the first durable receipt, not create another Node.
	type result struct {
		session meta.UploadSession
		instant bool
		err     error
	}
	results := make(chan result, 2)
	start := make(chan struct{})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for range 2 {
		go func() {
			<-start
			session, _, instant, err := env.server.tryInstantUploadSession(ctx, grant.OwnerID, req, 1, &grant)
			results <- result{session, instant, err}
		}()
	}
	close(start)
	first, second := <-results, <-results
	if first.err != nil || second.err != nil || !first.instant || !second.instant || first.session.ID != second.session.ID {
		t.Fatalf("concurrent guest retry duplicated or failed: first=%+v second=%+v", first, second)
	}
	var blob meta.ContentBlob
	if err := env.db.First(&blob, "sha256 = ?", req.SHA256).Error; err != nil || blob.RefCount != 2 {
		t.Fatalf("one source and one committed copy require exactly two refs: blob=%+v err=%v", blob, err)
	}
	if first.session.ResultNodeID == nil || *first.session.ResultNodeID == seed.ID {
		t.Fatal("fast upload did not create a separate durable destination")
	}
	t.Run("normal-upload-wins-mixed-retry", func(t *testing.T) {
		const lateContent = "bytes became visible after an ordinary upload started"
		lateReq := req
		lateReq.Name, lateReq.RequestedName = "late.bin", "late.bin"
		lateReq.SHA256, lateReq.Size = instantSHA256(lateContent), int64(len(lateContent))
		lateReq.ResumeKey = fmt.Sprintf("ps1_%064x", 2)
		body, err := json.Marshal(lateReq)
		if err != nil {
			t.Fatal(err)
		}
		active := guestUploadRequest(t, env.router, http.MethodPost, "/api/v1/public/share/uploads",
			created.Token, "share-password", body, http.StatusCreated, nil)
		if active["status"] != meta.UploadStatusActive {
			t.Fatalf("unavailable bytes unexpectedly reused: %+v", active)
		}
		uploadTestFile(t, env.router, ownerToken, source.ID, "late-source.bin", lateContent)
		// Model an in-flight retry whose outer lookup ran before the normal
		// session committed. The inner locked lookup must see that session.
		resumed, _, handled, err := env.server.tryInstantUploadSession(ctx, grant.OwnerID, lateReq, 1, &grant)
		if err != nil || !handled || resumed.ID != active["id"] || resumed.Status != meta.UploadStatusActive || resumed.InstantCAS {
			t.Fatalf("mixed normal/instant retry created a second receipt: session=%+v handled=%v err=%v", resumed, handled, err)
		}
		var count int64
		if err := env.db.Model(&meta.UploadSession{}).Where("share_id = ? AND resume_key = ?", grant.ID, lateReq.ResumeKey).
			Count(&count).Error; err != nil || count != 1 {
			t.Fatalf("one guest intent has multiple sessions: count=%d err=%v", count, err)
		}
	})
}
