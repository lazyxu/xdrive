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

func TestDurablePersonIdentityLifecycle(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "media_person_identity_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		&meta.User{}, &meta.Node{}, &meta.File{},
		&meta.Source{}, &meta.SourceItem{},
		&meta.SourceCollection{}, &meta.SourceCollectionItem{},
		&meta.MediaMetadata{}, &meta.MediaDerivedResource{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
		&meta.PhotoAnalysisState{}, &meta.PhotoFace{},
		&meta.PhotoPersonCluster{}, &meta.PhotoPersonClusterFace{},
		&meta.PhotoPersonClusterState{},
		&meta.PhotoPerson{}, &meta.PhotoPersonAsset{},
	); err != nil {
		t.Fatal(err)
	}

	manager := auth.New("durable-person-secret", time.Hour)
	server := &Server{
		DB: db, Store: mustLocalStore(t), Auth: manager,
		RefreshTTL: time.Hour, AllowedOrigin: "http://localhost",
		MaxUploadBytes: 10 << 20,
	}
	router := server.Router()

	owner := meta.User{
		Username: "durable-person-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	other := meta.User{
		Username: "durable-person-other", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	token, err := manager.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	otherToken, err := manager.Issue(other.ID, other.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}

	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	nodes := []meta.Node{
		{ParentID: &root.ID, Name: "alice-one.jpg", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{ParentID: &root.ID, Name: "alice-two.jpg", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
	}
	if err := db.Create(&nodes).Error; err != nil {
		t.Fatal(err)
	}
	files := []meta.File{
		{NodeID: nodes[0].ID, Size: 10, StorageKey: "alice-one", SHA256: strings.Repeat("a", 64)},
		{NodeID: nodes[1].ID, Size: 20, StorageKey: "alice-two", SHA256: strings.Repeat("b", 64)},
	}
	if err := db.Create(&files).Error; err != nil {
		t.Fatal(err)
	}
	for index := range nodes {
		if err := db.Create(&meta.MediaMetadata{
			NodeID: nodes[index].ID, OwnerID: owner.ID, NodeRevision: 1,
			SHA256: files[index].SHA256, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", Width: 100, Height: 100,
			IndexState:              meta.MediaIndexStateReady,
			RelationEvidenceVersion: mediapkg.RelationEvidenceVersion,
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if _, err := photoasset.ReconcileOwner(context.Background(), db, owner.ID); err != nil {
		t.Fatal(err)
	}

	var assets []meta.PhotoAsset
	if err := db.Where("owner_id = ?", owner.ID).
		Order("primary_node_id ASC").
		Find(&assets).Error; err != nil {
		t.Fatal(err)
	}
	if len(assets) != 2 {
		t.Fatalf("assets=%+v", assets)
	}
	manualPeople := `["Manual Alice"]`
	for _, asset := range assets {
		if err := db.Model(&meta.PhotoMetadata{}).
			Where("asset_id = ?", asset.ID).
			Update("people_json", manualPeople).Error; err != nil {
			t.Fatal(err)
		}
	}

	clusterKey := mediaSuggestedPersonKeyPrefix + strings.Repeat("c", 64)
	cluster := meta.PhotoPersonCluster{
		OwnerID: owner.ID, ClusterKey: clusterKey,
		AnalyzerVersion:  "cluster-v1",
		Embedding:        []byte{1, 2, 3, 4},
		EmbeddingFormat:  "f32le",
		EmbeddingVersion: "embed-v1",
	}
	if err := db.Create(&cluster).Error; err != nil {
		t.Fatal(err)
	}
	state := meta.PhotoPersonClusterState{
		OwnerID: owner.ID, AnalyzerVersion: cluster.AnalyzerVersion,
		EmbeddingVersion: cluster.EmbeddingVersion,
		InputFingerprint: "person-input:test",
		FaceCount:        2, State: meta.PhotoAnalysisStateReady,
		Attempt: 1,
	}
	if err := db.Create(&state).Error; err != nil {
		t.Fatal(err)
	}
	faces := []meta.PhotoFace{
		{
			AssetID: assets[0].ID, DetectionKey: "face:000",
			AnalyzerVersion: "detector-v1",
			X:               0.1, Y: 0.1, Width: 0.3, Height: 0.3, Confidence: 0.90,
			Embedding:       []byte{1, 2, 3, 4},
			EmbeddingFormat: "f32le", EmbeddingVersion: "embed-v1",
		},
		{
			AssetID: assets[1].ID, DetectionKey: "face:000",
			AnalyzerVersion: "detector-v1",
			X:               0.1, Y: 0.1, Width: 0.3, Height: 0.3, Confidence: 0.99,
			Embedding:       []byte{1, 2, 3, 4},
			EmbeddingFormat: "f32le", EmbeddingVersion: "embed-v1",
		},
	}
	if err := db.Create(&faces).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&[]meta.PhotoPersonClusterFace{
		{ClusterID: cluster.ID, FaceID: faces[0].ID, Confidence: 0.91},
		{ClusterID: cluster.ID, FaceID: faces[1].ID, Confidence: 0.98},
	}).Error; err != nil {
		t.Fatal(err)
	}

	adopt := request(
		t, router, http.MethodPost,
		"/api/v1/media/people/suggestions/"+url.PathEscape(clusterKey)+"/adopt",
		token,
		strings.NewReader(`{"name":"Alice"}`),
		http.StatusCreated,
	)
	var person mediaPersonIdentityDTO
	if err := json.Unmarshal(adopt.Body.Bytes(), &person); err != nil {
		t.Fatal(err)
	}
	if !validMediaPersonIdentityID(person.ID) ||
		person.Name != "Alice" ||
		person.Revision != 1 ||
		person.ItemCount != 2 ||
		person.CoverNodeID == nil ||
		*person.CoverNodeID != nodes[1].ID {
		t.Fatalf("adopted person=%+v", person)
	}

	request(
		t, router, http.MethodPost,
		"/api/v1/media/people/suggestions/"+url.PathEscape(clusterKey)+"/adopt",
		token,
		strings.NewReader(`{"name":"duplicate"}`),
		http.StatusConflict,
	)

	list := request(
		t, router, http.MethodGet,
		"/api/v1/media/people/identities",
		token, nil, http.StatusOK,
	)
	var people []mediaPersonIdentityDTO
	if err := json.Unmarshal(list.Body.Bytes(), &people); err != nil {
		t.Fatal(err)
	}
	if len(people) != 1 || people[0].ID != person.ID {
		t.Fatalf("people=%+v", people)
	}

	items := request(
		t, router, http.MethodGet,
		"/api/v1/media/people/identities/"+url.PathEscape(person.ID)+"/items?limit=100",
		token, nil, http.StatusOK,
	)
	var mediaItems []mediaItemDTO
	if err := json.Unmarshal(items.Body.Bytes(), &mediaItems); err != nil {
		t.Fatal(err)
	}
	if len(mediaItems) != 2 {
		t.Fatalf("person items=%+v", mediaItems)
	}

	filteredItems := request(
		t, router, http.MethodGet,
		"/api/v1/media/items?person_identity="+url.QueryEscape(person.ID)+"&limit=100",
		token, nil, http.StatusOK,
	)
	mediaItems = nil
	if err := json.Unmarshal(filteredItems.Body.Bytes(), &mediaItems); err != nil {
		t.Fatal(err)
	}
	if len(mediaItems) != 2 {
		t.Fatalf("durable person media filter=%+v", mediaItems)
	}

	requestWithHeaders(
		t, router, http.MethodPatch,
		"/api/v1/media/people/identities/"+url.PathEscape(person.ID),
		token,
		strings.NewReader(`{"name":"stale"}`),
		http.StatusConflict,
		map[string]string{"If-Match": `"2"`},
	)

	update := requestWithHeaders(
		t, router, http.MethodPatch,
		"/api/v1/media/people/identities/"+url.PathEscape(person.ID),
		token,
		strings.NewReader(fmt.Sprintf(
			`{"name":"Alice Renamed","hidden":true,"cover_node_id":%d}`,
			nodes[0].ID,
		)),
		http.StatusOK,
		map[string]string{"If-Match": `"1"`},
	)
	if err := json.Unmarshal(update.Body.Bytes(), &person); err != nil {
		t.Fatal(err)
	}
	if person.Revision != 2 ||
		person.Name != "Alice Renamed" ||
		!person.Hidden ||
		person.CoverNodeID == nil ||
		*person.CoverNodeID != nodes[0].ID {
		t.Fatalf("updated person=%+v", person)
	}

	hiddenList := request(
		t, router, http.MethodGet,
		"/api/v1/media/people/identities",
		token, nil, http.StatusOK,
	)
	if err := json.Unmarshal(hiddenList.Body.Bytes(), &people); err != nil {
		t.Fatal(err)
	}
	if len(people) != 0 {
		t.Fatalf("hidden person leaked into default list: %+v", people)
	}
	allList := request(
		t, router, http.MethodGet,
		"/api/v1/media/people/identities?include_hidden=true",
		token, nil, http.StatusOK,
	)
	if err := json.Unmarshal(allList.Body.Bytes(), &people); err != nil {
		t.Fatal(err)
	}
	if len(people) != 1 || !people[0].Hidden {
		t.Fatalf("include_hidden people=%+v", people)
	}

	split := requestWithHeaders(
		t, router, http.MethodPost,
		"/api/v1/media/people/identities/"+url.PathEscape(person.ID)+"/split",
		token,
		strings.NewReader(fmt.Sprintf(
			`{"node_ids":[%d],"name":"Alice B"}`,
			nodes[0].ID,
		)),
		http.StatusOK,
		map[string]string{"If-Match": `"2"`},
	)
	var splitResult mediaPersonSplitDTO
	if err := json.Unmarshal(split.Body.Bytes(), &splitResult); err != nil {
		t.Fatal(err)
	}
	if splitResult.Source.ID != person.ID ||
		splitResult.Source.Revision != 3 ||
		splitResult.Source.ItemCount != 1 ||
		splitResult.Created.Name != "Alice B" ||
		splitResult.Created.Revision != 1 ||
		splitResult.Created.ItemCount != 1 {
		t.Fatalf("split result=%+v", splitResult)
	}

	smartCreate := request(
		t, router, http.MethodPost,
		"/api/v1/media/smart-albums",
		token,
		strings.NewReader(fmt.Sprintf(
			`{"name":"Alice B","query":{"person_identity":%q}}`,
			splitResult.Created.ID,
		)),
		http.StatusCreated,
	)
	var personAlbum mediaAlbumDTO
	if err := json.Unmarshal(smartCreate.Body.Bytes(), &personAlbum); err != nil {
		t.Fatal(err)
	}
	if personAlbum.Query == nil ||
		personAlbum.Query.PersonIdentity != splitResult.Created.ID ||
		personAlbum.ItemCount != 1 ||
		personAlbum.Revision != 1 {
		t.Fatalf("durable person smart album=%+v", personAlbum)
	}

	merged := requestWithHeaders(
		t, router, http.MethodPost,
		"/api/v1/media/people/identities/"+url.PathEscape(person.ID)+"/merge",
		token,
		strings.NewReader(fmt.Sprintf(
			`{"source_ids":[%q]}`,
			splitResult.Created.ID,
		)),
		http.StatusOK,
		map[string]string{"If-Match": `"3"`},
	)
	if err := json.Unmarshal(merged.Body.Bytes(), &person); err != nil {
		t.Fatal(err)
	}
	if person.Revision != 4 || person.ItemCount != 2 {
		t.Fatalf("merged person=%+v", person)
	}
	request(
		t, router, http.MethodGet,
		"/api/v1/media/people/identities/"+url.PathEscape(splitResult.Created.ID)+"/items",
		token, nil, http.StatusNotFound,
	)

	albumsResponse := request(
		t, router, http.MethodGet,
		"/api/v1/media/albums",
		token, nil, http.StatusOK,
	)
	var albums []mediaAlbumDTO
	if err := json.Unmarshal(albumsResponse.Body.Bytes(), &albums); err != nil {
		t.Fatal(err)
	}
	var rewritten *mediaAlbumDTO
	for index := range albums {
		if albums[index].ID == personAlbum.ID {
			rewritten = &albums[index]
			break
		}
	}
	if rewritten == nil ||
		rewritten.Query == nil ||
		rewritten.Query.PersonIdentity != person.ID ||
		rewritten.Revision != 2 ||
		rewritten.ItemCount != 2 {
		t.Fatalf("merged durable person smart album=%+v", rewritten)
	}

	if err := db.Where("id = ?", cluster.ID).
		Delete(&meta.PhotoPersonCluster{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.PhotoPersonClusterState{}).
		Where("owner_id = ?", owner.ID).
		Update("state", meta.PhotoAnalysisStateFailed).Error; err != nil {
		t.Fatal(err)
	}
	items = request(
		t, router, http.MethodGet,
		"/api/v1/media/people/identities/"+url.PathEscape(person.ID)+"/items?limit=100",
		token, nil, http.StatusOK,
	)
	if err := json.Unmarshal(items.Body.Bytes(), &mediaItems); err != nil {
		t.Fatal(err)
	}
	if len(mediaItems) != 2 {
		t.Fatalf("durable person depended on deleted cluster: %+v", mediaItems)
	}

	request(
		t, router, http.MethodGet,
		"/api/v1/media/people/identities/"+url.PathEscape(person.ID)+"/items",
		otherToken, nil, http.StatusNotFound,
	)

	var metadata []meta.PhotoMetadata
	if err := db.Where("asset_id IN ?", []uint64{assets[0].ID, assets[1].ID}).
		Order("asset_id ASC").
		Find(&metadata).Error; err != nil {
		t.Fatal(err)
	}
	if len(metadata) != 2 ||
		metadata[0].PeopleJSON != manualPeople ||
		metadata[1].PeopleJSON != manualPeople {
		t.Fatalf("manual PeopleJSON was changed: %+v", metadata)
	}
}
