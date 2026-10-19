//go:build linux

package api

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Opt-in, authentic 100k SHA-distinct (per and across runs) physical JPEG
// sources. This NEW public ZIP workload is not the historical SH-P005
// individual original download or an installed handset/PWA benchmark.
func TestPublicShareZIP100KPhysical(t *testing.T) {
	if os.Getenv("XD_PUBLIC_SHARE_ZIP_100K") != "1" {
		t.Skip("opt in authentic public shared folder whole ZIP 100k")
	}
	if os.Getenv("XD_TEST_DATABASE_URL") == "" {
		t.Fatal("real PostgreSQL17 required")
	}
	const count = 100000
	sample := os.Getenv("XD_PUBLIC_SHARE_ZIP_SAMPLE")
	if sample != "sample-1" && sample != "sample-2" && sample != "sample-3" {
		t.Fatal("SH-P007 needs sample-1 through sample-3")
	}
	sampleOffset := map[string]int{"sample-1": 0, "sample-2": 100001, "sample-3": 200002}[sample]
	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, os.Getenv("XD_TEST_DATABASE_URL"))
	db = db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.AuditEvent{}, &meta.Node{},
		&meta.File{}, &meta.FileVersion{}, &meta.Share{}, &meta.ContentBlob{},
		&meta.UploadSession{}, &meta.UploadPart{}, &meta.FileOperation{},
		&meta.ArchivePrepareRun{},
	); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB: db, Store: store, Auth: auth.New("shp004-original-physical-sharing", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
	}
	router := server.Router()
	userName := "shp004-physical-owner-" + sample
	token := createTestUser(t, db, router, userName, "password-for-test")
	foreignToken := createTestUser(t, db, router, "shp004-other-"+sample, "other-password")
	var user meta.User
	if err := db.Where("username = ?", userName).First(&user).Error; err != nil {
		t.Fatal(err)
	}
	var root meta.Node
	if err := db.Where("owner_id = ? AND parent_id IS NULL", user.ID).First(&root).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Node{
		ParentID: &root.ID, Name: "public-100k-JPEG-folder", Type: meta.NodeTypeDir,
		OwnerID: user.ID, Revision: 1,
	}
	target := meta.Node{
		ParentID: &root.ID, Name: "unshared-empty-sibling", Type: meta.NodeTypeDir,
		OwnerID: user.ID, Revision: 1,
	}
	sentinel := meta.Node{
		ParentID: &root.ID, Name: "outside-private.jpg", Type: meta.NodeTypeFile,
		OwnerID: user.ID, Revision: 1,
	}
	for _, node := range []*meta.Node{&source, &target, &sentinel} {
		if err := db.Create(node).Error; err != nil {
			t.Fatal(err)
		}
	}
	seedStart := time.Now()
	if err := db.Exec(
		"INSERT INTO xd_nodes (parent_id, name, type, owner_id, revision, created_at, updated_at) "+
			"SELECT ?, 'photo-' || lpad(gs::text, 6, '0') || '.jpg', 'file', ?, 1, NOW(), NOW() "+
			"FROM generate_series(0, ?) AS gs",
		source.ID, user.ID, count-1,
	).Error; err != nil {
		t.Fatal(err)
	}
	rows, err := db.Raw(
		"SELECT id FROM xd_nodes WHERE parent_id = ? AND owner_id = ? ORDER BY name",
		source.ID, user.ID,
	).Rows()
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]uint64, 0, count)
	for rows.Next() {
		var id uint64
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	rowsErr := rows.Err()
	_ = rows.Close()
	if rowsErr != nil || len(ids) != count {
		t.Fatalf("not all physical source Nodes seeded: %d %v", len(ids), rowsErr)
	}
	aggregate := sha256.New()
	var sourceBytes int64
	uniques := make(map[string]bool, count)
	blobs := make([]meta.ContentBlob, 0, 250)
	files := make([]meta.File, 0, 250)
	flush := func() {
		if err := db.CreateInBatches(&blobs, 250).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.CreateInBatches(&files, 250).Error; err != nil {
			t.Fatal(err)
		}
		blobs = blobs[:0]
		files = files[:0]
	}
	for i, id := range ids {
		payload, err := fileExplorerPhysicalJPEG(i + sampleOffset)
		if err != nil {
			t.Fatal(err)
		}
		sourceBytes += int64(len(payload))
		digest := sha256.Sum256(payload)
		hash := fmt.Sprintf("%x", digest[:])
		if uniques[hash] {
			t.Fatal("100k source originals must have unique complete SHA")
		}
		uniques[hash] = true
		_, _ = aggregate.Write(digest[:])
		key, err := storage.ContentAddressedKey(hash)
		if err != nil {
			t.Fatal(err)
		}
		wrote, err := store.Put(ctx, key, bytes.NewReader(payload))
		if err != nil || wrote != int64(len(payload)) {
			t.Fatalf("physical Local.Put original=%d n=%d err=%v", i, wrote, err)
		}
		blobs = append(blobs, meta.ContentBlob{
			SHA256: hash, StorageKey: key, Size: int64(len(payload)),
			RefCount: 1, State: meta.ContentBlobStateReady,
		})
		files = append(files, meta.File{
			NodeID: id, Size: int64(len(payload)), SHA256: hash, StorageKey: key,
		})
		if len(blobs) == 250 {
			flush()
		}
	}
	if len(blobs) > 0 {
		flush()
	}
	outside, err := fileExplorerPhysicalJPEG(count + sampleOffset)
	if err != nil {
		t.Fatal(err)
	}
	outsideDigest := sha256.Sum256(outside)
	outsideHash := fmt.Sprintf("%x", outsideDigest[:])
	if uniques[outsideHash] {
		t.Fatal("protected physical sentinel hash duplicate")
	}
	outsideKey, err := storage.ContentAddressedKey(outsideHash)
	if err != nil {
		t.Fatal(err)
	}
	if n, err := store.Put(ctx, outsideKey, bytes.NewReader(outside)); err != nil || n != int64(len(outside)) {
		t.Fatalf("physical protected CAS sentinel: n=%d err=%v", n, err)
	}
	if err := db.Create(&meta.ContentBlob{
		SHA256: outsideHash, Size: int64(len(outside)), StorageKey: outsideKey,
		RefCount: 1, State: meta.ContentBlobStateReady,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{
		NodeID: sentinel.ID, Size: int64(len(outside)), SHA256: outsideHash,
		StorageKey: outsideKey,
	}).Error; err != nil {
		t.Fatal(err)
	}
	sourceHash := fmt.Sprintf("%x", aggregate.Sum(nil))
	preCount, preAllocated, err := p055RealCASAllocated(ctx, store)
	if err != nil || preCount != int64(count+1) || preAllocated < int64(count+1)*4096 {
		t.Fatalf("real original physical CAS inventory=%d allocated=%d err=%v", preCount, preAllocated, err)
	}
	seedMS := float64(time.Since(seedStart).Microseconds()) / 1000
	ids = nil
	uniques = nil
	blobs = nil
	files = nil

	// Seeding is explicitly excluded from measured ZIP prepare/stream timings.
	shareRes := request(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/shares", source.ID), token,
		strings.NewReader(`{"max_downloads":2}`), http.StatusCreated)
	var share createdShareDTO
	if err := json.Unmarshal(shareRes.Body.Bytes(), &share); err != nil || len(share.Token) < 40 {
		t.Fatal("authentic public share missing", err)
	}
	request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/nodes/%d/shares", source.ID),
		foreignToken, nil, http.StatusNotFound)
	beforeRSS, err := p046RSS()
	if err != nil {
		t.Fatal(err)
	}
	cpuBefore, err := p046CPUTicks()
	if err != nil {
		t.Fatal(err)
	}
	var rssPeak atomic.Int64
	rssPeak.Store(beforeRSS)
	stopSample := make(chan struct{})
	sampleDone := make(chan struct{})
	go func() {
		defer close(sampleDone)
		ticker := time.NewTicker(25 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stopSample:
				return
			case <-ticker.C:
				rss, err := p046RSS()
				if err != nil {
					continue
				}
				for {
					old := rssPeak.Load()
					if rss <= old || rssPeak.CompareAndSwap(old, rss) {
						break
					}
				}
			}
		}
	}()
	defer func() {
		select {
		case <-sampleDone:
		default:
			close(stopSample)
			<-sampleDone
		}
	}()
	post := func(path, id string, want int) *httptest.ResponseRecorder {
		t.Helper()
		return requestWithHeaders(t, router, http.MethodPost, path, "",
			strings.NewReader(fmt.Sprintf(`{"prepare_id":%q,"password":""}`, id)), want,
			map[string]string{"X-XDrive-Share-Token": share.Token})
	}
	prepareStart := time.Now()
	response := post("/api/v1/public/share/archive/prepare", "", http.StatusAccepted)
	var started publicShareArchiveStatus
	if err := json.Unmarshal(response.Body.Bytes(), &started); err != nil {
		t.Fatal(err)
	}
	if started.PrepareID == "" {
		t.Fatal("missing durable public ZIP prepare")
	}
	if err := server.executeArchivePrepareRun(ctx, started.PrepareID); err != nil {
		t.Fatal(err)
	}
	prepareMS := float64(time.Since(prepareStart).Microseconds()) / 1000
	doneResp := post("/api/v1/public/share/archive/status", started.PrepareID, http.StatusOK)
	var done publicShareArchiveStatus
	if err := json.Unmarshal(doneResp.Body.Bytes(), &done); err != nil {
		t.Fatal(err)
	}
	if done.State != meta.ArchivePrepareStatusCompleted || done.TotalBytes != sourceBytes {
		t.Fatalf("public prepared 100k mismatch: %+v source bytes=%d", done, sourceBytes)
	}
	ticketResponse := post("/api/v1/public/share/archive/download-ticket", started.PrepareID, http.StatusOK)
	var ticket publicShareDownloadTicketDTO
	if err := json.Unmarshal(ticketResponse.Body.Bytes(), &ticket); err != nil {
		t.Fatal(err)
	}
	var streamed atomic.Int64
	var sawGoContextDone atomic.Bool
	requestExited := make(chan time.Time, 2)
	fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/v1/public-share-archive/") {
			defer func() {
				if r.Context().Err() != nil {
					sawGoContextDone.Store(true)
				}
				streamed.Add(1)
				requestExited <- time.Now()
			}()
		}
		router.ServeHTTP(w, r)
	}))
	defer fixture.Close()
	archivePath := filepath.Join(t.TempDir(), sample+"-public-100k.zip")
	out, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	downloadStart := time.Now()
	resp, err := http.Get(fixture.URL + ticket.URL)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("ZIP HTTP%d", resp.StatusCode)
	}
	written, readErr := io.Copy(out, resp.Body)
	closeErr := resp.Body.Close()
	fileErr := out.Close()
	if readErr != nil || closeErr != nil || fileErr != nil {
		t.Fatalf("ZIP streaming failed read=%v close=%v file=%v", readErr, closeErr, fileErr)
	}
	streamMS := float64(time.Since(downloadStart).Microseconds()) / 1000
	if written <= sourceBytes {
		t.Fatalf("native ZIP size %d too small for %d original bytes", written, sourceBytes)
	}
	select {
	case <-requestExited:
	case <-time.After(2 * time.Second):
		t.Fatal("ZIP handler did not exit")
	}
	zr, err := zip.OpenReader(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	if len(zr.File) != count+1 {
		t.Fatalf("ZIP entries=%d want=%d", len(zr.File), count+1)
	}
	originalPaths := make(map[string]*zip.File, len(zr.File))
	for _, entry := range zr.File {
		if _, ok := originalPaths[entry.Name]; ok {
			t.Fatalf("duplicate ZIP path: %s", entry.Name)
		}
		originalPaths[entry.Name] = entry
		if strings.Contains(entry.Name, "..") || strings.Contains(entry.Name, "outside") ||
			strings.Contains(entry.Name, "unshared") {
			t.Fatalf("ZIP path escaped share: %s", entry.Name)
		}
	}
	// Opening and draining every ZIP entry forces archive/zip CRC32 checks on
	// ALL 100k actual stored source files, not just the four SHA spot checks.
	// Archive verification is measured separately from HTTP streaming.
	verifyStart := time.Now()
	var verifiedCRC int
	for _, entry := range zr.File {
		if entry.FileInfo().IsDir() {
			continue
		}
		input, err := entry.Open()
		if err != nil {
			t.Fatalf("ZIP CRC open %q: %v", entry.Name, err)
		}
		n, readErr := io.Copy(io.Discard, input)
		closeErr := input.Close()
		if readErr != nil || closeErr != nil || n != int64(entry.UncompressedSize64) {
			t.Fatalf("ZIP CRC/size for %q got=%d want=%d read=%v close=%v",
				entry.Name, n, entry.UncompressedSize64, readErr, closeErr)
		}
		verifiedCRC++
	}
	verifyMS := float64(time.Since(verifyStart).Microseconds()) / 1000
	if verifiedCRC != count {
		t.Fatalf("real CRC reads=%d want=%d", verifiedCRC, count)
	}
	for _, i := range []int{0, 1, 50000, 99999} {
		name := fmt.Sprintf("public-100k-JPEG-folder/photo-%06d.jpg", i)
		f := originalPaths[name]
		if f == nil {
			t.Fatalf("missing ZIP sample path %s", name)
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, readErr := io.ReadAll(rc)
		_ = rc.Close()
		original, err := fileExplorerPhysicalJPEG(i + sampleOffset)
		if err != nil || readErr != nil {
			t.Fatalf("ZIP read/orig sample %d: %v %v", i, readErr, err)
		}
		sha := sha256.Sum256(data)
		want := sha256.Sum256(original)
		if sha != want || !bytes.Equal(data, original) {
			t.Fatalf("ZIP SHA/bytes changed at %s", name)
		}
	}
	if err := zr.Close(); err != nil {
		t.Fatal(err)
	}
	countAfter, allocAfter, err := p055RealCASAllocated(ctx, store)
	if err != nil || countAfter != preCount || allocAfter != preAllocated {
		t.Fatalf("public ZIP duplicated/removed physical CAS: %d/%d %d/%d err=%v",
			countAfter, preCount, allocAfter, preAllocated, err)
	}

	// User-cancel of a real in-progress public ZIP must terminate the native
	// Go request itself within a frozen bound. It must NOT cancel the durable
	// completed prepare job or unrelated requests.
	ticket2 := post("/api/v1/public/share/archive/download-ticket", started.PrepareID, http.StatusOK)
	if err := json.Unmarshal(ticket2.Body.Bytes(), &ticket); err != nil {
		t.Fatal(err)
	}
	httpCtx, cancel := context.WithCancel(context.Background())
	req, err := http.NewRequestWithContext(httpCtx, http.MethodGet, fixture.URL+ticket.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	streamedResponse, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 1024)
	if _, err := streamedResponse.Body.Read(buf); err != nil {
		t.Fatalf("no real streaming payload before cancel: %v", err)
	}
	cancelAt := time.Now()
	cancel()
	_ = streamedResponse.Body.Close()
	var cancelMS float64
	select {
	case <-requestExited:
		cancelMS = float64(time.Since(cancelAt).Microseconds()) / 1000
	case <-time.After(1 * time.Second):
		t.Fatal("HTTP cancel did not close real Go ZIP handler in 1000ms")
	}
	if streamed.Load() != 2 || cancelMS > 1000 || !sawGoContextDone.Load() {
		t.Fatalf("archive Go handler leaked: requests=%d cancel_ms=%.3f", streamed.Load(), cancelMS)
	}
	close(stopSample)
	<-sampleDone
	peakRSS := rssPeak.Load()
	if rss, err := p046RSS(); err == nil && rss > peakRSS {
		peakRSS = rss
	}
	cpuAfter, err := p046CPUTicks()
	if err != nil {
		t.Fatal(err)
	}
	rssGrowth := max(int64(0), peakRSS-beforeRSS)
	passed := prepareMS <= 300000 && streamMS <= 300000 && cancelMS <= 1000 && sawGoContextDone.Load() && rssGrowth <= 512<<20
	result := map[string]any{
		"workload": "SH-P007-source-exact-100k-SHA-distinct-public-folder-ZIP",
		"sample":   sample, "exact_physical_originals": count, "total_cas_inodes": preCount,
		"physical_allocated_bytes": preAllocated,
		"physical_original_bytes":  sourceBytes, "aggregate_original_sha256": sourceHash,
		"seed_ms_excluded": seedMS, "public_zip_prepare_ms": prepareMS,
		"public_zip_stream_ms": streamMS, "native_zip_bytes": written,
		"zip_entry_count":                             len(originalPaths),
		"sampled_original_files_sha_exact":            4,
		"zip_entries_crc_verified":                    verifiedCRC,
		"zip_crc_verify_ms_excluded_from_http_stream": verifyMS,
		"go_http_cancel_to_handler_exit_ms":           cancelMS,
		"go_postseed_rss_growth_bytes":                rssGrowth,
		"go_cpu_ticks_postseed":                       cpuAfter - cpuBefore,
		"passed":                                      passed,
		"scope":                                       "Genuine Gin+PostgreSQL17+100k independently decodable SHA-distinct JPEG LocalCAS, real HTTP signed ticket native on-disk ZIP and ZIP reader CRC; not Web Browser/actual phone/installed PWA or WAN",
	}
	result["go_abandoned_stream_context_done"] = sawGoContextDone.Load()
	raw, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("PUBLIC_SHARE_ZIP_100K_RESULT %s", raw)
	if !passed {
		t.Fatalf("SH-P007 public ZIP frozen performance budget failed: %s", raw)
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		t.Fatal("request cancellation escaped to unrelated durable task")
	}
}
