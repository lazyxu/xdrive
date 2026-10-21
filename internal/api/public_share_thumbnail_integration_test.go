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

func TestPublicShareCachedThumbnailScopeAndCancelLifecycle(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	base, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "sharethumb_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := base.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = base.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
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
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{},
		&meta.Share{}, &meta.MediaMetadata{}); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{DB: db, Store: store, Auth: auth.New("public-cached-thumbnail-test", time.Hour)}
	router := srv.Router()
	owner := meta.User{Username: "cached-thumb-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	other := meta.User{Username: "cached-thumb-other", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	for _, item := range []*meta.User{&owner, &other} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	root := meta.Node{OwnerID: owner.ID, Type: meta.NodeTypeDir, Name: "/", Revision: 1}
	otherRoot := meta.Node{OwnerID: other.ID, Type: meta.NodeTypeDir, Name: "/", Revision: 1}
	for _, item := range []*meta.Node{&root, &otherRoot} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	album := meta.Node{OwnerID: owner.ID, ParentID: &root.ID, Type: meta.NodeTypeDir,
		Name: "public-album", Revision: 1}
	if err := db.Create(&album).Error; err != nil {
		t.Fatal(err)
	}
	var original, cached bytes.Buffer
	if err := jpeg.Encode(&original, image.NewRGBA(image.Rect(0, 0, 16, 16)), nil); err != nil {
		t.Fatal(err)
	}
	if err := jpeg.Encode(&cached, image.NewRGBA(image.Rect(0, 0, 8, 8)), nil); err != nil {
		t.Fatal(err)
	}
	createFile := func(userID, parentID uint64, name string) meta.Node {
		t.Helper()
		node := meta.Node{OwnerID: userID, ParentID: &parentID, Type: meta.NodeTypeFile,
			Name: name, Revision: 1}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		key := fmt.Sprintf("thumbnail-test/source/%d", node.ID)
		if _, err := store.Put(t.Context(), key, bytes.NewReader(original.Bytes())); err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(original.Bytes())
		file := meta.File{NodeID: node.ID, StorageKey: key,
			Size: int64(original.Len()), SHA256: fmt.Sprintf("%x", digest)}
		if err := db.Create(&file).Error; err != nil {
			t.Fatal(err)
		}
		row := meta.MediaMetadata{NodeID: node.ID, OwnerID: userID, NodeRevision: node.Revision,
			SHA256: file.SHA256, MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			IndexState: meta.MediaIndexStateReady}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := store.Put(t.Context(), mediaThumbnailStorageKey(node, row),
			bytes.NewReader(cached.Bytes())); err != nil {
			t.Fatal(err)
		}
		return node
	}
	imageNode := createFile(owner.ID, album.ID, "thumb.jpg")
	outsideNode := createFile(owner.ID, root.ID, "outside.jpg")
	foreignNode := createFile(other.ID, otherRoot.ID, "other.jpg")
	passwordHash, err := auth.HashPassword("correct-password")
	if err != nil {
		t.Fatal(err)
	}
	shareToken := "only-album-thumbnail-share"
	share := meta.Share{OwnerID: owner.ID, NodeID: album.ID,
		TokenHash: hashShareToken(shareToken), PasswordHash: passwordHash, MaxDownloads: 3}
	if err := db.Create(&share).Error; err != nil {
		t.Fatal(err)
	}
	ticketRequest := func(token, password string, nodeID, revision uint64, want int) publicShareThumbnailTicketDTO {
		t.Helper()
		body := fmt.Sprintf("{\"password\":%q,\"node_id\":%d,\"revision\":%d}",
			password, nodeID, revision)
		res := requestWithHeaders(t, router, http.MethodPost,
			"/api/v1/public/share/thumbnail-ticket", "", strings.NewReader(body),
			want, map[string]string{"X-XDrive-Share-Token": token})
		if want != http.StatusOK {
			return publicShareThumbnailTicketDTO{}
		}
		var dto publicShareThumbnailTicketDTO
		if err := json.Unmarshal(res.Body.Bytes(), &dto); err != nil {
			t.Fatal(err)
		}
		if dto.MIMEType != "image/jpeg" || dto.ExpiresAt.Before(time.Now()) ||
			!strings.HasPrefix(dto.URL, fmt.Sprintf("/api/v1/public-share-thumbnail/%d?ticket=", share.ID)) ||
			strings.Contains(dto.URL, shareToken) {
			t.Fatalf("invalid private-scoped thumbnail ticket %+v", dto)
		}
		return dto
	}
	ticketRequest(shareToken, "bad", imageNode.ID, 1, http.StatusUnauthorized)
	ticketRequest(shareToken, "correct-password", outsideNode.ID, 1, http.StatusNotFound)
	ticketRequest(shareToken, "correct-password", foreignNode.ID, 1, http.StatusNotFound)
	ticketRequest(shareToken, "correct-password", imageNode.ID, 2, http.StatusConflict)
	receipt := ticketRequest(shareToken, "correct-password", imageNode.ID, 1, http.StatusOK)
	res := request(t, router, http.MethodGet, receipt.URL, "", nil, http.StatusOK)
	if !bytes.Equal(res.Body.Bytes(), cached.Bytes()) ||
		bytes.Equal(res.Body.Bytes(), original.Bytes()) ||
		res.Header().Get("Content-Type") != "image/jpeg" ||
		res.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("public thumbnail served an original or invalid cache bytes")
	}
	request(t, router, http.MethodHead, receipt.URL, "", nil, http.StatusOK)
	request(t, router, http.MethodGet,
		strings.Replace(receipt.URL, "public-share-thumbnail", "public-share-preview", 1),
		"", nil, http.StatusUnauthorized)
	var reloaded meta.Share
	if err := db.First(&reloaded, share.ID).Error; err != nil || reloaded.DownloadCount != 0 {
		t.Fatalf("thumbnail must not consume public original download quota %+v: %v", reloaded, err)
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
	// A cached derivative tied to revision 1 is never served after revision 2.
	ticketRequest(shareToken, "correct-password", imageNode.ID, 2, http.StatusNotFound)
	now := time.Now()
	if err := db.Model(&meta.Share{}).Where("id = ?", share.ID).
		Update("revoked_at", &now).Error; err != nil {
		t.Fatal(err)
	}
	ticketRequest(shareToken, "correct-password", imageNode.ID, 2, http.StatusGone)
}
