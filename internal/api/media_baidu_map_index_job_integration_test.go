package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
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
	gormlogger "gorm.io/gorm/logger"
)

func TestBaiduPhotoMapIndexJobOwnerHTTPAndAuditRollback(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated real PostgreSQL fixture required")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	rootSQL, err := root.DB()
	if err != nil {
		t.Fatal(err)
	}
	rootSQL.SetMaxOpenConns(2)
	defer rootSQL.Close()
	schema := "baidu_job_http_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	newDB := func() *gorm.DB {
		t.Helper()
		db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		sqlDB, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		sqlDB.SetMaxOpenConns(4)
		t.Cleanup(func() { _ = sqlDB.Close() })
		return db
	}
	db, peer := newDB(), newDB()
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.MediaMetadata{}, &meta.PhotoAsset{},
		&meta.BaiduPhotoMapConsent{}, &meta.BaiduPhotoMapPosition{},
		&meta.BaiduPhotoMapIndexIntent{}, &meta.BaiduGeoconvQuotaBucket{},
		&meta.AuditEvent{},
	); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{
		Username: "baidu-job-http-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	other := meta.User{
		Username: "baidu-job-http-other", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	addPhoto := func(label string, lat, lng float64, withGrant bool) (meta.Node, meta.PhotoAsset) {
		t.Helper()
		node := meta.Node{OwnerID: owner.ID, Name: label, Type: meta.NodeTypeFile, Revision: 1}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		media := meta.MediaMetadata{
			OwnerID: owner.ID, NodeID: node.ID, NodeRevision: 1,
			IndexState: meta.MediaIndexStateReady, MediaKind: meta.MediaKindImage,
			Latitude: &lat, Longitude: &lng,
		}
		if err := db.Create(&media).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Where("node_id = ?", node.ID).Take(&media).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{
			OwnerID: owner.ID, PrimaryNodeID: node.ID,
			Kind: meta.PhotoAssetKindImage, EvidenceKey: "http:" + label,
		}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		if withGrant {
			updated := media.UpdatedAt
			consent := meta.BaiduPhotoMapConsent{
				AssetID: asset.ID, OwnerID: owner.ID, Revision: 1,
				AllowIndex: true, AllowBaiduConversion: true,
				ExpiresAt:    time.Now().UTC().Add(time.Hour),
				SourceNodeID: node.ID, SourceNodeRevision: node.Revision,
				SourceMediaUpdatedAt: &updated,
				SourceLatitude:       &lat, SourceLongitude: &lng,
			}
			if err := db.Create(&consent).Error; err != nil {
				t.Fatal(err)
			}
		}
		return node, asset
	}
	manager := auth.New("private-index-owner-http-jwt", time.Hour)
	var sqlLog bytes.Buffer
	serverDB := db.Session(&gorm.Session{Logger: gormlogger.New(log.New(&sqlLog, "", 0),
		gormlogger.Config{LogLevel: gormlogger.Info})})
	server := &Server{
		DB: serverDB, Auth: manager, AllowedOrigin: "https://xdrive.example",
		BaiduMapAK: "PRIVATE-BAIDU-AK-CANARY",
	}
	router := server.Router()
	ownerJWT, err := manager.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	otherJWT, err := manager.Issue(other.ID, other.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	hit := func(nodeID uint64, method, token, payload, origin, site, match string, want int) *httptest.ResponseRecorder {
		t.Helper()
		path := fmt.Sprintf("/api/v1/media/items/%d/baidu-map-index-job", nodeID)
		request := httptest.NewRequest(method, path, strings.NewReader(payload))
		if token != "" {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		if method == http.MethodPost {
			request.Header.Set("Content-Type", "application/json")
		}
		if origin != "" {
			request.Header.Set("Origin", origin)
		}
		if site != "" {
			request.Header.Set("Sec-Fetch-Site", site)
		}
		if match != "" {
			request.Header.Set("If-Match", match)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("%s %s: got HTTP %d want %d: %s",
				method, path, response.Code, want, response.Body.String())
		}
		if response.Code != http.StatusUnauthorized &&
			(response.Header().Get("Cache-Control") != "private, no-store" ||
				response.Header().Get("Referrer-Policy") != "no-referrer" ||
				response.Header().Get("X-Content-Type-Options") != "nosniff") {
			t.Fatalf("missing private headers: %v", response.Header())
		}
		for _, forbidden := range []string{
			"35.243951", "139.612345", "source_latitude", "source_longitude",
			"lease_token", "primary_node_id", "PRIVATE-BAIDU-AK-CANARY",
		} {
			if strings.Contains(response.Body.String(), forbidden) {
				t.Fatalf("protected data escaped job HTTP: %s", forbidden)
			}
		}
		return response
	}
	decode := func(response *httptest.ResponseRecorder) mediaBaiduMapJobDTO {
		t.Helper()
		var dto mediaBaiduMapJobDTO
		if err := json.Unmarshal(response.Body.Bytes(), &dto); err != nil {
			t.Fatal(err)
		}
		if dto.DispatchEnabled || dto.ActivationState != "blocked_pending_licence_and_provider_review" {
			t.Fatalf("unreviewed Baidu egress claimed enabled: %+v", dto)
		}
		return dto
	}
	explicit := `{"expected_revision":1,"confirm":true}`
	node, asset := addPhoto("private-original.jpg", 35.243951, 139.612345, false)
	hit(node.ID, http.MethodGet, "", "", "", "", "", http.StatusUnauthorized)
	hit(node.ID, http.MethodGet, otherJWT, "", "", "", "", http.StatusNotFound)
	hit(node.ID, http.MethodPost, otherJWT, explicit, "https://xdrive.example", "same-origin", "", http.StatusNotFound)
	hit(node.ID, http.MethodPost, ownerJWT, explicit, "https://evil.example", "cross-site", "", http.StatusForbidden)
	hit(node.ID, http.MethodPost, ownerJWT, explicit, "https://xdrive.example", "cross-site", "", http.StatusForbidden)
	hit(node.ID, http.MethodPost, ownerJWT, `{"expected_revision":1,"confirm":false}`, "", "", "", http.StatusBadRequest)
	hit(node.ID, http.MethodPost, ownerJWT, `{"expected_revision":1,"confirm":true,"latitude":35.243951}`, "", "", "", http.StatusBadRequest)
	hit(node.ID, http.MethodPost, ownerJWT, `{"expected_revision":0,"confirm":true}`, "", "", "", http.StatusBadRequest)
	if status := decode(hit(node.ID, http.MethodGet, ownerJWT, "", "", "", "", http.StatusOK)); status.Status != "not_queued" {
		t.Fatalf("unsolicited job on read: %+v", status)
	}
	sqlLog.Reset()
	hit(node.ID, http.MethodPost, ownerJWT, explicit, "https://xdrive.example", "same-origin", "", http.StatusConflict)
	if strings.Contains(sqlLog.String(), "35.243951") || strings.Contains(sqlLog.String(), "139.612345") {
		t.Fatal("private raw GPS escaped into GORM SQL logs for an unapproved job")
	}
	// Only the test fixture grants current exact source consent; HTTP job
	// creation never grants permission on behalf of a browser.
	media := meta.MediaMetadata{}
	if err := db.Where("node_id = ?", node.ID).Take(&media).Error; err != nil {
		t.Fatal(err)
	}
	lat, lng := *media.Latitude, *media.Longitude
	updated := media.UpdatedAt
	if err := db.Create(&meta.BaiduPhotoMapConsent{
		AssetID: asset.ID, OwnerID: owner.ID, Revision: 1,
		AllowIndex: true, AllowBaiduConversion: true,
		ExpiresAt:    time.Now().UTC().Add(time.Hour),
		SourceNodeID: node.ID, SourceNodeRevision: node.Revision,
		SourceMediaUpdatedAt: &updated,
		SourceLatitude:       &lat, SourceLongitude: &lng,
	}).Error; err != nil {
		t.Fatal(err)
	}
	queued := decode(hit(node.ID, http.MethodPost, ownerJWT, explicit,
		"https://xdrive.example", "same-origin", "", http.StatusAccepted))
	if queued.Status != baiduMapIndexQueued || queued.ConsentRevision != 1 || queued.Attempts != 0 {
		t.Fatalf("explicit job not queued: %+v", queued)
	}
	if dto := decode(hit(node.ID, http.MethodGet, ownerJWT, "", "", "", "", http.StatusOK)); dto.Status != baiduMapIndexQueued {
		t.Fatalf("durable status missing from different request: %+v", dto)
	}
	decode(hit(node.ID, http.MethodPost, ownerJWT, explicit, "", "", "", http.StatusAccepted))
	var jobs int64
	if err := peer.Model(&meta.BaiduPhotoMapIndexIntent{}).Count(&jobs).Error; err != nil || jobs != 1 {
		t.Fatalf("duplicate HTTP job created more than one queue row: %d err=%v", jobs, err)
	}
	hit(node.ID, http.MethodDelete, otherJWT, "", "", "", `"1"`, http.StatusNotFound)
	hit(node.ID, http.MethodDelete, ownerJWT, "", "https://evil.example", "cross-site", `"1"`, http.StatusForbidden)
	hit(node.ID, http.MethodDelete, ownerJWT, `{"latitude":35.243951}`, "https://xdrive.example", "same-origin", `"1"`, http.StatusBadRequest)
	hit(node.ID, http.MethodDelete, ownerJWT, "", "", "", "", http.StatusPreconditionRequired)
	hit(node.ID, http.MethodDelete, ownerJWT, "", "", "", `"2"`, http.StatusConflict)
	cancelled := decode(hit(node.ID, http.MethodDelete, ownerJWT, "",
		"https://xdrive.example", "same-origin", `"1"`, http.StatusOK))
	if cancelled.Status != baiduMapIndexCancelled {
		t.Fatalf("cancel job receipt was not persisted: %+v", cancelled)
	}
	if dto := decode(hit(node.ID, http.MethodGet, ownerJWT, "", "", "", "", http.StatusOK)); dto.Status != baiduMapIndexCancelled {
		t.Fatalf("cancelled state missing across reads: %+v", dto)
	}
	decode(hit(node.ID, http.MethodDelete, ownerJWT, "", "", "", `"1"`, http.StatusOK))
	hit(node.ID, http.MethodPost, ownerJWT, explicit, "", "", "", http.StatusConflict)
	var quota, positions int64
	if err := peer.Model(&meta.BaiduGeoconvQuotaBucket{}).Count(&quota).Error; err != nil || quota != 0 {
		t.Fatalf("HTTP admission unexpectedly charged Baidu quota: %d %v", quota, err)
	}
	if err := peer.Model(&meta.BaiduPhotoMapPosition{}).Count(&positions).Error; err != nil || positions != 0 {
		t.Fatalf("HTTP admission unexpectedly created map coordinates: %d %v", positions, err)
	}
	secondNode, secondAsset := addPhoto("audit-rollback-original.jpg", 36, 140, true)
	if err := db.Migrator().DropTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	hit(secondNode.ID, http.MethodPost, ownerJWT, explicit, "", "", "", http.StatusInternalServerError)
	if err := peer.Model(&meta.BaiduPhotoMapIndexIntent{}).
		Where("asset_id = ?", secondAsset.ID).Count(&jobs).Error; err != nil || jobs != 0 {
		t.Fatalf("audit failure persisted a queued job: %d %v", jobs, err)
	}
	if err := db.AutoMigrate(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	decode(hit(secondNode.ID, http.MethodPost, ownerJWT, explicit, "", "", "", http.StatusAccepted))
	if err := db.Migrator().DropTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	hit(secondNode.ID, http.MethodDelete, ownerJWT, "", "", "", `"1"`, http.StatusInternalServerError)
	var pending meta.BaiduPhotoMapIndexIntent
	if err := peer.Where("asset_id = ?", secondAsset.ID).Take(&pending).Error; err != nil ||
		pending.Status != baiduMapIndexQueued || pending.CancelRequestedAt != nil {
		t.Fatalf("audit failure cancelled the job despite rollback: %+v %v", pending, err)
	}
	if err := db.AutoMigrate(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	decode(hit(secondNode.ID, http.MethodDelete, ownerJWT, "", "", "", `"1"`, http.StatusOK))
	thirdNode, _ := addPhoto("no-current-photo-grant.jpg", 37, 141, true)
	if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", thirdNode.ID).
		Update("latitude", 38.5).Error; err != nil {
		t.Fatal(err)
	}
	sqlLog.Reset()
	hit(thirdNode.ID, http.MethodPost, ownerJWT, explicit, "", "", "", http.StatusConflict)
	if strings.Contains(sqlLog.String(), "source_latitude = 38.5") ||
		strings.Contains(sqlLog.String(), "source_longitude = 141") {
		t.Fatal("edited source GPS escaped into GORM SQL logs during consent rejection")
	}
	ownerJWTBeforeRotation := ownerJWT
	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).
		Update("session_version", 2).Error; err != nil {
		t.Fatal(err)
	}
	hit(thirdNode.ID, http.MethodPost, ownerJWTBeforeRotation, explicit, "", "", "", http.StatusUnauthorized)
}
