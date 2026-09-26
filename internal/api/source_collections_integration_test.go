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

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestSourceCollectionReadAPIAndOwnerIsolation(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)

	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "source_collection_api_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	}()

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
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.AuditEvent{},
		&meta.Source{}, &meta.SourceItem{}, &meta.SourceCollection{}, &meta.SourceCollectionItem{},
		&meta.SourceItemMetadata{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_sources_owner_name ON xd_sources(owner_id, lower(name))`).Error; err != nil {
		t.Fatal(err)
	}

	router := (&Server{
		DB: db, Auth: auth.New("source-collection-api-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
	}).Router()
	tokenA := createTestUser(t, db, router, "collection-alice", "password-a")
	tokenB := createTestUser(t, db, router, "collection-bob", "password-b")

	var alice, bob meta.User
	if err := db.Where("username = ?", "collection-alice").First(&alice).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("username = ?", "collection-bob").First(&bob).Error; err != nil {
		t.Fatal(err)
	}
	var rootA, rootB meta.Node
	if err := db.Where("owner_id = ? AND parent_id IS NULL", alice.ID).First(&rootA).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("owner_id = ? AND parent_id IS NULL", bob.ID).First(&rootB).Error; err != nil {
		t.Fatal(err)
	}

	sourceA := meta.Source{
		OwnerID: alice.ID, Name: "Yike A", Kind: "yike_photos",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusActive,
		Revision: 1, TargetNodeID: &rootA.ID,
	}
	sourceB := meta.Source{
		OwnerID: bob.ID, Name: "Yike B", Kind: "yike_photos",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusActive,
		Revision: 1, TargetNodeID: &rootB.ID,
	}
	if err := db.Create(&sourceA).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&sourceB).Error; err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	nodeA := meta.Node{ParentID: &rootA.ID, Name: "photo.jpg", Type: meta.NodeTypeFile, OwnerID: alice.ID, Revision: 3}
	if err := db.Create(&nodeA).Error; err != nil {
		t.Fatal(err)
	}
	itemA1 := meta.SourceItem{
		SourceID: sourceA.ID, ExternalID: "yike:123:1", NodeID: &nodeA.ID, NodeRevision: nodeA.Revision,
		Kind: meta.SourceItemKindFile, Path: "Library/photo.jpg [1]", Size: 10,
		State: meta.SourceItemStateSynced, LastSeenAt: now,
	}
	itemA2 := meta.SourceItem{
		SourceID: sourceA.ID, ExternalID: "yike:999:2",
		Kind: meta.SourceItemKindFile, Path: "Shared/999/shared.jpg [2]", Size: 20,
		State: meta.SourceItemStateMissing, LastSeenAt: now,
	}
	if err := db.Create(&itemA1).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&itemA2).Error; err != nil {
		t.Fatal(err)
	}
	itemB := meta.SourceItem{
		SourceID: sourceB.ID, ExternalID: "yike:555:9",
		Kind: meta.SourceItemKindFile, Path: "Library/private.jpg [9]", Size: 99,
		State: meta.SourceItemStateSynced, LastSeenAt: now,
	}
	if err := db.Create(&itemB).Error; err != nil {
		t.Fatal(err)
	}

	createdA1 := now.Add(-2 * time.Hour)
	createdA2 := now.Add(-time.Hour)
	if err := db.Create(&[]meta.SourceItemMetadata{
		{
			SourceItemID: itemA1.ID, SourceID: sourceA.ID,
			OriginalPath: "/DCIM/photo.jpg", OwnerExternalID: "123",
			RemoteCreatedAt: &createdA1, ContentMD5: strings.Repeat("a", 32),
			ThumbnailURL: "https://thumb.example/photo",
		},
		{
			SourceItemID: itemA2.ID, SourceID: sourceA.ID,
			OriginalPath: "/shared.jpg", OwnerExternalID: "999",
			RemoteCreatedAt: &createdA2, ContentMD5: strings.Repeat("b", 32),
			ThumbnailURL: "https://thumb.example/shared",
		},
		{
			SourceItemID: itemB.ID, SourceID: sourceB.ID,
			OriginalPath: "/private.jpg", OwnerExternalID: "555",
			ContentMD5: strings.Repeat("c", 32),
		},
	}).Error; err != nil {
		t.Fatal(err)
	}

	active := meta.SourceCollection{
		SourceID: sourceA.ID, ExternalID: "yike:album:active", Kind: "album", Name: "Active Album",
		State: meta.SourceCollectionStateActive, RemoteRevision: "r2",
		LastSeenRunID: "run-2", LastSeenAt: now,
	}
	missing := meta.SourceCollection{
		SourceID: sourceA.ID, ExternalID: "yike:album:missing", Kind: "album", Name: "Missing Album",
		State: meta.SourceCollectionStateMissing, RemoteRevision: "r1",
		LastSeenRunID: "run-1", LastSeenAt: now.Add(-time.Hour),
	}
	private := meta.SourceCollection{
		SourceID: sourceB.ID, ExternalID: "yike:album:private", Kind: "album", Name: "Private Album",
		State: meta.SourceCollectionStateActive, LastSeenRunID: "run-b", LastSeenAt: now,
	}
	if err := db.Create(&active).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&missing).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&private).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&[]meta.SourceCollectionItem{
		{CollectionID: active.ID, SourceItemID: itemA2.ID, Position: 1, LastSeenRunID: "run-2", LastSeenAt: now},
		{CollectionID: active.ID, SourceItemID: itemA1.ID, Position: 0, LastSeenRunID: "run-2", LastSeenAt: now},
		{CollectionID: private.ID, SourceItemID: itemB.ID, Position: 0, LastSeenRunID: "run-b", LastSeenAt: now},
	}).Error; err != nil {
		t.Fatal(err)
	}

	itemsListPath := fmt.Sprintf("/api/v1/sources/%d/items", sourceA.ID)
	res := request(t, router, http.MethodGet, itemsListPath, tokenA, nil, http.StatusOK)
	var sourceItems []sourceItemDTO
	if err := json.Unmarshal(res.Body.Bytes(), &sourceItems); err != nil {
		t.Fatal(err)
	}
	if len(sourceItems) != 2 ||
		sourceItems[0].ExternalID != itemA1.ExternalID ||
		sourceItems[1].ExternalID != itemA2.ExternalID {
		t.Fatalf("source items=%+v", sourceItems)
	}
	if sourceItems[0].Metadata == nil ||
		sourceItems[0].Metadata.OriginalPath != "/DCIM/photo.jpg" ||
		sourceItems[0].Metadata.OwnerExternalID != "123" ||
		sourceItems[0].Metadata.RemoteCreatedAt == nil ||
		sourceItems[0].Metadata.RemoteCreatedAt.Unix() != createdA1.Unix() ||
		sourceItems[0].Metadata.ContentMD5 != strings.Repeat("a", 32) ||
		sourceItems[0].Metadata.ThumbnailURL != "https://thumb.example/photo" {
		t.Fatalf("synced source metadata=%+v", sourceItems[0].Metadata)
	}
	if sourceItems[1].State != meta.SourceItemStateMissing ||
		sourceItems[1].Metadata == nil ||
		sourceItems[1].Metadata.OwnerExternalID != "999" ||
		sourceItems[1].Metadata.ContentMD5 != strings.Repeat("b", 32) {
		t.Fatalf("missing source metadata=%+v", sourceItems[1])
	}

	res = request(t, router, http.MethodGet,
		itemsListPath+"?state="+meta.SourceItemStateMissing, tokenA, nil, http.StatusOK)
	sourceItems = nil
	if err := json.Unmarshal(res.Body.Bytes(), &sourceItems); err != nil {
		t.Fatal(err)
	}
	if len(sourceItems) != 1 || sourceItems[0].ExternalID != itemA2.ExternalID {
		t.Fatalf("missing-filter source items=%+v", sourceItems)
	}

	res = request(t, router, http.MethodGet, itemsListPath+"?limit=1&offset=1", tokenA, nil, http.StatusOK)
	sourceItems = nil
	if err := json.Unmarshal(res.Body.Bytes(), &sourceItems); err != nil {
		t.Fatal(err)
	}
	if len(sourceItems) != 1 || sourceItems[0].ExternalID != itemA2.ExternalID {
		t.Fatalf("paginated source items=%+v", sourceItems)
	}
	request(t, router, http.MethodGet, itemsListPath+"?state=invalid", tokenA, nil, http.StatusBadRequest)
	request(t, router, http.MethodGet, itemsListPath+"?limit=1001", tokenA, nil, http.StatusBadRequest)
	request(t, router, http.MethodGet, itemsListPath+"?offset=-1", tokenA, nil, http.StatusBadRequest)
	request(t, router, http.MethodGet, itemsListPath, tokenB, nil, http.StatusNotFound)

	listPath := fmt.Sprintf("/api/v1/sources/%d/collections", sourceA.ID)
	res = request(t, router, http.MethodGet, listPath, tokenA, nil, http.StatusOK)
	var collections []sourceCollectionDTO
	if err := json.Unmarshal(res.Body.Bytes(), &collections); err != nil {
		t.Fatal(err)
	}
	if len(collections) != 2 {
		t.Fatalf("collections=%d want=2: %+v", len(collections), collections)
	}
	byID := map[uint64]sourceCollectionDTO{}
	for _, collection := range collections {
		byID[collection.ID] = collection
	}
	if got := byID[active.ID]; got.State != meta.SourceCollectionStateActive || got.ItemCount != 2 || got.RemoteRevision != "r2" {
		t.Fatalf("active collection=%+v", got)
	}
	if got := byID[missing.ID]; got.State != meta.SourceCollectionStateMissing || got.ItemCount != 0 {
		t.Fatalf("missing collection=%+v", got)
	}

	res = request(t, router, http.MethodGet,
		listPath+"?state="+meta.SourceCollectionStateActive, tokenA, nil, http.StatusOK)
	collections = nil
	if err := json.Unmarshal(res.Body.Bytes(), &collections); err != nil {
		t.Fatal(err)
	}
	if len(collections) != 1 || collections[0].ID != active.ID {
		t.Fatalf("active-filter collections=%+v", collections)
	}
	request(t, router, http.MethodGet, listPath+"?state=invalid", tokenA, nil, http.StatusBadRequest)

	itemsPath := fmt.Sprintf("/api/v1/sources/%d/collections/%d/items", sourceA.ID, active.ID)
	res = request(t, router, http.MethodGet, itemsPath, tokenA, nil, http.StatusOK)
	var members []sourceCollectionItemDTO
	if err := json.Unmarshal(res.Body.Bytes(), &members); err != nil {
		t.Fatal(err)
	}
	if len(members) != 2 || members[0].Position != 0 || members[0].ExternalID != itemA1.ExternalID ||
		members[0].NodeID == nil || *members[0].NodeID != nodeA.ID ||
		members[0].Metadata == nil || members[0].Metadata.OwnerExternalID != "123" ||
		members[0].Metadata.ContentMD5 != strings.Repeat("a", 32) ||
		members[1].Position != 1 || members[1].ExternalID != itemA2.ExternalID ||
		members[1].State != meta.SourceItemStateMissing ||
		members[1].Metadata == nil || members[1].Metadata.OwnerExternalID != "999" ||
		members[1].Metadata.ContentMD5 != strings.Repeat("b", 32) {
		t.Fatalf("collection members=%+v", members)
	}

	res = request(t, router, http.MethodGet, itemsPath+"?limit=1&offset=1", tokenA, nil, http.StatusOK)
	members = nil
	if err := json.Unmarshal(res.Body.Bytes(), &members); err != nil {
		t.Fatal(err)
	}
	if len(members) != 1 || members[0].ExternalID != itemA2.ExternalID {
		t.Fatalf("paginated collection members=%+v", members)
	}
	request(t, router, http.MethodGet, itemsPath+"?limit=1001", tokenA, nil, http.StatusBadRequest)
	request(t, router, http.MethodGet, itemsPath+"?offset=-1", tokenA, nil, http.StatusBadRequest)

	request(t, router, http.MethodGet, listPath, tokenB, nil, http.StatusNotFound)
	request(t, router, http.MethodGet, itemsPath, tokenB, nil, http.StatusNotFound)
	request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/sources/%d/collections/%d/items", sourceA.ID, private.ID),
		tokenA, nil, http.StatusNotFound)
}
