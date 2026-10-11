package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image/jpeg"
	"image/png"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// This test uses the real authenticated Go Router, PostgreSQL schema, photo
// indexing/derivative work, scheduler, Unix-socket creative protocol and CAS.
// The bounded Unix endpoint returns deterministic decodable PNG bytes rather
// than running EfficientSAM; model inference has a separate acceptance gate.
func TestMediaCreativeAuthenticatedGoPostgresCASUnixWorker(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	adminDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	adminSQL, err := adminDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer adminSQL.Close()

	schema := "p12i_creative_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := adminDB.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = adminDB.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error })

	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(6)
	sqlDB.SetMaxIdleConns(0)
	defer sqlDB.Close()

	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{},
		&meta.FileVersion{}, &meta.ContentBlob{}, &meta.ContentDigestAlias{},
		&meta.Share{}, &meta.UploadSession{}, &meta.UploadPart{}, &meta.AuditEvent{},
		&meta.Source{}, &meta.SourceItem{}, &meta.SourceCollection{},
		&meta.SourceCollectionItem{}, &meta.MediaMetadata{},
		&meta.MediaDerivedResource{}, &meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoEditRecipe{}, &meta.PhotoResource{},
		&meta.PhotoMetadata{}, &meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
		&meta.PhotoCreativeGeneration{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL").Error; err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	workerSocket := filepath.Join(t.TempDir(), "creative.sock")
	listener, err := net.Listen("unix", workerSocket)
	if err != nil {
		t.Fatal(err)
	}
	pngBytes := testPNG(t, 4, 3)
	sawTask := make(chan photointelligence.CreativeTask, 4)
	startedCancellation := make(chan struct{}, 1)
	var workerCalls atomic.Int32
	info := photointelligence.CreativeAnalyzerInfo{
		ProtocolVersion: photointelligence.CreativeAnalyzerProtocolVersion,
		Name:            "xdrive-creative-e2e-unix-protocol",
		PipelineVersion: "p12i-1",
		SegmentModel: photointelligence.FaceAnalyzerModelInfo{
			Name: "test-segment-model", Version: "1",
			SHA256: strings.Repeat("a", 64), License: "Apache-2.0",
		},
		Capabilities: []string{
			photointelligence.CreativeCapabilityCutout,
			photointelligence.CreativeCapabilityErase,
		},
	}
	worker := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("X-XDrive-Creative-Protocol") != "1" || r.Header.Get("Authorization") != "Bearer creative-secret" {
			http.Error(w, "unauthorized creative protocol", http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/v1/creative-info":
			_ = json.NewEncoder(w).Encode(info)
		case "/v1/creative-generate":
			var task photointelligence.CreativeTask
			if err := json.NewDecoder(r.Body).Decode(&task); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if err := photointelligence.ValidateCreativeTask(task); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			// The Unix worker actually downloads the Server's signed,
			// revision-bound derivative; this is not a fabricated preview.
			preview, err := (&http.Client{Timeout: 15 * time.Second}).Get(task.PreviewURL)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadGateway)
				return
			}
			cfg, err := jpeg.DecodeConfig(preview.Body)
			_ = preview.Body.Close()
			if err != nil || preview.StatusCode != http.StatusOK || cfg.Width != 8 || cfg.Height != 6 {
				http.Error(w, fmt.Sprintf("bad creative preview status=%d image=%+v err=%v", preview.StatusCode, cfg, err), http.StatusBadGateway)
				return
			}
			sawTask <- task
			switch workerCalls.Add(1) {
			case 1, 2:
				_ = json.NewEncoder(w).Encode(photointelligence.CreativeResult{
					Data: pngBytes, MIMEType: "image/png", Width: 4, Height: 3,
				})
			case 3:
				startedCancellation <- struct{}{}
				<-r.Context().Done()
			default:
				// Valid metadata with corrupt bytes must never produce a
				// completed job, CAS reference, or downloadable Node.
				_ = json.NewEncoder(w).Encode(photointelligence.CreativeResult{
					Data: []byte("not-a-png"), MIMEType: "image/png", Width: 4, Height: 3,
				})
			}
		default:
			http.NotFound(w, r)
		}
	})}
	go func() { _ = worker.Serve(listener) }()
	defer worker.Close()
	analyzer, err := photointelligence.NewUnixCreativeAnalyzer(workerSocket, "creative-secret", 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	scheduler := background.NewScheduler(context.Background(), background.Config{
		Capacity: map[background.ResourceClass]int{
			background.ResourceMediaCPU: 2, background.ResourceMLCPU: 1,
		},
		QueueCapacity: map[background.ResourceClass]int{
			background.ResourceMediaCPU: 8, background.ResourceMLCPU: 8,
		},
	})
	defer scheduler.Close()
	server := &Server{
		DB: db, Store: store, Auth: auth.New("p12i-creative-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
		MaxUploadBytes: 10 << 20, BackgroundScheduler: scheduler,
		PhotoCreativeAnalyzer: analyzer,
	}
	router := server.Router()
	httpServer := httptest.NewServer(router)
	defer httpServer.Close()
	server.PhotoFacePreviewBaseURL = httpServer.URL

	token := createTestUser(t, db, router, "p12i-owner", "password-p12i")
	other := createTestUser(t, db, router, "p12i-other", "password-other")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	folder := requestNode(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID), token,
		strings.NewReader("{\"name\":\"P12I Camera\"}"), http.StatusCreated)
	originalBytes := testPNG(t, 8, 6)
	source := uploadTestFile(t, router, token, folder.ID,
		"original.png", string(originalBytes))
	path := fmt.Sprintf("/api/v1/media/items/%d/creative", source.ID)
	input := strings.NewReader("{\"kind\":\"cutout\",\"cutout_mode\":\"object\",\"points\":[{\"x\":0.5,\"y\":0.5,\"foreground\":true}]}")
	created := request(t, router, http.MethodPost, path, token, input, http.StatusAccepted)
	var job mediaCreativeGenerationDTO
	if err := json.Unmarshal(created.Body.Bytes(), &job); err != nil {
		t.Fatal(err)
	}
	if job.ID == "" || job.State != meta.PhotoCreativeStateQueued || job.SourceNodeID != source.ID {
		t.Fatalf("created job=%+v", job)
	}
	request(t, router, http.MethodGet, "/api/v1/media/creative/"+job.ID,
		other, nil, http.StatusNotFound)
	request(t, router, http.MethodPost, path, other,
		strings.NewReader("{\"kind\":\"cutout\"}"), http.StatusNotFound)

	completed := waitMediaCreativeEnd(t, router, token, job.ID)
	if completed.State != meta.PhotoCreativeStateCompleted || completed.OutputNodeID == nil || *completed.OutputNodeID == source.ID {
		t.Fatalf("completed job=%+v", completed)
	}
	select {
	case task := <-sawTask:
		if task.Kind != meta.PhotoCreativeKindCutout || task.CutoutMode != "object" ||
			len(task.Points) != 1 || !task.Points[0].Foreground || task.PreviewEdge <= 0 ||
			task.InputFingerprint == "" {
			t.Fatalf("Unix worker received wrong signed creative task=%+v", task)
		}
	default:
		t.Fatal("Unix worker never received creative task")
	}
	var output meta.Node
	if err := db.Preload("File").First(&output, *completed.OutputNodeID).Error; err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(pngBytes)
	expectedHash := hex.EncodeToString(hash[:])
	key, err := storage.ContentAddressedKey(expectedHash)
	if err != nil {
		t.Fatal(err)
	}
	if output.OwnerID == 0 || output.ParentID == nil || *output.ParentID != folder.ID ||
		output.File == nil || output.File.StorageKey != key || output.File.SHA256 != expectedHash ||
		output.File.Size != int64(len(pngBytes)) {
		t.Fatalf("completed Node/CAS mismatch: %+v file=%+v", output, output.File)
	}
	stored, err := store.Open(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	storedBytes, err := io.ReadAll(stored)
	_ = stored.Close()
	if err != nil || !bytes.Equal(storedBytes, pngBytes) {
		t.Fatal("real CAS bytes differ from generated image")
	}
	downloaded := request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/files/%d/content", output.ID), token, nil, http.StatusOK)
	if !bytes.Equal(downloaded.Body.Bytes(), pngBytes) {
		t.Fatal("authenticated Server download differs from CAS")
	}
	decoded, err := png.Decode(bytes.NewReader(downloaded.Body.Bytes()))
	if err != nil || decoded.Bounds().Dx() != 4 || decoded.Bounds().Dy() != 3 {
		t.Fatalf("generated download not decodable: dimensions=%v err=%v", decoded, err)
	}
	request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/files/%d/content", output.ID), other, nil, http.StatusNotFound)
	unchanged := request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/files/%d/content", source.ID), token, nil, http.StatusOK)
	if !bytes.Equal(unchanged.Body.Bytes(), originalBytes) {
		t.Fatal("creative task mutated the original file")
	}

	// A second real API write exercises smart erase through the same worker,
	// SQL commit and CAS deduplication; Web/Mobile Web use identical endpoints.
	erase := request(t, router, http.MethodPost, path, token,
		strings.NewReader("{\"kind\":\"erase\",\"strokes\":[{\"radius\":0.03,\"points\":[{\"x\":0.5,\"y\":0.5}]}]}"),
		http.StatusAccepted)
	var eraseJob mediaCreativeGenerationDTO
	if err := json.Unmarshal(erase.Body.Bytes(), &eraseJob); err != nil {
		t.Fatal(err)
	}
	eraseDone := waitMediaCreativeEnd(t, router, token, eraseJob.ID)
	if eraseDone.State != meta.PhotoCreativeStateCompleted || eraseDone.OutputNodeID == nil ||
		*eraseDone.OutputNodeID == *completed.OutputNodeID {
		t.Fatalf("erase did not commit separate canonical output: %+v", eraseDone)
	}
	var eraseOutput meta.Node
	if err := db.Preload("File").First(&eraseOutput, *eraseDone.OutputNodeID).Error; err != nil {
		t.Fatal(err)
	}
	if eraseOutput.File == nil || eraseOutput.File.SHA256 != expectedHash ||
		eraseOutput.File.StorageKey != key {
		t.Fatalf("erase output did not reuse content-addressed bytes: %+v", eraseOutput.File)
	}
	select {
	case task := <-sawTask:
		if task.Kind != meta.PhotoCreativeKindErase || len(task.Strokes) != 1 ||
			len(task.Strokes[0].Points) != 1 {
			t.Fatalf("Unix worker received wrong erase payload: %+v", task)
		}
	default:
		t.Fatal("Unix worker never received erase job")
	}

	// A running creative job cannot publish a phantom output after explicit
	// cancellation, even if the Worker was already running the operation.
	cancelStarted := request(t, router, http.MethodPost, path, token,
		strings.NewReader("{\"kind\":\"cutout\",\"cutout_mode\":\"object\",\"points\":[{\"x\":0.5,\"y\":0.5,\"foreground\":true}]}"), http.StatusAccepted)
	var cancelledJob mediaCreativeGenerationDTO
	if err := json.Unmarshal(cancelStarted.Body.Bytes(), &cancelledJob); err != nil {
		t.Fatal(err)
	}
	select {
	case <-startedCancellation:
	case <-time.After(15 * time.Second):
		t.Fatal("cancel test did not reach Unix worker")
	}
	cancelAck := request(t, router, http.MethodPost,
		"/api/v1/media/creative/"+cancelledJob.ID+"/cancel", token,
		strings.NewReader("{}"), http.StatusOK)
	var cancelled mediaCreativeGenerationDTO
	if err := json.Unmarshal(cancelAck.Body.Bytes(), &cancelled); err != nil {
		t.Fatal(err)
	}
	if cancelled.State != meta.PhotoCreativeStateCancelled || cancelled.OutputNodeID != nil {
		t.Fatalf("cancellation incorrectly produced an output: %+v", cancelled)
	}
	cancelled = waitMediaCreativeEnd(t, router, token, cancelledJob.ID)
	if cancelled.State != meta.PhotoCreativeStateCancelled || cancelled.OutputNodeID != nil {
		t.Fatalf("cancelled job became completed: %+v", cancelled)
	}

	// An invalid but superficially well-formed worker response must fail
	// before the SQL/CAS commit; this is a real Worker-byte integrity gate.
	failedStart := request(t, router, http.MethodPost, path, token,
		strings.NewReader("{\"kind\":\"cutout\",\"cutout_mode\":\"object\",\"points\":[{\"x\":0.5,\"y\":0.5,\"foreground\":true}]}"), http.StatusAccepted)
	var failedJob mediaCreativeGenerationDTO
	if err := json.Unmarshal(failedStart.Body.Bytes(), &failedJob); err != nil {
		t.Fatal(err)
	}
	failed := waitMediaCreativeEnd(t, router, token, failedJob.ID)
	if failed.State != meta.PhotoCreativeStateFailed || failed.OutputNodeID != nil ||
		!strings.Contains(failed.LastError, "creative image") {
		t.Fatalf("invalid Worker bytes incorrectly completed or leaked: %+v", failed)
	}
	var extraFiles int64
	if err := db.Model(&meta.File{}).Count(&extraFiles).Error; err != nil {
		t.Fatal(err)
	}
	if extraFiles != 3 {
		t.Fatalf("cancel/invalid output leaked committed files: count=%d want=3", extraFiles)
	}
}

func waitMediaCreativeEnd(t *testing.T, router http.Handler, token, id string) mediaCreativeGenerationDTO {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		response := request(t, router, http.MethodGet, "/api/v1/media/creative/"+id,
			token, nil, http.StatusOK)
		var job mediaCreativeGenerationDTO
		if err := json.Unmarshal(response.Body.Bytes(), &job); err != nil {
			t.Fatal(err)
		}
		switch job.State {
		case meta.PhotoCreativeStateCompleted, meta.PhotoCreativeStateFailed, meta.PhotoCreativeStateCancelled:
			return job
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("creative task %s did not reach a terminal state", id)
	return mediaCreativeGenerationDTO{}
}
