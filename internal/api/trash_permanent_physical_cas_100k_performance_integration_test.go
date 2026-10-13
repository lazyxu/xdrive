//go:build linux

package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

const (
	p047SourceCount   = 100000
	p047SourceBytes   = 1024
	p047HTTPMaxMS     = 1200000
	p047RSSGrowthMaxB = 536870912
)

// P047 uses P046's proven deterministic 1KiB distinct ORIGINAL CAS source
// bytes, but exercises the much larger real authenticated /trash HTTP + SQL
// release + physical CAS finalizer rather than just the finalizer.
func TestTrashPermanentPhysicalCAS100K(t *testing.T) {
	if os.Getenv("XD_P047_REAL_HTTP_ORIGINAL_CAS_PERF") != "1" {
		t.Skip("enable XD_P047_REAL_HTTP_ORIGINAL_CAS_PERF")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	sample := os.Getenv("XD_P047_SAMPLE")
	if dsn == "" || !strings.HasPrefix(sample, "sample-") {
		t.Fatal("native PG17 and independent P047 sample required")
	}
	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.AuditEvent{},
		&meta.Node{}, &meta.File{}, &meta.FileVersion{}, &meta.Share{},
		&meta.ContentBlob{}, &meta.UploadSession{}, &meta.UploadPart{},
	); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB: db, Store: store, Auth: auth.New("P047-native-physical-HTTP", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
	}
	router := server.Router()
	token := createTestUser(t, db, router, "p047-owner-"+sample, "native-physical-password")
	other := createTestUser(t, db, router, "p047-other-"+sample, "other-owner-password")
	var user meta.User
	if err := db.Where("username = ?", "p047-owner-"+sample).First(&user).Error; err != nil {
		t.Fatal(err)
	}
	var root meta.Node
	if err := db.Where("owner_id = ? AND parent_id IS NULL", user.ID).First(&root).Error; err != nil {
		t.Fatal(err)
	}
	selected := meta.Node{
		ParentID: &root.ID, Name: "selected-physical-100k", Type: meta.NodeTypeDir,
		OwnerID: user.ID, Revision: 2,
	}
	outside := meta.Node{
		ParentID: &root.ID, Name: "protected-outside-original.bin", Type: meta.NodeTypeFile,
		OwnerID: user.ID, Revision: 1,
	}
	if err := db.Create(&selected).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&outside).Error; err != nil {
		t.Fatal(err)
	}
	deletedAt := time.Now().UTC().Add(-time.Hour)
	if err := db.Model(&selected).Updates(map[string]any{
		"deleted_at": deletedAt, "trash_root_id": selected.ID,
	}).Error; err != nil {
		t.Fatal(err)
	}
	seedStart := time.Now()
	if err := db.Exec(
		"INSERT INTO xd_nodes (parent_id, name, type, owner_id, revision, deleted_at, trash_root_id, created_at, updated_at) "+
			"SELECT ?, 'p047-' || lpad(gs::text, 6, '0') || '.bin', 'file', ?, 1, ?, ?, NOW(), NOW() FROM generate_series(0, ?) AS gs",
		selected.ID, user.ID, deletedAt, selected.ID, p047SourceCount-1,
	).Error; err != nil {
		t.Fatal(err)
	}
	nodes, err := db.Raw(
		"SELECT id FROM xd_nodes WHERE parent_id = ? AND owner_id = ? ORDER BY name ASC",
		selected.ID, user.ID,
	).Rows()
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]uint64, 0, p047SourceCount)
	for nodes.Next() {
		var id uint64
		if err := nodes.Scan(&id); err != nil {
			_ = nodes.Close()
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	rowsErr := nodes.Err()
	_ = nodes.Close()
	if rowsErr != nil || len(ids) != p047SourceCount {
		t.Fatalf("expected 100k unique physical Node identities: %d err=%v", len(ids), rowsErr)
	}
	unique := make(map[string]struct{}, p047SourceCount)
	blobs := make([]meta.ContentBlob, 0, 250)
	files := make([]meta.File, 0, 250)
	versions := make([]meta.FileVersion, 0, 250)
	flush := func() {
		if err := db.CreateInBatches(&blobs, 250).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.CreateInBatches(&files, 250).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.CreateInBatches(&versions, 250).Error; err != nil {
			t.Fatal(err)
		}
		blobs = blobs[:0]
		files = files[:0]
		versions = versions[:0]
	}
	var logicalOriginalBytes int64
	for index, nodeID := range ids {
		payload := p046Bytes(index, "p047-"+sample)
		sum := sha256.Sum256(payload)
		hash := fmt.Sprintf("%x", sum[:])
		if _, found := unique[hash]; found {
			t.Fatal("P047 actual original CAS SHA collision")
		}
		unique[hash] = struct{}{}
		key, err := storage.ContentAddressedKey(hash)
		if err != nil {
			t.Fatal(err)
		}
		n, err := store.Put(ctx, key, bytes.NewReader(payload))
		if err != nil || n != int64(p047SourceBytes) {
			t.Fatalf("P047 Local.Put source %d: n=%d err=%v", index, n, err)
		}
		logicalOriginalBytes += n
		blobs = append(blobs, meta.ContentBlob{
			SHA256: hash, StorageKey: key, Size: n, RefCount: 2,
			State: meta.ContentBlobStateReady,
		})
		files = append(files, meta.File{
			NodeID: nodeID, Size: n, SHA256: hash, StorageKey: key,
		})
		versions = append(versions, meta.FileVersion{
			NodeID: nodeID, Revision: 0, Size: n, SHA256: hash, StorageKey: key,
		})
		if len(files) == 250 {
			flush()
		}
	}
	if len(files) > 0 {
		flush()
	}
	if len(unique) != p047SourceCount || logicalOriginalBytes != p047SourceCount*p047SourceBytes {
		t.Fatal("P047 originals are not 100k distinct real 1KiB CAS payloads")
	}
	protectedPayload := p046Bytes(p047SourceCount, "p047-"+sample)
	protectedSum := sha256.Sum256(protectedPayload)
	protectedHash := fmt.Sprintf("%x", protectedSum[:])
	protectedKey, err := storage.ContentAddressedKey(protectedHash)
	if err != nil {
		t.Fatal(err)
	}
	if _, repeated := unique[protectedHash]; repeated {
		t.Fatal("outside physical sentinel collided with selected originals")
	}
	if n, err := store.Put(ctx, protectedKey, bytes.NewReader(protectedPayload)); err != nil || n != p047SourceBytes {
		t.Fatalf("outside CAS protected original Put failed n=%d err=%v", n, err)
	}
	if err := db.Create(&meta.ContentBlob{
		SHA256: protectedHash, StorageKey: protectedKey, Size: p047SourceBytes,
		RefCount: 1, State: meta.ContentBlobStateReady,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{
		NodeID: outside.ID, SHA256: protectedHash, StorageKey: protectedKey, Size: p047SourceBytes,
	}).Error; err != nil {
		t.Fatal(err)
	}
	insideShare := meta.Share{OwnerID: user.ID, NodeID: ids[0], TokenHash: strings.Repeat("a", 64)}
	outsideShare := meta.Share{OwnerID: user.ID, NodeID: outside.ID, TokenHash: strings.Repeat("b", 64)}
	if err := db.Create(&insideShare).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&outsideShare).Error; err != nil {
		t.Fatal(err)
	}
	beforeCount, beforeBytes, err := p046PhysicalInventory(ctx, store)
	if err != nil || beforeCount != p047SourceCount+1 || beforeBytes != (p047SourceCount+1)*p047SourceBytes {
		t.Fatalf("P047 physical CAS preflight count=%d bytes=%d err=%v", beforeCount, beforeBytes, err)
	}
	seedMS := float64(time.Since(seedStart).Microseconds()) / 1000
	unique = nil
	ids = nil
	blobs, files, versions = nil, nil, nil
	runtime.GC()
	rssBefore, err := p046RSS()
	if err != nil {
		t.Fatal(err)
	}
	cpuBefore, err := p046CPUTicks()
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(router)
	defer host.Close()
	httpClient := &http.Client{Timeout: 25 * time.Minute}
	uri := fmt.Sprintf("%s/api/v1/trash/%d", host.URL, selected.ID)
	perform := func(bearer string, revision uint64) (int, int, error) {
		req, err := http.NewRequest(http.MethodDelete, uri, nil)
		if err != nil {
			return 0, 0, err
		}
		req.Header.Set("Authorization", "Bearer "+bearer)
		req.Header.Set("If-Match", strconv.Quote(strconv.FormatUint(revision, 10)))
		resp, err := httpClient.Do(req)
		if err != nil {
			return 0, 0, err
		}
		defer resp.Body.Close()
		payload, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return resp.StatusCode, len(payload), err
	}
	foreignCode, _, foreignErr := perform(other, 2)
	staleCode, _, staleErr := perform(token, 999)
	if foreignErr != nil || staleErr != nil || foreignCode != http.StatusNotFound || staleCode != http.StatusConflict {
		t.Fatalf("HTTP owner and revision guards failed: %d %d %v %v", foreignCode, staleCode, foreignErr, staleErr)
	}
	var peak atomic.Int64
	peak.Store(rssBefore)
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
				n, err := p046RSS()
				if err == nil {
					for {
						last := peak.Load()
						if n <= last || peak.CompareAndSwap(last, n) {
							break
						}
					}
				}
			}
		}
	}()
	started := time.Now()
	status, responseBytes, httpErr := perform(token, 2)
	httpMS := float64(time.Since(started).Microseconds()) / 1000
	close(stop)
	<-done
	if last, err := p046RSS(); err == nil && last > peak.Load() {
		peak.Store(last)
	}
	cpuAfter, cpuErr := p046CPUTicks()
	if cpuErr != nil {
		t.Fatal(cpuErr)
	}
	rssGrowth := max(int64(0), peak.Load()-rssBefore)
	auditStarted := time.Now()
	afterCount, afterBytes, afterErr := p046PhysicalInventory(ctx, store)
	var selectedNodes, fileRows, versionRows, blobRows, inShares, outShares, auditRows int64
	e1 := db.Model(&meta.Node{}).Where("id = ? OR parent_id = ?", selected.ID, selected.ID).Count(&selectedNodes).Error
	e2 := db.Model(&meta.File{}).Count(&fileRows).Error
	e3 := db.Model(&meta.FileVersion{}).Count(&versionRows).Error
	e4 := db.Model(&meta.ContentBlob{}).Count(&blobRows).Error
	e5 := db.Model(&meta.Share{}).Where("id = ?", insideShare.ID).Count(&inShares).Error
	e6 := db.Model(&meta.Share{}).Where("id = ?", outsideShare.ID).Count(&outShares).Error
	e7 := db.Model(&meta.AuditEvent{}).Where(
		"actor_user_id = ? AND target_id = ?", user.ID, strconv.FormatUint(selected.ID, 10),
	).Count(&auditRows).Error
	var sibling meta.Node
	e8 := db.First(&sibling, outside.ID).Error
	untouchedSibling := e8 == nil && sibling.Revision == 1 && sibling.DeletedAt == nil
	f, openErr := store.Open(ctx, protectedKey)
	protectedOriginalUnchanged := openErr == nil
	if openErr == nil {
		data, readErr := io.ReadAll(f)
		closeErr := f.Close()
		protectedOriginalUnchanged = readErr == nil && closeErr == nil && bytes.Equal(data, protectedPayload)
	}
	onlyProtectedPhysical := afterCount == 1 && afterBytes == p047SourceBytes &&
		protectedOriginalUnchanged
	auditMS := float64(time.Since(auditStarted).Microseconds()) / 1000
	passed := httpErr == nil && status == http.StatusNoContent && responseBytes == 0 &&
		afterErr == nil && e1 == nil && e2 == nil && e3 == nil && e4 == nil &&
		e5 == nil && e6 == nil && e7 == nil && e8 == nil &&
		foreignCode == http.StatusNotFound && staleCode == http.StatusConflict &&
		selectedNodes == 0 && fileRows == 1 && versionRows == 0 && blobRows == 1 &&
		inShares == 0 && outShares == 1 && auditRows == 1 && untouchedSibling &&
		onlyProtectedPhysical && beforeCount-afterCount == p047SourceCount &&
		beforeBytes-afterBytes == logicalOriginalBytes &&
		cpuAfter >= cpuBefore && httpMS > 0 && httpMS <= p047HTTPMaxMS &&
		rssGrowth <= p047RSSGrowthMaxB
	result := map[string]any{
		"workload":                              "P047-real-HTTP-permanent-original-CAS-100k",
		"sample":                                sample,
		"original_CAS_SHA_unique_count":         p047SourceCount,
		"original_physical_CAS_count":           beforeCount,
		"original_payload_bytes":                logicalOriginalBytes,
		"physical_CAS_unlinked_count":           beforeCount - afterCount,
		"unlinked_CAS_logical_bytes":            beforeBytes - afterBytes,
		"remaining_CAS_originals":               afterCount,
		"remaining_CAS_bytes":                   afterBytes,
		"protected_outside_file_complete_bytes": protectedOriginalUnchanged,
		"selected_nodes_remaining":              selectedNodes,
		"File_rows_after":                       fileRows,
		"FileVersion_rows_after":                versionRows,
		"ContentBlob_rows_after":                blobRows,
		"deleted_share_rows_remaining":          inShares,
		"protected_share_rows_remaining":        outShares,
		"auth_audit_rows":                       auditRows,
		"outside_sibling_unchanged":             untouchedSibling,
		"foreign_owner_HTTP":                    foreignCode,
		"stale_revision_HTTP":                   staleCode,
		"owner_delete_HTTP":                     status,
		"HTTP_response_bytes":                   responseBytes,
		"HTTP_error":                            fmt.Sprint(httpErr),
		"seed_ms_excluded":                      seedMS,
		"HTTP_delete_ms":                        httpMS,
		"post_timer_audit_ms":                   auditMS,
		"Go_CPU_ticks":                          cpuAfter - cpuBefore,
		"Go_RSS_growth_B":                       rssGrowth,
		"HTTP_budget_ms":                        p047HTTPMaxMS,
		"RSS_growth_budget_B":                   p047RSSGrowthMaxB,
		"passed":                                passed,
		"scope":                                 "Genuine owner-signed Gin HTTP 100k File+FileVersion/ContentBlob metadata release, physical Local CAS 100k unlink, audit and permissions. No real Desktop/Web/PWA UI and no WAN.",
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("P047_REAL_HTTP_PERMANENT_CAS_100K %s", encoded)
	if !passed {
		t.Fatalf("P047 real HTTP 100k full original CAS current failed: %s", encoded)
	}
}
