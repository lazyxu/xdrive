package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

func guestUploadRequest(
	t *testing.T, router http.Handler, method, path, token, password string,
	body []byte, status int, extra map[string]string,
) map[string]any {
	t.Helper()
	headers := map[string]string{
		"X-XDrive-Share-Token": token, "X-XDrive-Share-Password": password,
	}
	for key, value := range extra { headers[key] = value }
	response := requestWithHeaders(t, router, method, path, "",
		bytes.NewReader(body), status, headers)
	if status == http.StatusNoContent || len(response.Body.Bytes()) == 0 { return nil }
	if status >= 300 { return nil }
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode guest response: %v body=%s", err, response.Body.String())
	}
	return payload
}

func guestUploadFile(
	t *testing.T, router http.Handler, shareToken, password string, parentID uint64,
	name, content, resumeKey string,
) string {
	t.Helper()
	data := []byte(content)
	body := []byte(fmt.Sprintf(
		`{"parent_id":%d,"name":%q,"size":%d,"chunk_size":8388608,"conflict_policy":"keep_both","resume_key":%q}`,
		parentID, name, len(data), resumeKey,
	))
	created := guestUploadRequest(t, router, http.MethodPost,
		"/api/v1/public/share/uploads", shareToken, password, body, http.StatusCreated, nil)
	id, ok := created["id"].(string)
	if !ok || id == "" { t.Fatalf("invalid upload session: %+v", created) }
	if _, leaked := created["result"]; leaked { t.Fatal("guest receipt leaked Owner node") }
	if _, leaked := created["owner_id"]; leaked { t.Fatal("guest receipt leaked Owner ID") }
	sum := sha256.Sum256(data)
	guestUploadRequest(t, router, http.MethodPut,
		"/api/v1/public/share/uploads/"+id+"/chunks/0", shareToken, password,
		data, http.StatusCreated,
		map[string]string{"X-Chunk-SHA256": hex.EncodeToString(sum[:]), "Content-Type": "application/octet-stream"})
	finalized := guestUploadRequest(t, router, http.MethodPost,
		"/api/v1/public/share/uploads/"+id+"/finalize", shareToken, password,
		[]byte("{}"), http.StatusOK, nil)
	if finalized["status"] != "finalized" { t.Fatalf("not finalized: %+v", finalized) }
	return id
}

