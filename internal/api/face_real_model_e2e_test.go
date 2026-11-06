package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photoasset"
	"github.com/lazyxu/xdrive/internal/photointelligence"
)

// Uses the public-domain NASA astronaut fixture distributed by scikit-image
// v0.25.2, never a user's photograph. The exact bytes are checked before use.
// Two JPEG encodings intentionally have different original hashes but the same
// face; a duplicate file must not manufacture a second clustering observation.
func TestFaceRealModelGalleryE2E(t *testing.T) {
	if os.Getenv("XD_FACE_REAL_MODEL_E2E") != "1" {
		t.Skip("XD_FACE_REAL_MODEL_E2E is not enabled")
	}
	if runtime.GOOS != "linux" {
		t.Fatal("real face E2E requires the Linux isolated-network runner")
	}
	dsn, socketPath, fixturePath := os.Getenv("XD_TEST_DATABASE_URL"), os.Getenv("XD_FACE_REAL_SOCKET"), os.Getenv("XD_FACE_REAL_FIXTURE")
	if dsn == "" || socketPath == "" || fixturePath == "" {
		t.Fatal("real face model socket, fixture and isolated PostgreSQL are required")
	}
	data, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatal(err)
	}
	if fmt.Sprintf("%x", sha256.Sum256(data)) != "88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5" {
		t.Fatal("unexpected public portrait fixture checksum")
	}
	portrait, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	var originals [][]byte
	for _, quality := range []int{87, 95} {
		var b bytes.Buffer
		if err := jpeg.Encode(&b, portrait, &jpeg.Options{Quality: quality}); err != nil {
			t.Fatal(err)
		}
		originals = append(originals, b.Bytes())
	}
	var blank bytes.Buffer
	if err := jpeg.Encode(&blank, image.NewRGBA(image.Rect(0, 0, 512, 512)), nil); err != nil {
		t.Fatal(err)
	}
	originals = append(originals, blank.Bytes(), originals[0])
	db := openPhotoIntelligenceAPITestDB(t, dsn)
	if err := db.AutoMigrate(&meta.File{}, &meta.MediaMetadata{}, &meta.MediaDerivedResource{}, &meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.SourceItem{}, &meta.SourceCollection{}, &meta.SourceCollectionItem{}, &meta.PhotoMetadata{}, &meta.PhotoCollection{}, &meta.PhotoCollectionAsset{}, &meta.PhotoEditRecipe{},
		&meta.PhotoFace{}, &meta.PhotoPersonCluster{}, &meta.PhotoPersonClusterFace{}, &meta.PhotoPerson{}, &meta.PhotoPersonAsset{}, &meta.PhotoPersonSuggestionReview{}, &meta.PhotoOCRText{}); err != nil {
		t.Fatal(err)
	}
	if err := photoasset.InstallContentIdentitySchema(db); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	owner := meta.User{Username: "real-face-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	foreign := meta.User{Username: "real-face-foreign", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&foreign).Error; err != nil {
		t.Fatal(err)
	}
	server := &Server{DB: db, Store: mustLocalStore(t)}
	nodes := make([]meta.Node, len(originals))
	byID := make(map[uint64][]byte)
	for i, original := range originals {
		nodes[i] = meta.Node{OwnerID: owner.ID, Name: fmt.Sprintf("portrait-fixture-%d.jpg", i), Type: meta.NodeTypeFile, Revision: 1}
		if err := db.Create(&nodes[i]).Error; err != nil {
			t.Fatal(err)
		}
		file := meta.File{NodeID: nodes[i].ID, Size: int64(len(original)), SHA256: fmt.Sprintf("%x", sha256.Sum256(original)), StorageKey: nodes[i].Name}
		if _, err := server.Store.Put(ctx, file.StorageKey, bytes.NewReader(original)); err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&file).Error; err != nil {
			t.Fatal(err)
		}
		nodes[i].File = &file
		byID[nodes[i].ID] = original
		if _, err := server.indexMediaNode(ctx, nodes[i]); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := photoasset.ReconcileOwner(ctx, db, owner.ID); err != nil {
		t.Fatal(err)
	}
	preview := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, parseErr := strconv.ParseUint(strings.TrimPrefix(r.URL.Path, "/api/v1/media-analysis-preview/"), 10, 64)
		body, found := byID[id]
		if parseErr != nil || !found || r.Method != http.MethodGet || r.URL.RawQuery != "ticket=face-fixture" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Content-Length", strconv.Itoa(len(body)))
		w.Header().Set("ETag", mediapkg.AnalysisPreviewETag(id, 1, fmt.Sprintf("%x", sha256.Sum256(body))))
		w.Header().Set("X-XDrive-Analysis-Preview-Version", strconv.Itoa(mediapkg.AnalysisPreviewVersion))
		w.Header().Set("X-XDrive-Analysis-Preview-Edge", strconv.Itoa(mediapkg.AnalysisPreviewEdge))
		_, _ = w.Write(body)
	}))
	previewOrigin := os.Getenv("XD_FACE_REAL_PREVIEW_ORIGIN")
	listenAddress := os.Getenv("XD_FACE_REAL_PREVIEW_LISTEN")
	if previewOrigin == "" || listenAddress == "" {
		t.Fatal("isolated preview origin and listen address are required")
	}
	listener, err := net.Listen("tcp", listenAddress)
	if err != nil {
		t.Fatal(err)
	}
	_ = preview.Listener.Close()
	preview.Listener = listener
	preview.Start()
	defer preview.Close()
	analyzer := faceRealAwaitModel(t, ctx, socketPath)
	runner := &photointelligence.FaceRunner{DB: db, Analyzer: analyzer, PreviewURL: func(_ context.Context, uid, session, node, revision uint64) (string, error) {
		if uid != owner.ID || session != owner.SessionVersion || revision != 1 || byID[node] == nil {
			return "", fmt.Errorf("unexpected Owner/original preview identity")
		}
		return previewOrigin + fmt.Sprintf("/api/v1/media-analysis-preview/%d?ticket=face-fixture", node), nil
	}}
	if count, err := runner.RunOwnerBatch(ctx, owner.ID, 10); err != nil || count != 3 {
		t.Fatalf("actual model pipeline: count=%d err=%v", count, err)
	}
	var faces int64
	if err := db.Model(&meta.PhotoFace{}).Count(&faces).Error; err != nil {
		t.Fatal(err)
	}
	if faces != 2 {
		t.Fatalf("actual YuNet detections=%d; expected two originals, zero blank, no duplicate-copy face", faces)
	}
	if err := (&photointelligence.PersonClusterRunner{DB: db}).RunOwner(ctx, owner.ID); err != nil {
		t.Fatal(err)
	}
	groups, err := queryMediaSuggestedPeople(ctx, db, owner.ID, 24)
	if err != nil || len(groups) != 1 || groups[0].ItemCount != 2 {
		t.Fatalf("actual SFace grouping: %+v %v", groups, err)
	}
	nextGroups, err := queryMediaSuggestedPeopleWithReview(ctx, db, owner.ID, false, 24, 1)
	if err != nil || len(nextGroups) != 0 {
		t.Fatalf("group pagination repeated first page: %+v %v", nextGroups, err)
	}
	items, err := server.queryMediaItems(ctx, owner.ID, mediaQueryOptions{PersonCluster: groups[0].ID}, "", 10, 0)
	if err != nil || len(items) != 2 || items[0].ContentKey == "" || items[1].ContentKey == "" || items[0].ContentKey == items[1].ContentKey {
		t.Fatalf("actual group Gallery: %+v %v", items, err)
	}
	private, err := queryMediaSuggestedPeople(ctx, db, foreign.ID, 24)
	if err != nil || len(private) != 0 {
		t.Fatalf("foreign Owner face suggestions leaked: %+v %v", private, err)
	}
	hidden, err := server.queryMediaItems(ctx, foreign.ID, mediaQueryOptions{PersonCluster: groups[0].ID}, "", 10, 0)
	if err != nil || len(hidden) != 0 {
		t.Fatalf("foreign Owner group pixels leaked: %d %v", len(hidden), err)
	}
	// A stale result must disappear immediately, even before background reindex.
	if err := db.Model(&meta.File{}).Where("node_id = ?", nodes[1].ID).Update("sha256", fmt.Sprintf("%x", sha256.Sum256(blank.Bytes()))).Error; err != nil {
		t.Fatal(err)
	}
	groups, err = queryMediaSuggestedPeople(ctx, db, owner.ID, 24)
	if err != nil || len(groups) != 0 {
		t.Fatalf("stale real-model suggestion remained visible: %+v %v", groups, err)
	}
}

// The orchestrator starts a model-only container and PostgreSQL on an isolated
// Docker network. This test has no Docker socket or host management capability.
func faceRealAwaitModel(t *testing.T, ctx context.Context, socketPath string) *photointelligence.UnixFaceAnalyzer {
	t.Helper()
	token := os.Getenv("XD_FACE_REAL_TOKEN")
	if len(token) != 64 {
		t.Fatal("isolated model test bearer token is required")
	}
	client, err := photointelligence.NewUnixFaceAnalyzer(socketPath, token, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		probe, stop := context.WithTimeout(ctx, time.Second)
		_, err := client.Info(probe)
		stop()
		if err == nil {
			return client
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatal("real face model failed to start")
	return nil
}
