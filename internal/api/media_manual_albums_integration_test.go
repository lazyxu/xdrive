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
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestManualMediaAlbumsUseMembershipOnly(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "manual_media_albums_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		&meta.PhotoAsset{}, &meta.PhotoEditRecipe{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
	); err != nil {
		t.Fatal(err)
	}

	manager := auth.New("manual-media-albums-secret", time.Hour)
	server := &Server{
		DB: db, Store: mustLocalStore(t), Auth: manager,
		RefreshTTL: time.Hour, AllowedOrigin: "http://localhost",
		MaxUploadBytes: 10 << 20,
	}
	router := server.Router()

	user := meta.User{
		Username:       "manual-album-owner",
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
	folder := meta.Node{ParentID: &root.ID, Name: "Camera", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&folder).Error; err != nil {
		t.Fatal(err)
	}
	nodes := []meta.Node{
		{ParentID: &folder.ID, Name: "one.jpg", Type: meta.NodeTypeFile, OwnerID: user.ID, Revision: 1},
		{ParentID: &folder.ID, Name: "two.jpg", Type: meta.NodeTypeFile, OwnerID: user.ID, Revision: 1},
	}
	if err := db.Create(&nodes).Error; err != nil {
		t.Fatal(err)
	}
	files := []meta.File{
		{NodeID: nodes[0].ID, Size: 10, StorageKey: "one", SHA256: strings.Repeat("a", 64)},
		{NodeID: nodes[1].ID, Size: 20, StorageKey: "two", SHA256: strings.Repeat("b", 64)},
	}
	if err := db.Create(&files).Error; err != nil {
		t.Fatal(err)
	}
	metadata := []meta.MediaMetadata{
		{
			NodeID: nodes[0].ID, OwnerID: user.ID, NodeRevision: 1,
			SHA256: files[0].SHA256, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", Width: 10, Height: 10,
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

	create := request(
		t, router, http.MethodPost, "/api/v1/media/albums", token,
		strings.NewReader(`{"name":"Favorites 2026"}`), http.StatusCreated,
	)
	var album mediaAlbumDTO
	if err := json.Unmarshal(create.Body.Bytes(), &album); err != nil {
		t.Fatal(err)
	}
	if album.Kind != meta.PhotoCollectionKindManual || album.Revision != 1 ||
		album.ItemCount != 0 || !strings.HasPrefix(album.ID, "manual:") {
		t.Fatalf("created album=%+v", album)
	}

	list := request(t, router, http.MethodGet, "/api/v1/media/albums", token, nil, http.StatusOK)
	var albums []mediaAlbumDTO
	if err := json.Unmarshal(list.Body.Bytes(), &albums); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, candidate := range albums {
		if candidate.ID == album.ID {
			found = true
			if candidate.ItemCount != 0 {
				t.Fatalf("empty manual album item_count=%d", candidate.ItemCount)
			}
		}
	}
	if !found {
		t.Fatalf("empty manual album missing from list: %+v", albums)
	}

	add := requestWithHeaders(
		t, router, http.MethodPost,
		"/api/v1/media/albums/"+url.PathEscape(album.ID)+"/items",
		token,
		strings.NewReader(fmt.Sprintf(`{"node_ids":[%d,%d,%d]}`, nodes[0].ID, nodes[0].ID, nodes[1].ID)),
		http.StatusOK,
		map[string]string{"If-Match": `"1"`},
	)
	if err := json.Unmarshal(add.Body.Bytes(), &album); err != nil {
		t.Fatal(err)
	}
	if album.Revision != 2 || album.ItemCount != 2 {
		t.Fatalf("album after add=%+v", album)
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
	if len(mediaItems) != 2 {
		t.Fatalf("manual album items=%+v", mediaItems)
	}

	deletedAt := time.Now().UTC()
	if err := db.Model(&meta.Node{}).
		Where("id = ? AND owner_id = ?", nodes[1].ID, user.ID).
		Updates(map[string]any{
			"deleted_at":    &deletedAt,
			"trash_root_id": nodes[1].ID,
		}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := photoasset.ReconcileOwner(context.Background(), db, user.ID); err != nil {
		t.Fatal(err)
	}
	listWithTrash := request(t, router, http.MethodGet, "/api/v1/media/albums", token, nil, http.StatusOK)
	var albumsWithTrash []mediaAlbumDTO
	if err := json.Unmarshal(listWithTrash.Body.Bytes(), &albumsWithTrash); err != nil {
		t.Fatal(err)
	}
	for _, candidate := range albumsWithTrash {
		if candidate.ID == album.ID && candidate.ItemCount != 1 {
			t.Fatalf("manual album counted trashed member: %+v", candidate)
		}
	}
	itemsWithTrash := request(
		t, router, http.MethodGet,
		"/api/v1/media/albums/"+url.PathEscape(album.ID)+"/items?limit=100",
		token, nil, http.StatusOK,
	)
	mediaItems = nil
	if err := json.Unmarshal(itemsWithTrash.Body.Bytes(), &mediaItems); err != nil {
		t.Fatal(err)
	}
	if len(mediaItems) != 1 || mediaItems[0].Node.ID != nodes[0].ID {
		t.Fatalf("manual album exposed trashed member: %+v", mediaItems)
	}

	if err := db.Model(&meta.Node{}).
		Where("id = ? AND owner_id = ?", nodes[1].ID, user.ID).
		Updates(map[string]any{
			"deleted_at":    nil,
			"trash_root_id": nil,
		}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := photoasset.ReconcileOwner(context.Background(), db, user.ID); err != nil {
		t.Fatal(err)
	}
	restoredAlbum, err := server.mediaAlbumDTOByKey(context.Background(), user.ID, album.ID)
	if err != nil {
		t.Fatal(err)
	}
	if restoredAlbum.ItemCount != 2 {
		t.Fatalf("restored manual album item_count=%d want=2", restoredAlbum.ItemCount)
	}

	requestWithHeaders(
		t, router, http.MethodPatch,
		"/api/v1/media/albums/"+url.PathEscape(album.ID),
		token,
		strings.NewReader(`{"name":"stale"}`),
		http.StatusConflict,
		map[string]string{"If-Match": `"1"`},
	)

	rename := requestWithHeaders(
		t, router, http.MethodPatch,
		"/api/v1/media/albums/"+url.PathEscape(album.ID),
		token,
		strings.NewReader(`{"name":"Summer"}`),
		http.StatusOK,
		map[string]string{"If-Match": `"2"`},
	)
	if err := json.Unmarshal(rename.Body.Bytes(), &album); err != nil {
		t.Fatal(err)
	}
	if album.Revision != 3 || album.Name != "Summer" {
		t.Fatalf("album after rename=%+v", album)
	}

	remove := requestWithHeaders(
		t, router, http.MethodDelete,
		fmt.Sprintf("/api/v1/media/albums/%s/items/%d", url.PathEscape(album.ID), nodes[0].ID),
		token, nil, http.StatusOK,
		map[string]string{"If-Match": `"3"`},
	)
	if err := json.Unmarshal(remove.Body.Bytes(), &album); err != nil {
		t.Fatal(err)
	}
	if album.Revision != 4 || album.ItemCount != 1 {
		t.Fatalf("album after remove=%+v", album)
	}

	// G04: a user-selected cover must be a current member of this owner-scoped
	// manual album, optimistic revision fencing prevents stale writes, and
	// clearing the preference restores the computed image cover.
	readd := requestWithHeaders(
		t, router, http.MethodPost,
		"/api/v1/media/albums/"+url.PathEscape(album.ID)+"/items",
		token,
		strings.NewReader(fmt.Sprintf(`{"node_ids":[%d]}`, nodes[0].ID)),
		http.StatusOK,
		map[string]string{"If-Match": `"4"`},
	)
	if err := json.Unmarshal(readd.Body.Bytes(), &album); err != nil {
		t.Fatal(err)
	}
	if album.Revision != 5 || album.ItemCount != 2 {
		t.Fatalf("album after readd=%+v", album)
	}
	setCoverPath := "/api/v1/media/albums/" + url.PathEscape(album.ID) + "/cover"
	customCover := requestWithHeaders(
		t, router, http.MethodPut, setCoverPath, token,
		strings.NewReader(fmt.Sprintf(`{"node_id":%d}`, nodes[1].ID)),
		http.StatusOK,
		map[string]string{"If-Match": `"5"`},
	)
	if err := json.Unmarshal(customCover.Body.Bytes(), &album); err != nil {
		t.Fatal(err)
	}
	if album.Revision != 6 || album.CoverNodeID == nil || *album.CoverNodeID != nodes[1].ID {
		t.Fatalf("custom album cover=%+v", album)
	}
	requestWithHeaders(
		t, router, http.MethodPut, setCoverPath, token,
		strings.NewReader(fmt.Sprintf(`{"node_id":%d}`, nodes[0].ID)),
		http.StatusConflict,
		map[string]string{"If-Match": `"5"`},
	)
	requestWithHeaders(
		t, router, http.MethodPut, setCoverPath, token,
		strings.NewReader(fmt.Sprintf(`{"node_id":%d}`, folder.ID)),
		http.StatusConflict,
		map[string]string{"If-Match": `"6"`},
	)
	autoCover := requestWithHeaders(
		t, router, http.MethodPut, setCoverPath, token,
		strings.NewReader(`{"node_id":0}`),
		http.StatusOK,
		map[string]string{"If-Match": `"6"`},
	)
	if err := json.Unmarshal(autoCover.Body.Bytes(), &album); err != nil {
		t.Fatal(err)
	}
	if album.Revision != 7 || album.CoverNodeID == nil || *album.CoverNodeID != nodes[0].ID {
		t.Fatalf("automatic album cover=%+v", album)
	}

	var manualCollection meta.PhotoCollection
	if err := db.Where(
		"owner_id = ? AND external_key = ? AND kind = ?",
		user.ID,
		album.ID,
		meta.PhotoCollectionKindManual,
	).First(&manualCollection).Error; err != nil {
		t.Fatal(err)
	}

	var nodeCountBefore, fileCountBefore, assetCountBefore int64
	_ = db.Model(&meta.Node{}).Count(&nodeCountBefore).Error
	_ = db.Model(&meta.File{}).Count(&fileCountBefore).Error
	_ = db.Model(&meta.PhotoAsset{}).Count(&assetCountBefore).Error

	requestWithHeaders(
		t, router, http.MethodDelete,
		"/api/v1/media/albums/"+url.PathEscape(album.ID),
		token, nil, http.StatusNoContent,
		map[string]string{"If-Match": `"7"`},
	)

	var nodeCountAfter, fileCountAfter, assetCountAfter, manualMembershipCount, manualCollectionCount int64
	_ = db.Model(&meta.Node{}).Count(&nodeCountAfter).Error
	_ = db.Model(&meta.File{}).Count(&fileCountAfter).Error
	_ = db.Model(&meta.PhotoAsset{}).Count(&assetCountAfter).Error
	_ = db.Model(&meta.PhotoCollectionAsset{}).
		Where("collection_id = ?", manualCollection.ID).
		Count(&manualMembershipCount).Error
	_ = db.Model(&meta.PhotoCollection{}).
		Where("id = ?", manualCollection.ID).
		Count(&manualCollectionCount).Error
	if nodeCountAfter != nodeCountBefore || fileCountAfter != fileCountBefore ||
		assetCountAfter != assetCountBefore ||
		manualCollectionCount != 0 || manualMembershipCount != 0 {
		t.Fatalf(
			"manual album deletion changed media objects or leaked album state: nodes %d/%d files %d/%d assets %d/%d album_rows=%d manual_memberships=%d",
			nodeCountBefore, nodeCountAfter, fileCountBefore, fileCountAfter,
			assetCountBefore, assetCountAfter, manualCollectionCount, manualMembershipCount,
		)
	}
}

func mustLocalStore(t *testing.T) storage.Store {
	t.Helper()
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return store
}
