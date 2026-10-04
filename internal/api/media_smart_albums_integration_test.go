package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photoasset"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestSmartMediaAlbumsEvaluateSavedLocalQuery(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "smart_media_albums_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()

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
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{},
		&meta.Source{}, &meta.SourceItem{},
		&meta.SourceCollection{}, &meta.SourceCollectionItem{},
		&meta.MediaMetadata{}, &meta.MediaDerivedResource{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
	); err != nil {
		t.Fatal(err)
	}

	manager := auth.New("smart-media-albums-secret", time.Hour)
	server := &Server{
		DB: db, Store: mustLocalStore(t), Auth: manager,
		RefreshTTL: time.Hour, AllowedOrigin: "http://localhost",
		MaxUploadBytes: 10 << 20,
	}
	router := server.Router()

	user := meta.User{
		Username:       "smart-album-owner",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	token, err := manager.Issue(user.ID, user.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}

	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	nodes := []meta.Node{
		{ParentID: &root.ID, Name: "favorite.jpg", Type: meta.NodeTypeFile, OwnerID: user.ID, Revision: 1},
		{ParentID: &root.ID, Name: "plain.jpg", Type: meta.NodeTypeFile, OwnerID: user.ID, Revision: 1},
	}
	if err := db.Create(&nodes).Error; err != nil {
		t.Fatal(err)
	}
	files := []meta.File{
		{NodeID: nodes[0].ID, Size: 10, StorageKey: "favorite", SHA256: strings.Repeat("a", 64)},
		{NodeID: nodes[1].ID, Size: 20, StorageKey: "plain", SHA256: strings.Repeat("b", 64)},
	}
	if err := db.Create(&files).Error; err != nil {
		t.Fatal(err)
	}
	captured := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	latitude, longitude := 1.3521, 103.8198
	metadata := []meta.MediaMetadata{
		{
			NodeID: nodes[0].ID, OwnerID: user.ID, NodeRevision: 1,
			SHA256: files[0].SHA256, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", Width: 10, Height: 10,
			CapturedAt:              &captured,
			Latitude:                &latitude,
			Longitude:               &longitude,
			IndexState:              meta.MediaIndexStateReady,
			RelationEvidenceVersion: mediapkg.RelationEvidenceVersion,
		},
		{
			NodeID: nodes[1].ID, OwnerID: user.ID, NodeRevision: 1,
			SHA256: files[1].SHA256, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", Width: 10, Height: 10,
			IndexState:              meta.MediaIndexStateReady,
			RelationEvidenceVersion: mediapkg.RelationEvidenceVersion,
		},
	}
	if err := db.Create(&metadata).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := photoasset.ReconcileOwner(context.Background(), db, user.ID); err != nil {
		t.Fatal(err)
	}
	var favoriteAsset meta.PhotoAsset
	if err := db.Where("owner_id = ? AND primary_node_id = ?", user.ID, nodes[0].ID).
		First(&favoriteAsset).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.PhotoMetadata{}).
		Where("asset_id = ?", favoriteAsset.ID).
		Update("favorite", true).Error; err != nil {
		t.Fatal(err)
	}
	tagsResponse := request(
		t, router, http.MethodPatch,
		fmt.Sprintf("/api/v1/media/items/%d/tags", nodes[0].ID),
		token,
		strings.NewReader(`{"tags":["Travel","Family","travel"]}`),
		http.StatusOK,
	)
	var tags mediaTagsDTO
	if err := json.Unmarshal(tagsResponse.Body.Bytes(), &tags); err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(tags.Tags) != "[Family Travel]" {
		t.Fatalf("tags=%v", tags.Tags)
	}

	create := request(
		t, router, http.MethodPost, "/api/v1/media/smart-albums", token,
		strings.NewReader(`{"name":"Favorites","query":{"favorite":true,"tag":"Travel","place":"place:135:10381"}}`),
		http.StatusCreated,
	)
	var album mediaAlbumDTO
	if err := json.Unmarshal(create.Body.Bytes(), &album); err != nil {
		t.Fatal(err)
	}
	if album.Kind != meta.PhotoCollectionKindSmart ||
		album.Revision != 1 ||
		album.ItemCount != 1 ||
		album.Query == nil ||
		album.Query.Favorite == nil ||
		!*album.Query.Favorite ||
		album.Query.Tag != "Travel" ||
		album.Query.Place != "place:135:10381" ||
		!strings.HasPrefix(album.ID, "smart:") {
		t.Fatalf("created smart album=%+v", album)
	}

	var collection meta.PhotoCollection
	if err := db.Where("owner_id = ? AND external_key = ?", user.ID, album.ID).
		First(&collection).Error; err != nil {
		t.Fatal(err)
	}
	var membershipCount int64
	if err := db.Model(&meta.PhotoCollectionAsset{}).
		Where("collection_id = ?", collection.ID).
		Count(&membershipCount).Error; err != nil {
		t.Fatal(err)
	}
	if membershipCount != 0 {
		t.Fatalf("smart album persisted %d membership rows", membershipCount)
	}

	items := request(
		t, router, http.MethodGet,
		"/api/v1/media/albums/"+url.PathEscape(album.ID)+"/items?limit=100",
		token, nil, http.StatusOK,
	)
	var mediaItems []mediaItemDTO
	if err := json.Unmarshal(items.Body.Bytes(), &mediaItems); err != nil {
		t.Fatal(err)
	}
	if len(mediaItems) != 1 || mediaItems[0].Node.ID != nodes[0].ID ||
		fmt.Sprint(mediaItems[0].Tags) != "[Family Travel]" {
		t.Fatalf("favorite smart album items=%+v", mediaItems)
	}

	if err := db.Model(&meta.PhotoMetadata{}).
		Where("asset_id = ?", favoriteAsset.ID).
		Update("favorite", false).Error; err != nil {
		t.Fatal(err)
	}
	items = request(
		t, router, http.MethodGet,
		"/api/v1/media/albums/"+url.PathEscape(album.ID)+"/items?limit=100",
		token, nil, http.StatusOK,
	)
	mediaItems = nil
	if err := json.Unmarshal(items.Body.Bytes(), &mediaItems); err != nil {
		t.Fatal(err)
	}
	if len(mediaItems) != 0 {
		t.Fatalf("smart album did not re-evaluate favorite state: %+v", mediaItems)
	}

	requestWithHeaders(
		t, router, http.MethodPatch,
		"/api/v1/media/smart-albums/"+url.PathEscape(album.ID),
		token,
		strings.NewReader(`{"name":"Captured","query":{"captured_from":"2026-08-01T00:00:00Z","captured_to":"2026-10-01T00:00:00Z"}}`),
		http.StatusConflict,
		map[string]string{"If-Match": `"2"`},
	)

	update := requestWithHeaders(
		t, router, http.MethodPatch,
		"/api/v1/media/smart-albums/"+url.PathEscape(album.ID),
		token,
		strings.NewReader(`{"name":"Captured","query":{"captured_from":"2026-08-01T00:00:00Z","captured_to":"2026-10-01T00:00:00Z"}}`),
		http.StatusOK,
		map[string]string{"If-Match": `"1"`},
	)
	if err := json.Unmarshal(update.Body.Bytes(), &album); err != nil {
		t.Fatal(err)
	}
	if album.Revision != 2 || album.Name != "Captured" || album.Query == nil ||
		album.Query.CapturedFrom == nil || album.Query.CapturedTo == nil {
		t.Fatalf("updated smart album=%+v", album)
	}

	items = request(
		t, router, http.MethodGet,
		"/api/v1/media/albums/"+url.PathEscape(album.ID)+"/items?limit=100",
		token, nil, http.StatusOK,
	)
	mediaItems = nil
	if err := json.Unmarshal(items.Body.Bytes(), &mediaItems); err != nil {
		t.Fatal(err)
	}
	if len(mediaItems) != 1 || mediaItems[0].Node.ID != nodes[0].ID {
		t.Fatalf("captured smart album items=%+v", mediaItems)
	}

	var nodeCountBefore, assetCountBefore int64
	_ = db.Model(&meta.Node{}).Count(&nodeCountBefore).Error
	_ = db.Model(&meta.PhotoAsset{}).Count(&assetCountBefore).Error

	requestWithHeaders(
		t, router, http.MethodDelete,
		"/api/v1/media/smart-albums/"+url.PathEscape(album.ID),
		token, nil, http.StatusNoContent,
		map[string]string{"If-Match": `"2"`},
	)

	var nodeCountAfter, assetCountAfter, collectionCount int64
	_ = db.Model(&meta.Node{}).Count(&nodeCountAfter).Error
	_ = db.Model(&meta.PhotoAsset{}).Count(&assetCountAfter).Error
	_ = db.Model(&meta.PhotoCollection{}).
		Where("id = ?", collection.ID).Count(&collectionCount).Error
	if nodeCountAfter != nodeCountBefore ||
		assetCountAfter != assetCountBefore ||
		collectionCount != 0 {
		t.Fatalf(
			"smart album deletion changed media objects: nodes %d/%d assets %d/%d collection=%d",
			nodeCountBefore, nodeCountAfter,
			assetCountBefore, assetCountAfter,
			collectionCount,
		)
	}
}
