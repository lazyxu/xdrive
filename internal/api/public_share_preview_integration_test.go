package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPublicShareScopedImagePreviewAndRevocation(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "sharepreview_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = baseDB.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{}, &meta.Share{}); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{DB: db, Store: store, Auth: auth.New("share-preview-integration-test-key", time.Hour)}
	router := server.Router()
	owner := meta.User{Username: "image-share-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	other := meta.User{Username: "image-share-other", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{OwnerID: owner.ID, Type: meta.NodeTypeDir, Name: "/", Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	otherRoot := meta.Node{OwnerID: other.ID, Type: meta.NodeTypeDir, Name: "/", Revision: 1}
	if err := db.Create(&otherRoot).Error; err != nil {
		t.Fatal(err)
	}
	album := meta.Node{
		OwnerID: owner.ID, ParentID: &root.ID,
		Type: meta.NodeTypeDir, Name: "shared-album", Revision: 1,
	}
	if err := db.Create(&album).Error; err != nil {
		t.Fatal(err)
	}
	var original bytes.Buffer
	if err := jpeg.Encode(&original, image.NewRGBA(image.Rect(0, 0, 8, 8)), nil); err != nil {
		t.Fatal(err)
	}
	createFile := func(userID, parentID uint64, name, key string, body []byte) meta.Node {
		t.Helper()
		node := meta.Node{OwnerID: userID, ParentID: &parentID,
			Type: meta.NodeTypeFile, Name: name, Revision: 1}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := store.Put(t.Context(), key, bytes.NewReader(body)); err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(body)
		file := meta.File{NodeID: node.ID, StorageKey: key, Size: int64(len(body)), SHA256: fmt.Sprintf("%x", digest)}
		if err := db.Create(&file).Error; err != nil {
			t.Fatal(err)
		}
		return node
	}
	imageNode := createFile(owner.ID, album.ID, "public.jpg", "preview/public.jpg", original.Bytes())
	outsideNode := createFile(owner.ID, root.ID, "outside.jpg", "preview/outside.jpg", original.Bytes())
	privateNode := createFile(other.ID, otherRoot.ID, "other.jpg", "preview/other.jpg", original.Bytes())
	unsafeNode := createFile(owner.ID, album.ID, "active.jpg", "preview/fake.jpg",
		[]byte("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"))
	passwordHash, err := auth.HashPassword("correct-password")
	if err != nil {
		t.Fatal(err)
	}
	rawToken := "preview-folder-capability-token"
	share := meta.Share{
		OwnerID: owner.ID, NodeID: album.ID, TokenHash: hashShareToken(rawToken),
		PasswordHash: passwordHash, MaxDownloads: 2,
	}
	if err := db.Create(&share).Error; err != nil {
		t.Fatal(err)
	}
	ticketRequest := func(token, password string, nodeID uint64, want int) publicSharePreviewTicketDTO {
		t.Helper()
		body := fmt.Sprintf("{\"password\":%q,\"node_id\":%d}", password, nodeID)
		response := requestWithHeaders(t, router, http.MethodPost,
			"/api/v1/public/share/preview-ticket", "", strings.NewReader(body),
			want, map[string]string{"X-XDrive-Share-Token": token})
		if want != http.StatusOK {
			return publicSharePreviewTicketDTO{}
		}
		var receipt publicSharePreviewTicketDTO
		if err := json.Unmarshal(response.Body.Bytes(), &receipt); err != nil {
			t.Fatal(err)
		}
		if receipt.MIMEType != "image/jpeg" ||
			!strings.HasPrefix(receipt.URL, fmt.Sprintf("/api/v1/public-share-preview/%d?ticket=", share.ID)) ||
			strings.Contains(receipt.URL, rawToken) || !receipt.ExpiresAt.After(time.Now()) {
			t.Fatalf("bad scoped preview ticket %+v", receipt)
		}
		return receipt
	}
	ticketRequest(rawToken, "wrong", imageNode.ID, http.StatusUnauthorized)
	ticketRequest(rawToken, "correct-password", outsideNode.ID, http.StatusNotFound)
	ticketRequest(rawToken, "correct-password", privateNode.ID, http.StatusNotFound)
	ticketRequest(rawToken, "correct-password", unsafeNode.ID, http.StatusUnsupportedMediaType)
	ticketRequest(rawToken, "correct-password", 0, http.StatusBadRequest)
	receipt := ticketRequest(rawToken, "correct-password", imageNode.ID, http.StatusOK)
	response := request(t, router, http.MethodGet, receipt.URL, "", nil, http.StatusOK)
	if !bytes.Equal(response.Body.Bytes(), original.Bytes()) ||
		response.Header().Get("Content-Type") != "image/jpeg" ||
		response.Header().Get("X-Content-Type-Options") != "nosniff" ||
		response.Header().Get("Referrer-Policy") != "no-referrer" ||
		!strings.HasPrefix(response.Header().Get("Content-Disposition"), "inline;") {
		t.Fatal("shared preview did not stream only approved original image")
	}
	rangeResponse := requestWithHeaders(t, router, http.MethodGet, receipt.URL,
		"", nil, http.StatusPartialContent, map[string]string{"Range": "bytes=0-7"})
	if !bytes.Equal(rangeResponse.Body.Bytes(), original.Bytes()[:8]) {
		t.Fatal("image preview range bytes mismatch")
	}
	var reloaded meta.Share
	if err := db.First(&reloaded, share.ID).Error; err != nil || reloaded.DownloadCount != 0 {
		t.Fatalf("preview must not consume file download quota %+v err=%v", reloaded, err)
	}
	if err := db.Model(&meta.Node{}).Where("id = ?", imageNode.ID).
		Update("parent_id", root.ID).Error; err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodGet, receipt.URL, "", nil, http.StatusGone)
	if err := db.Model(&meta.Node{}).Where("id = ?", imageNode.ID).
		Updates(map[string]any{"parent_id": album.ID, "revision": 2}).Error; err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodGet, receipt.URL, "", nil, http.StatusGone)
	fresh := ticketRequest(rawToken, "correct-password", imageNode.ID, http.StatusOK)
	now := time.Now()
	if err := db.Model(&meta.Share{}).Where("id = ?", share.ID).
		Update("revoked_at", &now).Error; err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodGet, fresh.URL, "", nil, http.StatusGone)
	ticketRequest(rawToken, "correct-password", imageNode.ID, http.StatusGone)

	// Single-file share uses node_id=0, never requires an Owner session.
	fileToken := "single-image-public-capability"
	fileShare := meta.Share{OwnerID: owner.ID, NodeID: outsideNode.ID,
		TokenHash: hashShareToken(fileToken), MaxDownloads: 1}
	if err := db.Create(&fileShare).Error; err != nil {
		t.Fatal(err)
	}
	// For single-file shares any nonzero sibling ID is forbidden.
	ticketRequest(fileToken, "", imageNode.ID, http.StatusNotFound)
	singleRes := requestWithHeaders(t, router, http.MethodPost,
		"/api/v1/public/share/preview-ticket", "",
		strings.NewReader(`{"node_id":0}`), http.StatusOK,
		map[string]string{"X-XDrive-Share-Token": fileToken})
	var single publicSharePreviewTicketDTO
	if err := json.Unmarshal(singleRes.Body.Bytes(), &single); err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodGet, single.URL, "", nil, http.StatusOK)
	if err := db.Model(&meta.Share{}).Where("id = ?", fileShare.ID).
		Update("download_count", int64(1)).Error; err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodGet, single.URL, "", nil, http.StatusGone)
}
