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
	"github.com/lazyxu/xdrive/internal/background"
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
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	// This integration test exercises the real thumbnail/analysis-preview
	// scheduler. Cross-server derivative leases borrow dedicated SQL sessions,
	// so do not retain those sessions in an idle test pool after each request.
	sqlDB.SetMaxOpenConns(4)
	sqlDB.SetMaxIdleConns(0)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.Migrator().DropTable(
		&meta.PhotoCollectionAsset{},
		&meta.PhotoCollection{},
		&meta.PhotoMetadata{},
		&meta.PhotoResource{},
		&meta.PhotoAsset{}, &meta.PhotoEditRecipe{},
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
		&meta.PhotoAsset{}, &meta.PhotoEditRecipe{},
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
	mediaScheduler := background.NewScheduler(
		context.Background(),
		background.Config{
			Capacity: map[background.ResourceClass]int{
				background.ResourceMediaCPU: 2,
			},
			QueueCapacity: map[background.ResourceClass]int{
				background.ResourceMediaCPU: 64,
			},
		},
	)
	defer mediaScheduler.Close()
	server := &Server{
		DB:                  db,
		Store:               store,
		Auth:                auth.New("media-integration-secret", time.Hour),
		RefreshTTL:          24 * time.Hour,
		AllowedOrigin:       "http://localhost",
		MaxUploadBytes:      10 << 20,
		BackgroundScheduler: mediaScheduler,
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

	rangeResponse := request(
		t,
		router,
		http.MethodGet,
		"/api/v1/media/items?range=true&limit=1&offset=0",
		token,
		nil,
		http.StatusOK,
	)
	var itemRange mediaItemRangeDTO
	if err := json.Unmarshal(rangeResponse.Body.Bytes(), &itemRange); err != nil {
		t.Fatal(err)
	}
	if itemRange.TotalCount != 1 || itemRange.Offset != 0 || itemRange.Limit != 1 ||
		len(itemRange.Items) != 1 || itemRange.Items[0].Node.ID != file.ID ||
		len(itemRange.TimelineGroups) != 1 ||
		itemRange.TimelineGroups[0].Key != "unknown" ||
		itemRange.TimelineGroups[0].ItemCount != 1 ||
		itemRange.TimelineGroups[0].StartIndex != 0 {
		t.Fatalf("media item range=%+v", itemRange)
	}

	if err := db.Model(&meta.MediaMetadata{}).
		Where("node_id = ?", file.ID).
		Update("captured_at", time.Date(2026, 10, 5, 8, 30, 0, 0, time.UTC)).Error; err != nil {
		t.Fatal(err)
	}
	capturedRangeResponse := request(
		t,
		router,
		http.MethodGet,
		"/api/v1/media/items?range=true&limit=1&offset=0",
		token,
		nil,
		http.StatusOK,
	)
	itemRange = mediaItemRangeDTO{}
	if err := json.Unmarshal(capturedRangeResponse.Body.Bytes(), &itemRange); err != nil {
		t.Fatal(err)
	}
	if len(itemRange.TimelineGroups) != 1 ||
		itemRange.TimelineGroups[0].Key != "2026-10" ||
		itemRange.TimelineGroups[0].ItemCount != 1 ||
		itemRange.TimelineGroups[0].StartIndex != 0 {
		t.Fatalf("captured media timeline groups=%+v", itemRange.TimelineGroups)
	}
	if itemRange.TimelineGroupSets == nil ||
		len(itemRange.TimelineGroupSets.Year) != 1 ||
		itemRange.TimelineGroupSets.Year[0].Key != "2026" ||
		len(itemRange.TimelineGroupSets.Month) != 1 ||
		itemRange.TimelineGroupSets.Month[0].Key != "2026-10" ||
		len(itemRange.TimelineGroupSets.Day) != 1 ||
		itemRange.TimelineGroupSets.Day[0].Key != "2026-10-05" {
		t.Fatalf("captured media timeline group sets=%+v", itemRange.TimelineGroupSets)
	}

	batchFavoriteResponse := request(
		t,
		router,
		http.MethodPatch,
		"/api/v1/media/batch/favorite",
		token,
		strings.NewReader(fmt.Sprintf(`{"node_ids":[%d,%d],"favorite":true}`, file.ID, file.ID)),
		http.StatusOK,
	)
	var batchFavorite mediaBatchFavoriteDTO
	if err := json.Unmarshal(batchFavoriteResponse.Body.Bytes(), &batchFavorite); err != nil {
		t.Fatal(err)
	}
	if batchFavorite.Updated != 1 || !batchFavorite.Favorite {
		t.Fatalf("batch favorite=%+v", batchFavorite)
	}

	batchTagsResponse := request(
		t,
		router,
		http.MethodPost,
		"/api/v1/media/batch/tags",
		token,
		strings.NewReader(fmt.Sprintf(`{"node_ids":[%d],"tags":["Travel","family"]}`, file.ID)),
		http.StatusOK,
	)
	var batchTags mediaBatchTagsDTO
	if err := json.Unmarshal(batchTagsResponse.Body.Bytes(), &batchTags); err != nil {
		t.Fatal(err)
	}
	if batchTags.Updated != 1 || strings.Join(batchTags.Tags, "|") != "family|Travel" {
		t.Fatalf("batch tags=%+v", batchTags)
	}

	var batchAsset meta.PhotoAsset
	if err := db.Where("primary_node_id = ?", file.ID).
		First(&batchAsset).Error; err != nil {
		t.Fatal(err)
	}
	var batchMetadata meta.PhotoMetadata
	if err := db.First(&batchMetadata, "asset_id = ?", batchAsset.ID).Error; err != nil {
		t.Fatal(err)
	}
	storedTags, err := decodeMediaTags(batchMetadata.TagsJSON)
	if err != nil {
		t.Fatal(err)
	}
	if !batchMetadata.Favorite || strings.Join(storedTags, "|") != "family|Travel" {
		t.Fatalf("batch metadata favorite=%v tags=%v", batchMetadata.Favorite, storedTags)
	}

	emptyRangeResponse := request(
		t,
		router,
		http.MethodGet,
		"/api/v1/media/items?range=true&limit=1&offset=99",
		token,
		nil,
		http.StatusOK,
	)
	itemRange = mediaItemRangeDTO{}
	if err := json.Unmarshal(emptyRangeResponse.Body.Bytes(), &itemRange); err != nil {
		t.Fatal(err)
	}
	if itemRange.TotalCount != 1 || itemRange.Offset != 99 || itemRange.Limit != 1 ||
		len(itemRange.Items) != 0 || len(itemRange.TimelineGroups) != 0 {
		t.Fatalf("empty media item range=%+v", itemRange)
	}

	request(
		t,
		router,
		http.MethodGet,
		"/api/v1/media/items?range=maybe&limit=1",
		token,
		nil,
		http.StatusBadRequest,
	)
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

	albumRangeResponse := request(
		t,
		router,
		http.MethodGet,
		"/api/v1/media/albums/"+
			url.PathEscape(folderAlbumID)+
			"/items?range=true&limit=1&offset=0",
		token,
		nil,
		http.StatusOK,
	)
	var albumRange mediaItemRangeDTO
	if err := json.Unmarshal(albumRangeResponse.Body.Bytes(), &albumRange); err != nil {
		t.Fatal(err)
	}
	if albumRange.TotalCount != 1 || albumRange.Offset != 0 || albumRange.Limit != 1 ||
		len(albumRange.Items) != 1 || albumRange.Items[0].Node.ID != file.ID {
		t.Fatalf("album range=%+v", albumRange)
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

	var mediaUser meta.User
	if err := db.Where("username = ?", "media-user").First(&mediaUser).Error; err != nil {
		t.Fatal(err)
	}
	analysisTicket, _, err := server.Auth.IssuePreviewStream(
		mediaUser.ID,
		mediaUser.SessionVersion,
		file.ID,
		file.Revision,
		mediaAnalysisPreviewTicketKind,
		time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	analysisTicketPath := fmt.Sprintf(
		"/api/v1/media-analysis-preview/%d?ticket=%s",
		file.ID,
		url.QueryEscape(analysisTicket),
	)
	ticketAnalysisPreview := request(
		t,
		router,
		http.MethodGet,
		analysisTicketPath,
		"",
		nil,
		http.StatusOK,
	)
	if ticketAnalysisPreview.Header().Get("ETag") != analysisETag ||
		ticketAnalysisPreview.Header().Get("Cache-Control") != "private, no-store" ||
		!bytes.Equal(
			ticketAnalysisPreview.Body.Bytes(),
			analysisPreviewResponse.Body.Bytes(),
		) {
		t.Fatalf(
			"ticket analysis preview headers/body mismatch: etag=%q cache=%q",
			ticketAnalysisPreview.Header().Get("ETag"),
			ticketAnalysisPreview.Header().Get("Cache-Control"),
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
	request(
		t,
		router,
		http.MethodGet,
		analysisTicketPath,
		"",
		nil,
		http.StatusGone,
	)

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

	liveMotionTicketResponse := request(
		t,
		router,
		http.MethodPost,
		fmt.Sprintf("/api/v1/media/items/%d/live-photo-motion-ticket", liveNode.ID),
		token,
		nil,
		http.StatusOK,
	)
	var liveMotionTicket filePreviewTicketDTO
	if err := json.Unmarshal(liveMotionTicketResponse.Body.Bytes(), &liveMotionTicket); err != nil {
		t.Fatal(err)
	}
	if liveMotionTicket.Kind != "video" ||
		liveMotionTicket.MIMEType != "video/quicktime" ||
		!strings.HasPrefix(
			liveMotionTicket.URL,
			fmt.Sprintf("/api/v1/media-live-photo-motion/%d?ticket=", liveNode.ID),
		) {
		t.Fatalf("livp motion ticket=%+v", liveMotionTicket)
	}
	liveMotionRange := requestWithHeaders(
		t,
		router,
		http.MethodGet,
		liveMotionTicket.URL,
		"",
		nil,
		http.StatusPartialContent,
		map[string]string{"Range": "bytes=0-7"},
	)
	if !bytes.Equal(liveMotionRange.Body.Bytes(), motionBytes[:8]) {
		t.Fatalf("livp motion range=%x want=%x", liveMotionRange.Body.Bytes(), motionBytes[:8])
	}
	if got := liveMotionRange.Header().Get("Content-Range"); got != fmt.Sprintf("bytes 0-7/%d", len(motionBytes)) {
		t.Fatalf("livp motion content-range=%q", got)
	}

	var liveMotionResource meta.MediaDerivedResource
	if err := db.Where(
		"node_id = ? AND role = ?",
		liveNode.ID,
		meta.MediaDerivedResourceRoleMotion,
	).First(&liveMotionResource).Error; err != nil {
		t.Fatal(err)
	}
	if liveMotionResource.ByteSize <= 1 {
		t.Fatal("livp motion resource is unexpectedly small")
	}
	if err := db.Model(&meta.MediaDerivedResource{}).
		Where("node_id = ? AND role = ?", liveNode.ID, meta.MediaDerivedResourceRoleMotion).
		Update("byte_size", liveMotionResource.ByteSize-1).Error; err != nil {
		t.Fatal(err)
	}
	request(
		t,
		router,
		http.MethodGet,
		liveMotionTicket.URL,
		"",
		nil,
		http.StatusGone,
	)
	if err := db.Model(&meta.MediaDerivedResource{}).
		Where("node_id = ? AND role = ?", liveNode.ID, meta.MediaDerivedResourceRoleMotion).
		Update("byte_size", liveMotionResource.ByteSize).Error; err != nil {
		t.Fatal(err)
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

	pairMotionTicketResponse := request(
		t,
		router,
		http.MethodPost,
		fmt.Sprintf("/api/v1/media/items/%d/live-photo-motion-ticket", pairStill.ID),
		token,
		nil,
		http.StatusOK,
	)
	var pairMotionTicket filePreviewTicketDTO
	if err := json.Unmarshal(pairMotionTicketResponse.Body.Bytes(), &pairMotionTicket); err != nil {
		t.Fatal(err)
	}
	pairMotionRange := requestWithHeaders(
		t,
		router,
		http.MethodGet,
		pairMotionTicket.URL,
		"",
		nil,
		http.StatusPartialContent,
		map[string]string{"Range": "bytes=0-7"},
	)
	if !bytes.Equal(pairMotionRange.Body.Bytes(), pairMotionBytes[:8]) {
		t.Fatalf("standalone motion range=%x want=%x", pairMotionRange.Body.Bytes(), pairMotionBytes[:8])
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
	request(
		t,
		router,
		http.MethodGet,
		pairMotionTicket.URL,
		"",
		nil,
		http.StatusGone,
	)
	trashThumbnailBytes := testPNG(t, 4, 3)
	trashThumbnailNode := uploadTestFile(
		t,
		router,
		token,
		folder.ID,
		"trash-thumbnail-cold.png",
		string(trashThumbnailBytes),
	)
	requestWithHeaders(
		t,
		router,
		http.MethodDelete,
		fmt.Sprintf("/api/v1/nodes/%d", trashThumbnailNode.ID),
		token,
		nil,
		http.StatusNoContent,
		map[string]string{
			"If-Match": fmt.Sprintf("\"%d\"", trashThumbnailNode.Revision),
		},
	)

	// Trash uses the same FileExplorer thumbnail transport. This image has
	// never requested a thumbnail before deletion, so success proves the
	// deleted-owner path can generate a cold derivative rather than only serve
	// a cache object created while the node was active.
	trashThumbnailResponse := request(
		t,
		router,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/thumbnail", trashThumbnailNode.ID),
		token,
		nil,
		http.StatusOK,
	)
	trashThumbnailConfig, err := jpeg.DecodeConfig(
		bytes.NewReader(trashThumbnailResponse.Body.Bytes()),
	)
	if err != nil {
		t.Fatal(err)
	}
	if trashThumbnailConfig.Width != 4 || trashThumbnailConfig.Height != 3 {
		t.Fatalf(
			"trash thumbnail dimensions=%dx%d want=4x3",
			trashThumbnailConfig.Width,
			trashThumbnailConfig.Height,
		)
	}

	trashRangeResponse := request(
		t,
		router,
		http.MethodGet,
		"/api/v1/media/trash?limit=20&offset=0",
		token,
		nil,
		http.StatusOK,
	)
	var trashRange mediaItemRangeDTO
	if err := json.Unmarshal(trashRangeResponse.Body.Bytes(), &trashRange); err != nil {
		t.Fatal(err)
	}
	var trashItem *mediaItemDTO
	for index := range trashRange.Items {
		if trashRange.Items[index].Node.ID == trashThumbnailNode.ID {
			trashItem = &trashRange.Items[index]
			break
		}
	}
	if trashItem == nil ||
		trashItem.TrashRoot == nil ||
		trashItem.TrashRoot.ID != trashThumbnailNode.ID ||
		trashItem.Node.DeletedAt == nil {
		t.Fatalf("media trash item=%+v range=%+v", trashItem, trashRange)
	}

	videoNode := uploadTestFile(
		t,
		router,
		token,
		folder.ID,
		"poster.mov",
		string(testLIVPMOV("poster-cache-test")),
	)
	request(
		t,
		router,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/thumbnail", videoNode.ID),
		token,
		nil,
		http.StatusNotFound,
	)
	posterBytes := testLIVPJPEG(t, "poster-cache-test")
	requestWithHeaders(
		t,
		router,
		http.MethodPut,
		fmt.Sprintf("/api/v1/media/items/%d/video-poster", videoNode.ID),
		token,
		bytes.NewReader(posterBytes),
		http.StatusNoContent,
		map[string]string{
			"Content-Type": "image/jpeg",
			"If-Match":     fmt.Sprintf("\"%d\"", videoNode.Revision),
		},
	)
	posterResponse := request(
		t,
		router,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/thumbnail", videoNode.ID),
		token,
		nil,
		http.StatusOK,
	)
	if !bytes.Equal(posterResponse.Body.Bytes(), posterBytes) {
		t.Fatal("cached video poster bytes changed")
	}
	requestWithHeaders(
		t,
		router,
		http.MethodPut,
		fmt.Sprintf("/api/v1/media/items/%d/video-poster", videoNode.ID),
		token,
		bytes.NewReader(posterBytes),
		http.StatusConflict,
		map[string]string{
			"Content-Type": "image/jpeg",
			"If-Match":     fmt.Sprintf("\"%d\"", videoNode.Revision+1),
		},
	)

	// Only thumbnail reads are Trash-aware. Analysis preview remains an
	// active-media API and must not expose deleted nodes.
	request(
		t,
		router,
		http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/analysis-preview", trashThumbnailNode.ID),
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
