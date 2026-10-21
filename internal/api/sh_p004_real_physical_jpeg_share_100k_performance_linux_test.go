//go:build linux

package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image/jpeg"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"sort"
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

// SH-P004: real owner PostgreSQL17 + 100k independently decodable physical
// JPEG LocalCAS originals + original read-only shared-folder APIs (test-only).
func TestSHP004RealPhysicalJPEG100KSharedFolder(t *testing.T) {
	if os.Getenv("XD_SH_P004_PHYSICAL_SHARE_PERF") != "1" {
		t.Skip("enable genuine public folder 100k physical JPEG benchmark")
	}
	sample := os.Getenv("XD_SH_P004_SAMPLE")
	if os.Getenv("XD_TEST_DATABASE_URL") == "" ||
		(sample != "sample-1" && sample != "sample-2" && sample != "sample-3") {
		t.Fatal("real PostgreSQL17 and sample-1..3 required")
	}
	count := p047SourceCount
	smoke := os.Getenv("XD_SH_P004_SMOKE") == "1"
	if smoke {
		count = 1000
	}
	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, os.Getenv("XD_TEST_DATABASE_URL"))
	db = db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.AuditEvent{}, &meta.Node{},
		&meta.File{}, &meta.FileVersion{}, &meta.Share{}, &meta.ContentBlob{},
		&meta.UploadSession{}, &meta.UploadPart{}, &meta.FileOperation{},
		&meta.MediaMetadata{},
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
		payload, err := fileExplorerPhysicalJPEG(i)
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
	outside, err := fileExplorerPhysicalJPEG(count)
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
	runtime.GC()
	rssBefore, err := p046RSS()
	if err != nil {
		t.Fatal(err)
	}
	cpuBefore, err := p046CPUTicks()
	if err != nil {
		t.Fatal(err)
	}
	previousGoWrite := p055ProcWrites()
	var peakRSS atomic.Int64
	peakRSS.Store(rssBefore)
	stop, done := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(25 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				current, err := p046RSS()
				if err != nil {
					continue
				}
				for {
					old := peakRSS.Load()
					if current <= old || peakRSS.CompareAndSwap(old, current) {
						break
					}
				}
			}
		}
	}()
	defer func() {
		select {
		case <-done:
		default:
			close(stop)
			<-done
		}
	}()
	peer := httptest.NewServer(router)
	defer peer.Close()
	httpClient := &http.Client{Timeout: 20 * time.Minute}
	request := func(token, method, url string, body io.Reader, want int, revision ...uint64) []byte {
		t.Helper()
		req, err := http.NewRequest(method, peer.URL+url, body)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		if len(revision) == 1 {
			req.Header.Set("If-Match", fmt.Sprintf("\"%d\"", revision[0]))
		}
		if len(revision) > 1 {
			t.Fatal("at most one If-Match revision is allowed")
		}
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := httpClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		content, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if readErr != nil || resp.StatusCode != want {
			t.Fatalf("%s %s HTTP%d wanted %d: %s err=%v", method, url, resp.StatusCode, want, content, readErr)
		}
		return content
	}

	// Genuine loopback TCP HTTP, production Gin endpoints, real PostgreSQL17.
	// Physical file and SQL seeding above is strictly outside timed reads.
	createBody := bytes.NewReader([]byte("{\"max_downloads\":0}"))
	created := request(token, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/shares", source.ID),
		createBody, http.StatusCreated)
	var share createdShareDTO
	if err := json.Unmarshal(created, &share); err != nil || len(share.Token) < 40 {
		t.Fatal("real owner did not create folder capability")
	}
	request(foreignToken, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/shares", source.ID),
		bytes.NewReader([]byte("{\"max_downloads\":0}")), http.StatusNotFound)
	publicCall := func(method, path, capability string, body []byte, status int) ([]byte, http.Header, float64) {
		t.Helper()
		req, err := http.NewRequest(method, peer.URL+path, bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if capability != "" {
			req.Header.Set("X-XDrive-Share-Token", capability)
		}
		if len(body) > 0 {
			req.Header.Set("Content-Type", "application/json")
		}
		started := time.Now()
		resp, err := httpClient.Do(req)
		if err != nil {
			t.Fatalf("public %s HTTP failed: %v", method, err)
		}
		defer resp.Body.Close()
		raw, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
		ms := float64(time.Since(started).Microseconds()) / 1000
		if err != nil || resp.StatusCode != status {
			// Do not print signed URL, temporary capability or response body.
			t.Fatalf("public %s returned %d, expected %d: %v", method, resp.StatusCode, status, err)
		}
		return raw, resp.Header, ms
	}
	var cursor, lastID uint64
	var listed int
	var bodyBytes int64
	pageTimes := make([]float64, 0, count/publicFolderSharePageLimit)
	walkStart := time.Now()
	for pageIndex := 0; pageIndex < count/publicFolderSharePageLimit; pageIndex++ {
		body := []byte(fmt.Sprintf("{\"parent_id\":%d,\"cursor\":%d}", source.ID, cursor))
		raw, _, elapsed := publicCall(http.MethodPost, "/api/v1/public/share/children",
			share.Token, body, http.StatusOK)
		var page publicFolderSharePage
		if err := json.Unmarshal(raw, &page); err != nil {
			t.Fatal(err)
		}
		if len(page.Items) != publicFolderSharePageLimit || page.ParentID != source.ID {
			t.Fatalf("public physical folder page %d count %d", pageIndex, len(page.Items))
		}
		for _, entry := range page.Items {
			if entry.ID <= lastID || entry.Type != meta.NodeTypeFile || entry.Size < 500 {
				t.Fatalf("real original JPEG page %d identity/size is invalid", pageIndex)
			}
			lastID = entry.ID
		}
		if pageIndex+1 == count/publicFolderSharePageLimit {
			if page.NextCursor != 0 {
				t.Fatal("100k public page cursor did not terminate")
			}
		} else if page.NextCursor != lastID || page.NextCursor <= cursor {
			t.Fatalf("100k public folder cursor failed on page %d", pageIndex)
		}
		cursor = page.NextCursor
		listed += len(page.Items)
		bodyBytes += int64(len(raw))
		pageTimes = append(pageTimes, elapsed)
	}
	walkMS := float64(time.Since(walkStart).Microseconds()) / 1000
	sort.Float64s(pageTimes)
	p50, p95, worst := pageTimes[len(pageTimes)/2],
		pageTimes[len(pageTimes)*95/100-1], pageTimes[len(pageTimes)-1]
	if listed != count {
		t.Fatalf("100k physical original enumeration incomplete: %d", listed)
	}

	// Exactly THREE genuine signed original downloads, not 100k previews.
	// Verify first/middle/last original JPEG bytes, SHA and decodability.
	var ticketMS, streamMS []float64
	var signedBytes int64
	var lastTicket string
	for _, position := range []int{0, count / 2, count - 1} {
		var id uint64
		if err := db.Raw("SELECT id FROM xd_nodes WHERE parent_id = ? AND owner_id = ? ORDER BY id OFFSET ? LIMIT 1",
			source.ID, user.ID, position).Scan(&id).Error; err != nil || id == 0 {
			t.Fatalf("physical original offset %d missing: %v", position, err)
		}
		body := []byte(fmt.Sprintf("{\"node_id\":%d}", id))
		raw, _, tMS := publicCall(http.MethodPost, "/api/v1/public/share/download-ticket",
			share.Token, body, http.StatusOK)
		var ticket publicShareDownloadTicketDTO
		if err := json.Unmarshal(raw, &ticket); err != nil ||
			!strings.HasPrefix(ticket.URL, "/api/v1/public-share-download/") {
			t.Fatal("signed physical original download ticket missing")
		}
		got, headers, dMS := publicCall(http.MethodGet, ticket.URL, "", nil, http.StatusOK)
		want, err := fileExplorerPhysicalJPEG(position)
		if err != nil {
			t.Fatal(err)
		}
		digest := fmt.Sprintf("%x", sha256.Sum256(want))
		if !bytes.Equal(got, want) || headers.Get("X-Content-SHA256") != digest {
			t.Fatalf("signed physical JPEG original %d corrupt", position)
		}
		if _, err := jpeg.Decode(bytes.NewReader(got)); err != nil {
			t.Fatalf("signed original JPEG %d does not decode: %v", position, err)
		}
		ticketMS = append(ticketMS, tMS)
		streamMS = append(streamMS, dMS)
		signedBytes += int64(len(got))
		lastTicket = ticket.URL
	}
	publicCall(http.MethodPost, "/api/v1/public/share/download-ticket", share.Token,
		[]byte(fmt.Sprintf("{\"node_id\":%d}", sentinel.ID)), http.StatusNotFound)
	request(token, http.MethodDelete, fmt.Sprintf("/api/v1/shares/%d", share.ID),
		nil, http.StatusNoContent)
	publicCall(http.MethodGet, lastTicket, "", nil, http.StatusGone)

	close(stop)
	<-done
	rssAfter, err := p046RSS()
	if err != nil {
		t.Fatal(err)
	}
	if rssAfter > peakRSS.Load() {
		peakRSS.Store(rssAfter)
	}
	cpuAfter, err := p046CPUTicks()
	if err != nil {
		t.Fatal(err)
	}
	writeAfter := p055ProcWrites()
	rssGrowth := max(int64(0), peakRSS.Load()-rssBefore)
	var kernelWrites uint64
	if writeAfter >= previousGoWrite {
		kernelWrites = writeAfter - previousGoWrite
	}
	var maxTicketMS, maxStreamMS float64
	for i := range ticketMS {
		if ticketMS[i] > maxTicketMS {
			maxTicketMS = ticketMS[i]
		}
		if streamMS[i] > maxStreamMS {
			maxStreamMS = streamMS[i]
		}
	}
	passed := sourceBytes >= int64(count)*500 && listed == count &&
		walkMS <= 90000 && p95 <= 500 && worst <= 2000 &&
		maxTicketMS <= 3000 && maxStreamMS <= 3000 &&
		rssGrowth <= 256<<20 && cpuAfter >= cpuBefore
	result := map[string]any{
		"workload": "SH-P004-genuine-100k-physical-JPEG-public-folder-download",
		"sample":   sample, "smoke_only": smoke,
		"source_head":             os.Getenv("XD_SH_P004_SOURCE_HEAD"),
		"physical_jpeg_originals": count, "physical_source_bytes": sourceBytes,
		"physical_cas_inodes_with_protected_sentinel": preCount,
		"physical_allocated_bytes":                    preAllocated, "original_aggregate_sha256": sourceHash,
		"seed_excluded_ms": seedMS, "pages": len(pageTimes),
		"listed_originals": listed, "walk_ms": walkMS,
		"page_p50_ms": p50, "page_p95_ms": p95, "page_worst_ms": worst,
		"public_page_http_bytes": bodyBytes,
		"ticket_ms":              ticketMS, "original_download_ms": streamMS,
		"max_ticket_ms": maxTicketMS, "max_download_ms": maxStreamMS,
		"signed_downloaded_original_bytes": signedBytes,
		"outside_denied":                   true, "revoked_signed_ticket_denied": true,
		"go_peak_rss_growth_bytes": rssGrowth, "go_cpu_ticks": cpuAfter - cpuBefore,
		"go_process_kernel_write_bytes": kernelWrites, "passed": passed,
		"boundary": "real PG17/Gin/LocalCAS 100k distinct decodable JPEG original data and 1000 public HTTP pages; three true signed downloads, NOT 100k decoded thumbnails, video/Live playback, native GUI or installed PWA",
	}
	row, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("SH_P004_REAL_100K_PHYSICAL_SHARE %s", row)
	if !passed {
		t.Fatalf("original source exceeded frozen SH-P004 budgets: %s", row)
	}
}
