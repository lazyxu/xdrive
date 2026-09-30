package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestMediaGalleryIndexesOrdinaryFilesWithoutSourceMembership(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(
		&meta.MediaMetadata{},
		&meta.SourceCollectionItem{},
		&meta.SourceCollection{},
		&meta.SourceItem{},
		&meta.Source{},
		&meta.AuditEvent{},
		&meta.Share{},
		&meta.UploadPart{},
		&meta.UploadSession{},
		&meta.ContentDigestAlias{},
		&meta.ContentBlob{},
		&meta.FileVersion{},
		&meta.File{},
		&meta.Node{},
		&meta.RefreshToken{},
		&meta.User{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{},
		&meta.RefreshToken{},
		&meta.Node{},
		&meta.File{},
		&meta.FileVersion{},
		&meta.ContentBlob{},
		&meta.ContentDigestAlias{},
		&meta.Share{},
		&meta.UploadSession{},
		&meta.UploadPart{},
		&meta.AuditEvent{},
		&meta.Source{},
		&meta.SourceItem{},
		&meta.SourceCollection{},
		&meta.SourceCollectionItem{},
		&meta.MediaMetadata{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name
		 ON xd_nodes(owner_id, parent_id, lower(name))
		 WHERE parent_id IS NOT NULL AND deleted_at IS NULL`,
	).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_root_owner
		 ON xd_nodes(owner_id) WHERE parent_id IS NULL`,
	).Error; err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB:             db,
		Store:          store,
		Auth:           auth.New("media-integration-secret", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: 10 << 20,
	}
	router := server.Router()

	token := createTestUser(
		t,
		db,
		router,
		"media-user",
		"password-media",
	)
	root := requestNode(
		t,
		router,
		http.MethodGet,
		"/api/v1/nodes/root",
		token,
		nil,
		http.StatusOK,
	)
	folder := requestNode(
		t,
		router,
		http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID),
		token,
		strings.NewReader(`{"name":"Camera Uploads"}`),
		http.StatusCreated,
	)

	firstPNG := testPNG(t, 3, 2)
	file := uploadTestFile(
		t,
		router,
		token,
		folder.ID,
		"ordinary-upload.png",
		string(firstPNG),
	)

	var sourceItemCount int64
	if err := db.Model(&meta.SourceItem{}).Count(&sourceItemCount).Error; err != nil {
		t.Fatal(err)
	}
	if sourceItemCount != 0 {
		t.Fatalf("source item count=%d want=0", sourceItemCount)
	}

	itemsResponse := request(
		t,
		router,
		http.MethodGet,
		"/api/v1/media/items?limit=100",
		token,
		nil,
		http.StatusOK,
	)
	var items []mediaItemDTO
	if err := json.Unmarshal(itemsResponse.Body.Bytes(), &items); err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Node.ID != file.ID {
		t.Fatalf("media items=%+v", items)
	}
	if items[0].Metadata.MediaKind != meta.MediaKindImage ||
		items[0].Metadata.Width != 3 ||
		items[0].Metadata.Height != 2 ||
		items[0].Metadata.IndexState != meta.MediaIndexStateReady ||
		!items[0].Metadata.HasThumbnail {
		t.Fatalf("metadata=%+v", items[0].Metadata)
	}

	albumsResponse := request(
		t,
		router,
		http.MethodGet,
		"/api/v1/media/albums",
		token,
		nil,
		http.StatusOK,
	)
	var albums []mediaAlbumDTO
	if err := json.Unmarshal(albumsResponse.Body.Bytes(), &albums); err != nil {
		t.Fatal(err)
	}
	folderAlbumID := fmt.Sprintf("folder:%d", folder.ID)
	var folderAlbum *mediaAlbumDTO
	for index := range albums {
		if albums[index].ID == folderAlbumID {
			folderAlbum = &albums[index]
			break
		}
	}
	if folderAlbum == nil ||
		folderAlbum.Kind != "folder" ||
		folderAlbum.ItemCount != 1 ||
		folderAlbum.CoverNodeID == nil ||
		*folderAlbum.CoverNodeID != file.ID {
		t.Fatalf("folder album=%+v albums=%+v", folderAlbum, albums)
	}

	albumItemsResponse := request(
		t,
		router,
		http.MethodGet,
		"/api/v1/media/albums/"+
			url.PathEscape(folderAlbumID)+
			"/items?limit=100",
		token,
		nil,
		http.StatusOK,
	)
	var albumItems []mediaItemDTO
	if err := json.Unmarshal(albumItemsResponse.Body.Bytes(), &albumItems); err != nil {
		t.Fatal(err)
	}
	if len(albumItems) != 1 || albumItems[0].Node.ID != file.ID {
		t.Fatalf("album items=%+v", albumItems)
	}

	thumbnailResponse := request(
		t,
		router,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/thumbnail", file.ID),
		token,
		nil,
		http.StatusOK,
	)
	if contentType := thumbnailResponse.Header().Get("Content-Type"); contentType != "image/jpeg" {
		t.Fatalf("thumbnail content-type=%q", contentType)
	}
	thumbnailConfig, err := jpeg.DecodeConfig(
		bytes.NewReader(thumbnailResponse.Body.Bytes()),
	)
	if err != nil {
		t.Fatal(err)
	}
	if thumbnailConfig.Width != 3 || thumbnailConfig.Height != 2 {
		t.Fatalf(
			"thumbnail dimensions=%dx%d",
			thumbnailConfig.Width,
			thumbnailConfig.Height,
		)
	}

	var nodeCount, fileCount int64
	if err := db.Model(&meta.Node{}).Count(&nodeCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.File{}).Count(&fileCount).Error; err != nil {
		t.Fatal(err)
	}
	if nodeCount != 3 || fileCount != 1 {
		t.Fatalf(
			"thumbnail duplicated entity file: nodes=%d files=%d",
			nodeCount,
			fileCount,
		)
	}

	secondPNG := testPNG(t, 5, 4)
	updated := requestNodeWithHeaders(
		t,
		router,
		http.MethodPut,
		fmt.Sprintf("/api/v1/files/%d/content", file.ID),
		token,
		strings.NewReader(string(secondPNG)),
		http.StatusOK,
		map[string]string{
			"If-Match": fmt.Sprintf("\"%d\"", file.Revision),
		},
	)
	if updated.Revision <= file.Revision {
		t.Fatalf(
			"updated revision=%d old=%d",
			updated.Revision,
			file.Revision,
		)
	}

	detailResponse := request(
		t,
		router,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d", file.ID),
		token,
		nil,
		http.StatusOK,
	)
	var detail mediaItemDTO
	if err := json.Unmarshal(detailResponse.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	if detail.Metadata.Width != 5 || detail.Metadata.Height != 4 {
		t.Fatalf("reindexed metadata=%+v", detail.Metadata)
	}

	var persisted meta.MediaMetadata
	if err := db.First(&persisted, file.ID).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.NodeRevision != updated.Revision ||
		persisted.Width != 5 ||
		persisted.Height != 4 {
		t.Fatalf("persisted metadata=%+v", persisted)
	}
}

func testPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(
				x,
				y,
				color.NRGBA{
					R: uint8((x + 1) * 31),
					G: uint8((y + 1) * 47),
					B: 120,
					A: 255,
				},
			)
		}
	}
	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}