func TestPublicShareUploadGrantSubtreeResumeAndRevocation(t *testing.T) {
	router, db, ownerToken, root := folderShareTestFixture(t)
	foreignToken := createTestUser(t, db, router, "share-guest-foreign", "pass-foreign")
	foreignRoot := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", foreignToken, nil, http.StatusOK)
	shared := requestNode(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID), ownerToken,
		strings.NewReader(`{"name":"guest-drop"}`), http.StatusCreated)
	fileShare := uploadTestFile(t, router, ownerToken, shared.ID, "same.txt", "existing-owner-file")
	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/shares", fileShare.ID),
		ownerToken, strings.NewReader(`{"access":"view_upload"}`), http.StatusBadRequest)

	createdResponse := request(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/shares", shared.ID), ownerToken,
		strings.NewReader(`{"access":"read_only","password":"guest-share-password","max_downloads":1}`),
		http.StatusCreated)
	var created createdShareDTO
	if err := json.Unmarshal(createdResponse.Body.Bytes(), &created); err != nil { t.Fatal(err) }
	if created.Access != shareAccessReadOnly || created.MaxDownloads != 0 {
		t.Fatalf("new share must default to unlimited download: %+v", created)
	}
	guestUploadRequest(t, router, http.MethodPost,
		"/api/v1/public/share/directories", created.Token, "guest-share-password",
		[]byte(`{"name":"sub"}`), http.StatusForbidden, nil)

	// Only the Owner may update a link, and the token remains the same.
	updatePath := fmt.Sprintf("/api/v1/shares/%d", created.ID)
	request(t, router, http.MethodPatch, updatePath, foreignToken,
		strings.NewReader(`{"access":"view_upload"}`), http.StatusNotFound)
	updated := request(t, router, http.MethodPatch, updatePath, ownerToken,
		strings.NewReader(`{"access":"view_upload","expires_at":null}`), http.StatusOK)
	var updatedShare shareDTO
	if err := json.Unmarshal(updated.Body.Bytes(), &updatedShare); err != nil { t.Fatal(err) }
	if updatedShare.Access != shareAccessViewUpload { t.Fatal("permission update did not persist") }
	metadata := publicShareRequest(t, router, http.MethodGet, created.Token, nil, http.StatusOK)
	var public publicShareDTO
	if err := json.Unmarshal(metadata.Body.Bytes(), &public); err != nil { t.Fatal(err) }
	if !public.Capabilities.Upload || public.Capabilities.Write || public.Capabilities.Delete {
		t.Fatalf("Share upload must not confer generic write/delete: %+v", public.Capabilities)
	}

	guestUploadRequest(t, router, http.MethodPost, "/api/v1/public/share/directories",
		created.Token, "wrong", []byte(`{"name":"sub"}`), http.StatusUnauthorized, nil)
	guestUploadRequest(t, router, http.MethodPost, "/api/v1/public/share/directories",
		created.Token, "guest-share-password",
		[]byte(fmt.Sprintf(`{"parent_id":%d,"name":"outside"}`, foreignRoot.ID)),
		http.StatusForbidden, nil)
	firstDir := guestUploadRequest(t, router, http.MethodPost, "/api/v1/public/share/directories",
		created.Token, "guest-share-password", []byte(`{"name":"sub"}`), http.StatusCreated, nil)
	subID := uint64(firstDir["id"].(float64))
	sameDir := guestUploadRequest(t, router, http.MethodPost, "/api/v1/public/share/directories",
		created.Token, "guest-share-password", []byte(`{"name":"sub"}`), http.StatusOK, nil)
	if uint64(sameDir["id"].(float64)) != subID { t.Fatal("retry created duplicate directory") }

	for i := range 3 {
		resume := "ps1_" + fmt.Sprintf("%064x", i+1)
		guestUploadFile(t, router, created.Token, "guest-share-password",
			subID, "same.txt", fmt.Sprintf("guest-content-%d", i), resume)
	}
	page := publicFolderChildrenTestRequest(t, router, created.Token, "guest-share-password", subID, 0, http.StatusOK)
	if len(page.Items) != 3 { t.Fatalf("unlimited share upload files=%d want 3", len(page.Items)) }
	for _, item := range page.Items {
		if item.Name == "" || item.Type != meta.NodeTypeFile { t.Fatalf("unexpected shared result %+v", item) }
	}
	// Every new file is owned by the original Owner and immediately Share-visible.
	var count int64
	if err := db.Model(&meta.Node{}).Where(
		"owner_id = ? AND parent_id = ? AND type = ? AND deleted_at IS NULL",
		root.OwnerID, subID, meta.NodeTypeFile).Count(&count).Error; err != nil { t.Fatal(err) }
	if count != 3 { t.Fatalf("visible owner files=%d", count) }

	// Session IDs must never authorize a different link or an Owner endpoint.
	secondRes := request(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/shares", shared.ID), ownerToken,
		strings.NewReader(`{"access":"view_upload"}`), http.StatusCreated)
	var second createdShareDTO
	if err := json.Unmarshal(secondRes.Body.Bytes(), &second); err != nil { t.Fatal(err) }
	newBody := []byte(fmt.Sprintf(
		`{"parent_id":%d,"name":"blocked.bin","size":1,"chunk_size":8388608,"conflict_policy":"keep_both","resume_key":"ps1_%064x"}`,
		subID, 99))
	opened := guestUploadRequest(t, router, http.MethodPost, "/api/v1/public/share/uploads",
		created.Token, "guest-share-password", newBody, http.StatusCreated, nil)
	sessionID := opened["id"].(string)
	guestUploadRequest(t, router, http.MethodGet, "/api/v1/public/share/uploads/"+sessionID,
		second.Token, "", []byte{}, http.StatusNotFound, nil)
	request(t, router, http.MethodGet, "/api/v1/uploads/"+sessionID, "", nil, http.StatusUnauthorized)

	// Downgrading the existing link blocks an unfinished upload, without
	// rolling back files already finalized or changing the raw share token.
	request(t, router, http.MethodPatch, updatePath, ownerToken,
		strings.NewReader(`{"access":"read_only","expires_at":null}`), http.StatusOK)
	guestUploadRequest(t, router, http.MethodPost,
		"/api/v1/public/share/uploads/"+sessionID+"/finalize",
		created.Token, "guest-share-password", []byte("{}"), http.StatusForbidden, nil)
	// Restoring upload grants does not resurrect a revoked link.
	request(t, router, http.MethodDelete, updatePath, ownerToken, nil, http.StatusNoContent)
	guestUploadRequest(t, router, http.MethodPost,
		"/api/v1/public/share/directories", created.Token, "guest-share-password",
		[]byte(`{"name":"after-revoke"}`), http.StatusGone, nil)

	_ = time.Second
}
