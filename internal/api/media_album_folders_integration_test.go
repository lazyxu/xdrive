package api

import (
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
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestAlbumFolderHierarchyAndAlbumMembershipIsolation(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, err := baseDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = baseSQL.Close() }()
	schema := "gallery_album_folders_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	scopedSQL, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = scopedSQL.Close() }()
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{},
		&meta.Source{}, &meta.SourceItem{},
		&meta.SourceCollection{}, &meta.SourceCollectionItem{},
		&meta.MediaMetadata{}, &meta.MediaDerivedResource{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoEditRecipe{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoAlbumFolder{}, &meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
	); err != nil {
		t.Fatal(err)
	}
	manager := auth.New("gallery-album-folders-secret", time.Hour)
	server := &Server{
		DB: db, Store: mustLocalStore(t), Auth: manager,
		RefreshTTL: time.Hour, AllowedOrigin: "http://localhost",
		MaxUploadBytes: 10 << 20,
	}
	router := server.Router()
	owner := meta.User{
		Username: "album-folder-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	token, err := manager.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	createFolder := func(name string, parentID uint64, token string, status int) mediaAlbumFolderDTO {
		t.Helper()
		r := request(t, router, http.MethodPost, "/api/v1/media/album-folders", token,
			strings.NewReader(fmt.Sprintf(`{"name":%q,"parent_id":%d}`, name, parentID)), status)
		if status != http.StatusCreated {
			return mediaAlbumFolderDTO{}
		}
		var folder mediaAlbumFolderDTO
		if err := json.Unmarshal(r.Body.Bytes(), &folder); err != nil {
			t.Fatal(err)
		}
		return folder
	}
	root := createFolder("Trips", 0, token, http.StatusCreated)
	child := createFolder("2026", root.ID, token, http.StatusCreated)
	if root.Revision != 1 || root.ParentID != 0 || child.ParentID != root.ID {
		t.Fatalf("invalid nested album folders: root=%+v child=%+v", root, child)
	}
	createFolder("TRIPS", 0, token, http.StatusConflict)
	createFolder("Orphan", root.ID+100000, token, http.StatusNotFound)
	// A folder cannot move under itself or under a descendant.
	requestWithHeaders(t, router, http.MethodPatch,
		fmt.Sprintf("/api/v1/media/album-folders/%d", root.ID), token,
		strings.NewReader(fmt.Sprintf(`{"parent_id":%d}`, child.ID)),
		http.StatusConflict, map[string]string{"If-Match": `"1"`})
	requestWithHeaders(t, router, http.MethodDelete,
		fmt.Sprintf("/api/v1/media/album-folders/%d", root.ID), token, nil,
		http.StatusConflict, map[string]string{"If-Match": `"1"`})

	listResponse := request(t, router, http.MethodGet, "/api/v1/media/album-folders", token, nil, http.StatusOK)
	var list []mediaAlbumFolderDTO
	if err := json.Unmarshal(listResponse.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("album folder list has %d elements, want 2", len(list))
	}
	createAlbum := request(t, router, http.MethodPost, "/api/v1/media/albums",
		token, strings.NewReader(`{"name":"Archive"}`), http.StatusCreated)
	var album mediaAlbumDTO
	if err := json.Unmarshal(createAlbum.Body.Bytes(), &album); err != nil {
		t.Fatal(err)
	}
	moveURL := "/api/v1/media/albums/" + url.PathEscape(album.ID) + "/folder"
	move := requestWithHeaders(t, router, http.MethodPatch, moveURL, token,
		strings.NewReader(fmt.Sprintf(`{"folder_id":%d}`, child.ID)),
		http.StatusOK, map[string]string{"If-Match": `"1"`})
	if err := json.Unmarshal(move.Body.Bytes(), &album); err != nil {
		t.Fatal(err)
	}
	if album.Revision != 2 || album.AlbumFolderID != child.ID {
		t.Fatalf("album did not move: %+v", album)
	}
	requestWithHeaders(t, router, http.MethodPatch, moveURL, token,
		strings.NewReader(`{"folder_id":0}`),
		http.StatusConflict, map[string]string{"If-Match": `"1"`})
	requestWithHeaders(t, router, http.MethodDelete,
		fmt.Sprintf("/api/v1/media/album-folders/%d", child.ID), token, nil,
		http.StatusConflict, map[string]string{"If-Match": `"1"`})

	other := meta.User{
		Username: "album-folder-other", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	otherToken, err := manager.Issue(other.ID, other.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	otherList := request(t, router, http.MethodGet, "/api/v1/media/album-folders", otherToken, nil, http.StatusOK)
	var otherFolders []mediaAlbumFolderDTO
	if err := json.Unmarshal(otherList.Body.Bytes(), &otherFolders); err != nil || len(otherFolders) != 0 {
		t.Fatalf("cross-user folder exposure: %v / %+v", err, otherFolders)
	}
	createFolder("Foreign", child.ID, otherToken, http.StatusNotFound)
	// Move out of a folder without changing logical media membership or bytes.
	move = requestWithHeaders(t, router, http.MethodPatch, moveURL, token,
		strings.NewReader(`{"folder_id":0}`),
		http.StatusOK, map[string]string{"If-Match": `"2"`})
	// Zero is a meaningful root-folder move: JSON must explicitly include it.
	// Otherwise decoding into an already-open album leaves its old folder ID.
	var rootMove struct {
		AlbumFolderID *uint64 `json:"album_folder_id"`
	}
	if err := json.Unmarshal(move.Body.Bytes(), &rootMove); err != nil ||
		rootMove.AlbumFolderID == nil || *rootMove.AlbumFolderID != 0 {
		t.Fatalf("root move did not return an explicit zero folder ID: %s (%v)", move.Body.String(), err)
	}
	if err := json.Unmarshal(move.Body.Bytes(), &album); err != nil {
		t.Fatal(err)
	}
	if album.AlbumFolderID != 0 || album.Revision != 3 {
		t.Fatalf("album failed to move back to root: %+v", album)
	}
	rename := requestWithHeaders(t, router, http.MethodPatch,
		fmt.Sprintf("/api/v1/media/album-folders/%d", child.ID), token,
		strings.NewReader(`{"name":"Summer"}`), http.StatusOK,
		map[string]string{"If-Match": `"1"`})
	if err := json.Unmarshal(rename.Body.Bytes(), &child); err != nil {
		t.Fatal(err)
	}
	if child.Name != "Summer" || child.Revision != 2 {
		t.Fatalf("folder rename=%+v", child)
	}
	requestWithHeaders(t, router, http.MethodDelete,
		fmt.Sprintf("/api/v1/media/album-folders/%d", child.ID), token, nil,
		http.StatusNoContent, map[string]string{"If-Match": `"2"`})
	requestWithHeaders(t, router, http.MethodDelete,
		fmt.Sprintf("/api/v1/media/album-folders/%d", root.ID), token, nil,
		http.StatusNoContent, map[string]string{"If-Match": `"1"`})
	var albums int64
	if err := db.Model(&meta.PhotoCollection{}).Where("id <> 0 AND owner_id = ?", owner.ID).Count(&albums).Error; err != nil {
		t.Fatal(err)
	}
	if albums != 1 {
		t.Fatalf("folder deletion deleted logical albums: %d remain", albums)
	}
}
