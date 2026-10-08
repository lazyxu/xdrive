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
	baseSQLDB, err := baseDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer baseSQLDB.Close()
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
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
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
		&meta.PhotoPersonSuggestionReview{},
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

	dismissed := request(
		t, router, http.MethodPatch,
		"/api/v1/media/people/suggestions/"+url.PathEscape(clusterKey)+"/review",
		token,
		strings.NewReader(`{"state":"dismissed"}`),
		http.StatusOK,
	)
	var review mediaPersonSuggestionReviewDTO
	if err := json.Unmarshal(dismissed.Body.Bytes(), &review); err != nil {
		t.Fatal(err)
	}
	if review.ReviewState != meta.PhotoPersonSuggestionReviewStateDismissed {
		t.Fatalf("dismissed review=%+v", review)
	}
	pendingSuggestions := request(
		t, router, http.MethodGet,
		"/api/v1/media/people/suggestions",
		token, nil, http.StatusOK,
	)
	var suggestionRows []mediaSuggestedPersonDTO
	if err := json.Unmarshal(pendingSuggestions.Body.Bytes(), &suggestionRows); err != nil {
		t.Fatal(err)
	}
	if len(suggestionRows) != 0 {
		t.Fatalf("dismissed suggestion leaked: %+v", suggestionRows)
	}
	allSuggestions := request(
		t, router, http.MethodGet,
		"/api/v1/media/people/suggestions?include_reviewed=true",
		token, nil, http.StatusOK,
	)
	if err := json.Unmarshal(allSuggestions.Body.Bytes(), &suggestionRows); err != nil {
		t.Fatal(err)
	}
	if len(suggestionRows) != 1 ||
		suggestionRows[0].ReviewState != meta.PhotoPersonSuggestionReviewStateDismissed {
		t.Fatalf("include_reviewed suggestions=%+v", suggestionRows)
	}
	request(
		t, router, http.MethodPatch,
		"/api/v1/media/people/suggestions/"+url.PathEscape(clusterKey)+"/review",
		token,
		strings.NewReader(`{"state":"pending"}`),
		http.StatusOK,
	)

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

	acceptedSuggestions := request(
		t, router, http.MethodGet,
		"/api/v1/media/people/suggestions?include_reviewed=true",
		token, nil, http.StatusOK,
	)
	suggestionRows = nil
	if err := json.Unmarshal(acceptedSuggestions.Body.Bytes(), &suggestionRows); err != nil {
		t.Fatal(err)
	}
	if len(suggestionRows) != 1 ||
		suggestionRows[0].ReviewState != meta.PhotoPersonSuggestionReviewStateAccepted ||
		suggestionRows[0].TargetPersonID == nil ||
		*suggestionRows[0].TargetPersonID != person.ID {
		t.Fatalf("accepted suggestion review=%+v person=%+v", suggestionRows, person)
	}
	defaultSuggestions := request(
		t, router, http.MethodGet,
		"/api/v1/media/people/suggestions",
		token, nil, http.StatusOK,
	)
	suggestionRows = nil
	if err := json.Unmarshal(defaultSuggestions.Body.Bytes(), &suggestionRows); err != nil {
		t.Fatal(err)
	}
	if len(suggestionRows) != 0 {
		t.Fatalf("accepted suggestion leaked into pending list: %+v", suggestionRows)
	}
	request(
		t, router, http.MethodPatch,
		"/api/v1/media/people/suggestions/"+url.PathEscape(clusterKey)+"/review",
		token,
		strings.NewReader(`{"state":"pending"}`),
		http.StatusConflict,
	)

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

	personRangeResponse := request(
		t, router, http.MethodGet,
		"/api/v1/media/people/identities/"+url.PathEscape(person.ID)+
			"/items?range=true&limit=1&offset=1",
		token, nil, http.StatusOK,
	)
	var personRange mediaItemRangeDTO
	if err := json.Unmarshal(personRangeResponse.Body.Bytes(), &personRange); err != nil {
		t.Fatal(err)
	}
	if personRange.TotalCount != 2 || personRange.Offset != 1 || personRange.Limit != 1 ||
		len(personRange.Items) != 1 {
		t.Fatalf("person range=%+v", personRange)
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

	var splitPersonRecord meta.PhotoPerson
	if err := db.Where(
		"owner_id = ? AND person_key = ?",
		owner.ID,
		splitResult.Created.ID,
	).First(&splitPersonRecord).Error; err != nil {
		t.Fatal(err)
	}
	mergeReviewKey := mediaSuggestedPersonKeyPrefix + strings.Repeat("f", 64)
	if err := db.Create(&meta.PhotoPersonSuggestionReview{
		OwnerID:        owner.ID,
		SuggestionKey:  mergeReviewKey,
		State:          meta.PhotoPersonSuggestionReviewStateAccepted,
		TargetPersonID: &splitPersonRecord.ID,
	}).Error; err != nil {
		t.Fatal(err)
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
	var targetPersonRecord meta.PhotoPerson
	if err := db.Where(
		"owner_id = ? AND person_key = ?",
		owner.ID,
		person.ID,
	).First(&targetPersonRecord).Error; err != nil {
		t.Fatal(err)
	}
	var mergedReview meta.PhotoPersonSuggestionReview
	if err := db.Where(
		"owner_id = ? AND suggestion_key = ?",
		owner.ID,
		mergeReviewKey,
	).First(&mergedReview).Error; err != nil {
		t.Fatal(err)
	}
	if mergedReview.TargetPersonID == nil ||
		*mergedReview.TargetPersonID != targetPersonRecord.ID {
		t.Fatalf(
			"merged review target=%v want=%d",
			mergedReview.TargetPersonID,
			targetPersonRecord.ID,
		)
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

	thirdNode := meta.Node{
		ParentID: &root.ID,
		Name:     "alice-three.jpg",
		Type:     meta.NodeTypeFile,
		OwnerID:  owner.ID,
		Revision: 1,
	}
	if err := db.Create(&thirdNode).Error; err != nil {
		t.Fatal(err)
	}
	thirdFile := meta.File{
		NodeID:     thirdNode.ID,
		Size:       30,
		StorageKey: "alice-three",
		SHA256:     strings.Repeat("d", 64),
	}
	if err := db.Create(&thirdFile).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.MediaMetadata{
		NodeID: thirdNode.ID, OwnerID: owner.ID, NodeRevision: 1,
		SHA256: thirdFile.SHA256, MediaKind: meta.MediaKindImage,
		MIMEType: "image/jpeg", Width: 100, Height: 100,
		IndexState:              meta.MediaIndexStateReady,
		RelationEvidenceVersion: mediapkg.RelationEvidenceVersion,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := photoasset.ReconcileOwner(context.Background(), db, owner.ID); err != nil {
		t.Fatal(err)
	}
	var thirdAsset meta.PhotoAsset
	if err := db.Where(
		"owner_id = ? AND primary_node_id = ?",
		owner.ID,
		thirdNode.ID,
	).First(&thirdAsset).Error; err != nil {
		t.Fatal(err)
	}
	secondClusterKey := mediaSuggestedPersonKeyPrefix + strings.Repeat("e", 64)
	secondCluster := meta.PhotoPersonCluster{
		OwnerID: owner.ID, ClusterKey: secondClusterKey,
		AnalyzerVersion:  cluster.AnalyzerVersion,
		Embedding:        []byte{4, 3, 2, 1},
		EmbeddingFormat:  "f32le",
		EmbeddingVersion: cluster.EmbeddingVersion,
	}
	if err := db.Create(&secondCluster).Error; err != nil {
		t.Fatal(err)
	}
	secondFaces := []meta.PhotoFace{
		{
			AssetID: assets[1].ID, DetectionKey: "face:001",
			AnalyzerVersion: "detector-v1",
			X:               0.5, Y: 0.1, Width: 0.3, Height: 0.3, Confidence: 0.95,
			Embedding:       []byte{4, 3, 2, 1},
			EmbeddingFormat: "f32le", EmbeddingVersion: "embed-v1",
		},
		{
			AssetID: thirdAsset.ID, DetectionKey: "face:000",
			AnalyzerVersion: "detector-v1",
			X:               0.1, Y: 0.1, Width: 0.3, Height: 0.3, Confidence: 0.97,
			Embedding:       []byte{4, 3, 2, 1},
			EmbeddingFormat: "f32le", EmbeddingVersion: "embed-v1",
		},
	}
	if err := db.Create(&secondFaces).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&[]meta.PhotoPersonClusterFace{
		{ClusterID: secondCluster.ID, FaceID: secondFaces[0].ID, Confidence: 0.94},
		{ClusterID: secondCluster.ID, FaceID: secondFaces[1].ID, Confidence: 0.96},
	}).Error; err != nil {
		t.Fatal(err)
	}

	attached := requestWithHeaders(
		t, router, http.MethodPost,
		"/api/v1/media/people/identities/"+url.PathEscape(person.ID)+
			"/suggestions/"+url.PathEscape(secondClusterKey),
		token,
		nil,
		http.StatusOK,
		map[string]string{"If-Match": `"4"`},
	)
	if err := json.Unmarshal(attached.Body.Bytes(), &person); err != nil {
		t.Fatal(err)
	}
	if person.Revision != 5 || person.ItemCount != 3 {
		t.Fatalf("person after adding suggestion=%+v", person)
	}
	reviewedSuggestions := request(
		t, router, http.MethodGet,
		"/api/v1/media/people/suggestions?include_reviewed=true&limit=100",
		token, nil, http.StatusOK,
	)
	suggestionRows = nil
	if err := json.Unmarshal(reviewedSuggestions.Body.Bytes(), &suggestionRows); err != nil {
		t.Fatal(err)
	}
	var attachedReview *mediaSuggestedPersonDTO
	for index := range suggestionRows {
		if suggestionRows[index].ID == secondClusterKey {
			attachedReview = &suggestionRows[index]
			break
		}
	}
	if attachedReview == nil ||
		attachedReview.ReviewState != meta.PhotoPersonSuggestionReviewStateAccepted ||
		attachedReview.TargetPersonID == nil ||
		*attachedReview.TargetPersonID != person.ID {
		t.Fatalf("attached suggestion review=%+v all=%+v", attachedReview, suggestionRows)
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
	if len(mediaItems) != 3 {
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
