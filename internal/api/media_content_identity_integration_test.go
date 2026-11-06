package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photoasset"
)

func TestMediaContentIdentityRealOriginalsOwnerAndSourceHandoff(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	db := openPhotoIntelligenceAPITestDB(t, dsn)
	if err := db.AutoMigrate(&meta.File{}, &meta.SourceItem{}, &meta.SourceCollection{}, &meta.SourceCollectionItem{}, &meta.MediaMetadata{}, &meta.MediaDerivedResource{}, &meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoResource{}, &meta.PhotoMetadata{}, &meta.PhotoCollection{}, &meta.PhotoCollectionAsset{}, &meta.PhotoEditRecipe{}, &meta.PhotoOCRText{}); err != nil {
		t.Fatal(err)
	}
	if err := photoasset.InstallContentIdentitySchema(db); err != nil {
		t.Fatal(err)
	}
	manager := auth.New("content-api-local-test", time.Hour)
	server := &Server{DB: db, Store: mustLocalStore(t), Auth: manager, RefreshTTL: time.Hour, AllowedOrigin: "http://localhost"}
	router := server.Router()
	owner := meta.User{Username: "content-api-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	other := meta.User{Username: "content-api-foreign", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	token, err := manager.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	foreignToken, err := manager.Issue(other.ID, other.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	root := meta.Node{OwnerID: owner.ID, Name: "", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	original := testPNG(t, 31, 23)
	sha := fmt.Sprintf("%x", sha256.Sum256(original))
	key := "sha256:" + sha
	nodes := make([]meta.Node, 52)
	for i := range nodes {
		nodes[i] = meta.Node{OwnerID: owner.ID, ParentID: &root.ID, Name: fmt.Sprintf("copy-%02d.png", i), Type: meta.NodeTypeFile, Revision: 1}
		if err := db.Create(&nodes[i]).Error; err != nil {
			t.Fatal(err)
		}
		storageKey := fmt.Sprintf("content-fixture/%d", nodes[i].ID)
		if _, err := server.Store.Put(context.Background(), storageKey, bytes.NewReader(original)); err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.File{NodeID: nodes[i].ID, Size: int64(len(original)), SHA256: sha, StorageKey: storageKey}).Error; err != nil {
			t.Fatal(err)
		}
		var loaded meta.Node
		if err := db.Preload("File").First(&loaded, nodes[i].ID).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := server.ensureMediaMetadata(context.Background(), loaded); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := photoasset.ReconcileOwner(context.Background(), db, owner.ID); err != nil {
		t.Fatal(err)
	}
	base := "/api/v1/media/content/" + url.PathEscape(key)
	response := request(t, router, http.MethodGet, "/api/v1/media/items?range=true&limit=10", token, nil, http.StatusOK)
	var page mediaItemRangeDTO
	if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if page.TotalCount != 1 || len(page.Items) != 1 || page.Items[0].ContentKey != key {
		t.Fatalf("same original appears repeatedly in Gallery: %+v", page)
	}
	request(t, router, http.MethodPatch, base+"/favorite", token, strings.NewReader(`{"favorite":true}`), http.StatusOK)
	response = request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/media/items/%d", nodes[1].ID), token, nil, http.StatusOK)
	var item mediaItemDTO
	if err := json.Unmarshal(response.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	if item.ContentKey != key || !item.Favorite {
		t.Fatalf("file copy did not resolve canonical annotations: %+v", item)
	}
	response = request(t, router, http.MethodGet, base+"/sources", token, nil, http.StatusOK)
	var sources mediaContentSourcesDTO
	if err := json.Unmarshal(response.Body.Bytes(), &sources); err != nil {
		t.Fatal(err)
	}
	if len(sources.Items) != 50 || sources.NextCursor == nil {
		t.Fatalf("source pagination is not bounded: %+v", sources)
	}
	response = request(t, router, http.MethodGet, fmt.Sprintf("%s/sources?cursor=%d", base, *sources.NextCursor), token, nil, http.StatusOK)
	if err := json.Unmarshal(response.Body.Bytes(), &sources); err != nil {
		t.Fatal(err)
	}
	if len(sources.Items) != 2 {
		t.Fatalf("source continuation: %+v", sources)
	}
	request(t, router, http.MethodGet, base, foreignToken, nil, http.StatusNotFound)
	request(t, router, http.MethodGet, base+"/sources", foreignToken, nil, http.StatusNotFound)
	request(t, router, http.MethodPatch, base+"/favorite", foreignToken, strings.NewReader(`{"favorite":false}`), http.StatusNotFound)
	// Replace the selected file with different actual bytes. The photo hash
	// still resolves to another original copy; the new photo inherits nothing.
	replacement := testPNG(t, 39, 27)
	newSHA := fmt.Sprintf("%x", sha256.Sum256(replacement))
	newStorage := "content-fixture/replacement"
	if _, err := server.Store.Put(context.Background(), newStorage, bytes.NewReader(replacement)); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.File{}).Where("node_id = ?", nodes[0].ID).Updates(map[string]any{"sha256": newSHA, "size": len(replacement), "storage_key": newStorage}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.Node{}).Where("id = ?", nodes[0].ID).Update("revision", 2).Error; err != nil {
		t.Fatal(err)
	}
	response = request(t, router, http.MethodGet, base, token, nil, http.StatusOK)
	item = mediaItemDTO{}
	if err := json.Unmarshal(response.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	if item.ContentKey != key || item.Node.ID == nodes[0].ID || !item.Favorite {
		t.Fatalf("hash request followed replaced Node: %+v", item)
	}
	response = request(t, router, http.MethodGet, "/api/v1/media/content/"+url.PathEscape("sha256:"+newSHA), token, nil, http.StatusOK)
	item = mediaItemDTO{}
	if err := json.Unmarshal(response.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	if item.ContentKey != "sha256:"+newSHA || item.Node.ID != nodes[0].ID || item.Favorite {
		t.Fatalf("replacement acquired old identity/annotation: %+v", item)
	}
}
