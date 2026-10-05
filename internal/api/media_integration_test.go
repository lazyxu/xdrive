package api

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/binary"
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
	mediapkg "github.com/lazyxu/xdrive/internal/media"
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
		&meta.PhotoCollectionAsset{},
		&meta.PhotoCollection{},
		&meta.PhotoMetadata{},
		&meta.PhotoResource{},
		&meta.PhotoAsset{},
		&meta.MediaGroupItem{},
		&meta.MediaGroup{},
		&meta.MediaDerivedResource{},
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
		&meta.MediaDerivedResource{},
		&meta.MediaGroup{},
		&meta.MediaGroupItem{},
		&meta.PhotoAsset{},
		&meta.PhotoResource{},
		&meta.PhotoMetadata{},
		&meta.PhotoCollection{},
		&meta.PhotoCollectionAsset{},
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
	if items[0].AssetKind != meta.PhotoAssetKindImage ||
		len(items[0].Resources) != 1 ||
		items[0].Resources[0].Role != meta.PhotoResourceRolePrimary ||
		items[0].Resources[0].NodeID != file.ID {
		t.Fatalf("ordinary photo asset=%+v", items[0])
	}

	descriptionResponse := request(
		t,
		router,
		http.MethodPatch,
		fmt.Sprintf("/api/v1/media/items/%d/description", file.ID),
		token,
		strings.NewReader(`{"description":"  Marina Bay sunset\r\nTrip note  "}`),
		http.StatusOK,
	)
	var description mediaDescriptionDTO
	if err := json.Unmarshal(descriptionResponse.Body.Bytes(), &description); err != nil {
		t.Fatal(err)
	}
	if description.Description != "Marina Bay sunset\nTrip note" {
		t.Fatalf("description=%q", description.Description)
	}

	favoriteResponse := request(
		t,
		router,
		http.MethodPatch,
		fmt.Sprintf("/api/v1/media/items/%d/favorite", file.ID),
		token,
		strings.NewReader(`{"favorite":true}`),
		http.StatusOK,
	)
	var favorite mediaFavoriteDTO
	if err := json.Unmarshal(favoriteResponse.Body.Bytes(), &favorite); err != nil {
		t.Fatal(err)
	}
	if !favorite.Favorite {
		t.Fatalf("favorite response=%+v", favorite)
	}
	favoriteItemsResponse := request(
		t,
		router,
		http.MethodGet,
		"/api/v1/media/items?favorite=true&limit=100",
		token,
		nil,
		http.StatusOK,
	)
	var favoriteItems []mediaItemDTO
	if err := json.Unmarshal(favoriteItemsResponse.Body.Bytes(), &favoriteItems); err != nil {
		t.Fatal(err)
	}
	if len(favoriteItems) != 1 ||
		favoriteItems[0].Node.ID != file.ID ||
		!favoriteItems[0].Favorite {
		t.Fatalf("favorite items=%+v", favoriteItems)
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

	analysisPreviewResponse := request(
		t,
		router,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/analysis-preview", file.ID),
		token,
		nil,
		http.StatusOK,
	)
	if contentType := analysisPreviewResponse.Header().Get("Content-Type"); contentType != "image/jpeg" {
		t.Fatalf("analysis preview content-type=%q", contentType)
	}
	if got := analysisPreviewResponse.Header().Get("X-XDrive-Analysis-Preview-Version"); got != fmt.Sprint(mediapkg.AnalysisPreviewVersion) {
		t.Fatalf("analysis preview version=%q", got)
	}
	if got := analysisPreviewResponse.Header().Get("X-XDrive-Analysis-Preview-Edge"); got != fmt.Sprint(mediapkg.AnalysisPreviewEdge) {
		t.Fatalf("analysis preview edge=%q", got)
	}
	analysisETag := analysisPreviewResponse.Header().Get("ETag")
	if analysisETag == "" {
		t.Fatal("analysis preview ETag is empty")
	}
	analysisConfig, err := jpeg.DecodeConfig(
		bytes.NewReader(analysisPreviewResponse.Body.Bytes()),
	)
	if err != nil {
		t.Fatal(err)
	}
	if analysisConfig.Width != 3 || analysisConfig.Height != 2 {
		t.Fatalf(
			"analysis preview dimensions=%dx%d",
			analysisConfig.Width,
			analysisConfig.Height,
		)
	}
	cachedAnalysisPreview := request(
		t,
		router,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/analysis-preview", file.ID),
		token,
		nil,
		http.StatusOK,
	)
	if cachedAnalysisPreview.Header().Get("ETag") != analysisETag ||
		!bytes.Equal(cachedAnalysisPreview.Body.Bytes(), analysisPreviewResponse.Body.Bytes()) {
		t.Fatal("analysis preview cache response changed")
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
			"media preview duplicated entity file: nodes=%d files=%d",
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
	if detail.Description != "Marina Bay sunset\nTrip note" {
		t.Fatalf("reindexed description=%q", detail.Description)
	}
	if !detail.Favorite {
		t.Fatalf("favorite was lost after media re-index: %+v", detail)
	}

	updatedAnalysisPreview := request(
		t,
		router,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/analysis-preview", file.ID),
		token,
		nil,
		http.StatusOK,
	)
	if updatedAnalysisPreview.Header().Get("ETag") == analysisETag {
		t.Fatal("analysis preview ETag did not change after file overwrite")
	}
	updatedAnalysisConfig, err := jpeg.DecodeConfig(
		bytes.NewReader(updatedAnalysisPreview.Body.Bytes()),
	)
	if err != nil {
		t.Fatal(err)
	}
	if updatedAnalysisConfig.Width != 5 || updatedAnalysisConfig.Height != 4 {
		t.Fatalf(
			"updated analysis preview dimensions=%dx%d",
			updatedAnalysisConfig.Width,
			updatedAnalysisConfig.Height,
		)
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

	const liveIdentifier = "F187F3A1-0625-4908-AE8C-A83B037E06B0"
	livpBytes, stillBytes, motionBytes := testLIVPResourceArchive(t, liveIdentifier)
	liveNode := uploadTestFile(
		t,
		router,
		token,
		folder.ID,
		"IMG_0002.livp",
		string(livpBytes),
	)

	liveDetailResponse := request(
		t,
		router,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d", liveNode.ID),
		token,
		nil,
		http.StatusOK,
	)
	var liveDetail mediaItemDTO
	if err := json.Unmarshal(liveDetailResponse.Body.Bytes(), &liveDetail); err != nil {
		t.Fatal(err)
	}
	if liveDetail.Metadata.MediaKind != meta.MediaKindImage ||
		liveDetail.Metadata.ContainerKind != "livp" ||
		liveDetail.Metadata.LivePhotoAssetIdentifier != liveIdentifier ||
		liveDetail.AssetKind != meta.PhotoAssetKindLivePhoto ||
		len(liveDetail.Resources) != 3 ||
		len(liveDetail.DerivedResources) != 2 ||
		!liveDetail.LivePhoto {
		t.Fatalf("livp detail=%+v", liveDetail)
	}

	stillResponse := request(
		t,
		router,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/resources/%s", liveNode.ID, meta.MediaDerivedResourceRoleStill),
		token,
		nil,
		http.StatusOK,
	)
	if !bytes.Equal(stillResponse.Body.Bytes(), stillBytes) {
		t.Fatal("livp still resource bytes changed")
	}
	if got := stillResponse.Header().Get("Content-Type"); got != "image/jpeg" {
		t.Fatalf("livp still content-type=%q", got)
	}

	motionResponse := request(
		t,
		router,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/resources/%s", liveNode.ID, meta.MediaDerivedResourceRoleMotion),
		token,
		nil,
		http.StatusOK,
	)
	if !bytes.Equal(motionResponse.Body.Bytes(), motionBytes) {
		t.Fatal("livp motion resource bytes changed")
	}
	if got := motionResponse.Header().Get("Content-Type"); got != "video/quicktime" {
		t.Fatalf("livp motion content-type=%q", got)
	}

	liveThumbnail := request(
		t,
		router,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/thumbnail", liveNode.ID),
		token,
		nil,
		http.StatusOK,
	)
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(liveThumbnail.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Width != 2 || cfg.Height != 2 {
		t.Fatalf("livp thumbnail dimensions=%dx%d", cfg.Width, cfg.Height)
	}

	liveAnalysisPreview := request(
		t,
		router,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/analysis-preview", liveNode.ID),
		token,
		nil,
		http.StatusOK,
	)
	liveAnalysisConfig, err := jpeg.DecodeConfig(
		bytes.NewReader(liveAnalysisPreview.Body.Bytes()),
	)
	if err != nil {
		t.Fatal(err)
	}
	if liveAnalysisConfig.Width != 2 || liveAnalysisConfig.Height != 2 {
		t.Fatalf(
			"livp analysis preview dimensions=%dx%d",
			liveAnalysisConfig.Width,
			liveAnalysisConfig.Height,
		)
	}

	var resourceCount int64
	if err := db.Model(&meta.MediaDerivedResource{}).
		Where("node_id = ?", liveNode.ID).
		Count(&resourceCount).Error; err != nil {
		t.Fatal(err)
	}
	if resourceCount != 2 {
		t.Fatalf("livp derived resource count=%d want=2", resourceCount)
	}

	unifiedMotionResponse := request(
		t,
		router,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/live-photo-motion", liveNode.ID),
		token,
		nil,
		http.StatusOK,
	)
	if !bytes.Equal(unifiedMotionResponse.Body.Bytes(), motionBytes) {
		t.Fatal("unified LIVP motion bytes changed")
	}

	pairFolder := requestNode(
		t,
		router,
		http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID),
		token,
		strings.NewReader(`{"name":"Standalone Live Photo"}`),
		http.StatusCreated,
	)
	const pairIdentifier = "C48E67A7-589A-4AC3-8D59-E20AA7959225"
	pairStillBytes := testLIVPJPEG(t, pairIdentifier)
	pairMotionBytes := testLIVPMOV(pairIdentifier)
	pairStill := uploadTestFile(
		t, router, token, pairFolder.ID, "IMG_1000.jpg", string(pairStillBytes),
	)
	pairMotion := uploadTestFile(
		t, router, token, pairFolder.ID, "IMG_1000.mov", string(pairMotionBytes),
	)
	request(
		t,
		router,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/analysis-preview", pairMotion.ID),
		token,
		nil,
		http.StatusUnsupportedMediaType,
	)

	pairItemsResponse := request(
		t,
		router,
		http.MethodGet,
		"/api/v1/media/albums/"+
			url.PathEscape(fmt.Sprintf("folder:%d", pairFolder.ID))+
			"/items?limit=100",
		token,
		nil,
		http.StatusOK,
	)
	var pairItems []mediaItemDTO
	if err := json.Unmarshal(pairItemsResponse.Body.Bytes(), &pairItems); err != nil {
		t.Fatal(err)
	}
	if len(pairItems) != 1 ||
		pairItems[0].Node.ID != pairStill.ID ||
		pairItems[0].AssetKind != meta.PhotoAssetKindLivePhoto ||
		len(pairItems[0].Resources) != 2 ||
		!pairItems[0].LivePhoto {
		t.Fatalf("standalone live photo Gallery items=%+v", pairItems)
	}
	if pairItems[0].Node.ID == pairMotion.ID {
		t.Fatal("paired motion appeared as a Gallery item")
	}

	pairAlbumsResponse := request(
		t,
		router,
		http.MethodGet,
		"/api/v1/media/albums",
		token,
		nil,
		http.StatusOK,
	)
	var pairAlbums []mediaAlbumDTO
	if err := json.Unmarshal(pairAlbumsResponse.Body.Bytes(), &pairAlbums); err != nil {
		t.Fatal(err)
	}
	pairAlbumID := fmt.Sprintf("folder:%d", pairFolder.ID)
	foundPairAlbum := false
	for _, album := range pairAlbums {
		if album.ID == pairAlbumID {
			foundPairAlbum = true
			if album.ItemCount != 1 {
				t.Fatalf("standalone live photo album item_count=%d want=1", album.ItemCount)
			}
		}
	}
	if !foundPairAlbum {
		t.Fatal("standalone live photo folder album missing")
	}

	pairMotionResponse := request(
		t,
		router,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/live-photo-motion", pairStill.ID),
		token,
		nil,
		http.StatusOK,
	)
	if !bytes.Equal(pairMotionResponse.Body.Bytes(), pairMotionBytes) {
		t.Fatal("standalone live photo motion bytes changed")
	}

	var pairGroup meta.MediaGroup
	if err := db.
		Table("xd_media_groups AS mg").
		Joins("JOIN xd_media_group_items AS mgi ON mgi.group_id = mg.id").
		Where("mgi.node_id = ? AND mg.kind = ?", pairStill.ID, meta.MediaGroupKindLivePhoto).
		First(&pairGroup).Error; err != nil {
		t.Fatal(err)
	}
	var pairStillNode meta.Node
	if err := db.First(&pairStillNode, pairStill.ID).Error; err != nil {
		t.Fatal(err)
	}
	corruptMember := meta.Node{
		ParentID: pairStillNode.ParentID,
		Name:     "corrupt-extra-member.bin",
		Type:     meta.NodeTypeFile,
		OwnerID:  pairStillNode.OwnerID,
		Revision: 1,
	}
	if err := db.Create(&corruptMember).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.MediaGroupItem{
		GroupID: pairGroup.ID,
		NodeID:  corruptMember.ID,
		Role:    meta.MediaGroupRoleAuxiliary,
		Ordinal: 2,
	}).Error; err != nil {
		t.Fatal(err)
	}

	validStillIDs, err := server.validLivePhotoStillNodeIDs(
		context.Background(),
		pairStillNode.OwnerID,
		[]uint64{pairStill.ID},
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := validStillIDs[pairStill.ID]; ok {
		t.Fatal("corrupt three-member Live Photo group was accepted")
	}

	corruptPairItemsResponse := request(
		t,
		router,
		http.MethodGet,
		"/api/v1/media/albums/"+
			url.PathEscape(fmt.Sprintf("folder:%d", pairFolder.ID))+
			"/items?limit=100",
		token,
		nil,
		http.StatusOK,
	)
	var corruptPairItems []mediaItemDTO
	if err := json.Unmarshal(corruptPairItemsResponse.Body.Bytes(), &corruptPairItems); err != nil {
		t.Fatal(err)
	}
	if len(corruptPairItems) != 2 {
		t.Fatalf("corrupt Live Photo group hid a Gallery item: %+v", corruptPairItems)
	}
	for _, item := range corruptPairItems {
		if item.LivePhoto {
			t.Fatalf("corrupt Live Photo group marked item live: %+v", item)
		}
	}

	request(
		t,
		router,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/live-photo-motion", pairStill.ID),
		token,
		nil,
		http.StatusNotFound,
	)
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

func testLIVPResourceArchive(t *testing.T, identifier string) (archive, still, motion []byte) {
	t.Helper()
	still = testLIVPJPEG(t, identifier)
	motion = testLIVPMOV(identifier)

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, entry := range []struct {
		name string
		data []byte
	}{
		{name: "IMG_0002.HEIC.jpeg", data: still},
		{name: "IMG_0002.HEIC.mov", data: motion},
	} {
		writer, err := zw.CreateHeader(&zip.FileHeader{Name: entry.name, Method: zip.Store})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write(entry.data); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes(), still, motion
}

func testLIVPJPEG(t *testing.T, identifier string) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 2; x++ {
			img.Set(x, y, color.NRGBA{R: 80, G: 120, B: 160, A: 255})
		}
	}
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	base := encoded.Bytes()
	tiff := testLIVPTIFF(testLIVPMakerNote(identifier))
	payload := append([]byte("Exif\x00\x00"), tiff...)
	app1 := []byte{0xff, 0xe1, 0, 0}
	binary.BigEndian.PutUint16(app1[2:4], uint16(len(payload)+2))
	app1 = append(app1, payload...)

	out := make([]byte, 0, len(base)+len(app1))
	out = append(out, base[:2]...)
	out = append(out, app1...)
	out = append(out, base[2:]...)
	return out
}

func testLIVPMakerNote(identifier string) []byte {
	note := append([]byte{}, []byte("Apple iOS\x00")...)
	note = append(note, 0x00, 0x01, 'M', 'M')
	dirOffset := len(note)
	note = append(note, 0x00, 0x01)
	entry := make([]byte, 12)
	binary.BigEndian.PutUint16(entry[0:2], 0x0011)
	binary.BigEndian.PutUint16(entry[2:4], 2)
	binary.BigEndian.PutUint32(entry[4:8], uint32(len(identifier)+1))
	binary.BigEndian.PutUint32(entry[8:12], uint32(dirOffset+2+12+4))
	note = append(note, entry...)
	note = append(note, 0, 0, 0, 0)
	note = append(note, []byte(identifier)...)
	note = append(note, 0)
	return note
}

func testLIVPTIFF(note []byte) []byte {
	data := []byte{'M', 'M', 0, 42, 0, 0, 0, 8}
	root := make([]byte, 2+12+4)
	binary.BigEndian.PutUint16(root[0:2], 1)
	binary.BigEndian.PutUint16(root[2:4], 0x8769)
	binary.BigEndian.PutUint16(root[4:6], 4)
	binary.BigEndian.PutUint32(root[6:10], 1)
	binary.BigEndian.PutUint32(root[10:14], uint32(len(data)+len(root)))
	data = append(data, root...)

	exif := make([]byte, 2+12+4)
	binary.BigEndian.PutUint16(exif[0:2], 1)
	binary.BigEndian.PutUint16(exif[2:4], 0x927c)
	binary.BigEndian.PutUint16(exif[4:6], 7)
	binary.BigEndian.PutUint32(exif[6:10], uint32(len(note)))
	binary.BigEndian.PutUint32(exif[10:14], uint32(len(data)+len(exif)))
	data = append(data, exif...)
	data = append(data, note...)
	return data
}

func testLIVPMOV(identifier string) []byte {
	ftyp := testLIVPBox([]byte("ftyp"), append([]byte("qt  "), make([]byte, 8)...))
	key := []byte("com.apple.quicktime.content.identifier")
	entry := make([]byte, 8+len(key))
	binary.BigEndian.PutUint32(entry[0:4], uint32(len(entry)))
	copy(entry[4:8], []byte("mdta"))
	copy(entry[8:], key)

	keysPayload := make([]byte, 8)
	binary.BigEndian.PutUint32(keysPayload[4:8], 1)
	keys := testLIVPBox([]byte("keys"), append(keysPayload, entry...))

	dataPayload := make([]byte, 8)
	binary.BigEndian.PutUint32(dataPayload[0:4], 1)
	data := testLIVPBox([]byte("data"), append(dataPayload, []byte(identifier)...))
	item := testLIVPBox([]byte{0, 0, 0, 1}, data)
	ilst := testLIVPBox([]byte("ilst"), item)

	metaPayload := make([]byte, 4)
	metaPayload = append(metaPayload, keys...)
	metaPayload = append(metaPayload, ilst...)
	return append(ftyp, testLIVPBox([]byte("moov"), testLIVPBox([]byte("meta"), metaPayload))...)
}

func testLIVPBox(boxType []byte, payload []byte) []byte {
	out := make([]byte, 8+len(payload))
	binary.BigEndian.PutUint32(out[0:4], uint32(len(out)))
	copy(out[4:8], boxType)
	copy(out[8:], payload)
	return out
}
