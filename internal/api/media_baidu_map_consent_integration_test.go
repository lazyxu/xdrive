package api

import (
	"encoding/json"
	"fmt"
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
)

func TestMediaBaiduConsentExplicitOwnerHTTPSContract(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL service required")
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
	schema := "map_consent_http_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
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
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	pool.SetMaxOpenConns(2)
	defer pool.Close()
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.MediaMetadata{}, &meta.PhotoAsset{},
		&meta.BaiduPhotoMapConsent{}, &meta.BaiduPhotoMapPosition{}, &meta.AuditEvent{},
	); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{Username: "map-http-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	other := meta.User{Username: "map-http-other", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	node := meta.Node{OwnerID: owner.ID, Name: "original.jpg", Type: meta.NodeTypeFile, Revision: 1}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	lat, lng := 31.2304, 121.4737
	media := meta.MediaMetadata{
		NodeID: node.ID, OwnerID: owner.ID, NodeRevision: node.Revision,
		IndexState: meta.MediaIndexStateReady, MediaKind: meta.MediaKindImage,
		Latitude: &lat, Longitude: &lng,
	}
	if err := db.Create(&media).Error; err != nil {
		t.Fatal(err)
	}
	asset := meta.PhotoAsset{
		OwnerID: owner.ID, PrimaryNodeID: node.ID, Kind: meta.PhotoAssetKindImage,
		EvidenceKey: "photo-map-http-original",
	}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	manager := auth.New("photo-map-test-bearer", time.Hour)
	server := &Server{DB: db, Auth: manager, AllowedOrigin: "https://xdrive.example"}
	router := server.Router()
	ownerJWT, err := manager.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	otherJWT, err := manager.Issue(other.ID, other.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	hit := func(method, token, payload, origin, site, ifMatch string, want int) *httptest.ResponseRecorder {
		t.Helper()
		path := fmt.Sprintf("/api/v1/media/items/%d/baidu-map-consent", node.ID)
		w := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(payload))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if method == http.MethodPut {
			req.Header.Set("Content-Type", "application/json")
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		if site != "" {
			req.Header.Set("Sec-Fetch-Site", site)
		}
		if ifMatch != "" {
			req.Header.Set("If-Match", ifMatch)
		}
		router.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s status %d, want %d: %s", method, w.Code, want, w.Body.String())
		}
		// Anonymous calls stop at requireAuth before reaching the privacy
		// handler; an authenticated result must never be cacheable.
		if w.Code != http.StatusUnauthorized &&
			(w.Header().Get("Cache-Control") != "private, no-store" ||
				w.Header().Get("Referrer-Policy") != "no-referrer") {
			t.Fatalf("missing privacy headers: %+v", w.Header())
		}
		if strings.Contains(w.Body.String(), "31.2304") ||
			strings.Contains(w.Body.String(), "121.4737") ||
			strings.Contains(w.Body.String(), "source_latitude") ||
			strings.Contains(w.Body.String(), "source_longitude") {
			t.Fatal("raw GPS escaped the Owner consent endpoint")
		}
		return w
	}
	decode := func(w *httptest.ResponseRecorder) mediaBaiduConsentDTO {
		t.Helper()
		var value mediaBaiduConsentDTO
		if err := json.Unmarshal(w.Body.Bytes(), &value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	explicit := `{"expected_revision":0,"expires_in_seconds":3600,"consent_to_baidu_conversion":true,"consent_to_derived_index":true}`
	hit(http.MethodGet, "", "", "", "", "", http.StatusUnauthorized)
	hit(http.MethodGet, otherJWT, "", "", "", "", http.StatusNotFound)
	hit(http.MethodPut, otherJWT, explicit, "https://xdrive.example", "same-origin", "", http.StatusNotFound)
	first := decode(hit(http.MethodGet, ownerJWT, "", "", "", "", http.StatusOK))
	if first.Status != "not_granted" || first.Authorized || first.Revision != 0 {
		t.Fatalf("implicit consent on read: %+v", first)
	}
	hit(http.MethodPut, ownerJWT, explicit, "https://attacker.example", "cross-site", "", http.StatusForbidden)
	hit(http.MethodPut, ownerJWT, explicit, "https://xdrive.example", "cross-site", "", http.StatusForbidden)
	hit(http.MethodPut, ownerJWT, `{"expected_revision":0,"expires_in_seconds":3600,"consent_to_baidu_conversion":false,"consent_to_derived_index":true}`,
		"https://xdrive.example", "same-origin", "", http.StatusBadRequest)
	hit(http.MethodPut, ownerJWT, `{"expected_revision":0,"expires_in_seconds":3600,"consent_to_baidu_conversion":true,"consent_to_derived_index":true,"latitude":31.2304}`,
		"https://xdrive.example", "same-origin", "", http.StatusBadRequest)
	hit(http.MethodPut, ownerJWT, `{"expected_revision":0,"expires_in_seconds":60,"consent_to_baidu_conversion":true,"consent_to_derived_index":true}`,
		"https://xdrive.example", "same-origin", "", http.StatusBadRequest)
	saved := decode(hit(http.MethodPut, ownerJWT, explicit, "https://xdrive.example", "same-origin", "", http.StatusOK))
	if saved.Revision != 1 || !saved.Authorized || !saved.SourceCurrent || saved.Status != "authorized" {
		t.Fatalf("explicit first grant rejected: %+v", saved)
	}
	if v := decode(hit(http.MethodGet, ownerJWT, "", "", "", "", http.StatusOK)); !v.Authorized {
		t.Fatal("current grant not visible")
	}
	hit(http.MethodPut, ownerJWT, explicit, "https://xdrive.example", "same-origin", "", http.StatusConflict)
	var grant meta.BaiduPhotoMapConsent
	if err := db.Where("asset_id = ?", asset.ID).Take(&grant).Error; err != nil ||
		grant.SourceLatitude == nil || *grant.SourceLatitude != lat || grant.SourceNodeID != node.ID {
		t.Fatalf("consent lost locked source: %+v %v", grant, err)
	}
	if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", node.ID).
		Update("latitude", 31.5001).Error; err != nil {
		t.Fatal(err)
	}
	stale := decode(hit(http.MethodGet, ownerJWT, "", "", "", "", http.StatusOK))
	if stale.Status != "source_changed" || stale.Authorized {
		t.Fatalf("edited GPS reused old authorization: %+v", stale)
	}
	renew := `{"expected_revision":1,"expires_in_seconds":3600,"consent_to_baidu_conversion":true,"consent_to_derived_index":true}`
	updated := decode(hit(http.MethodPut, ownerJWT, renew, "", "", "", http.StatusOK))
	if updated.Revision != 2 || !updated.Authorized || !updated.SourceCurrent {
		t.Fatalf("new explicit current-source decision not applied: %+v", updated)
	}
	hit(http.MethodDelete, ownerJWT, "", "https://xdrive.example", "same-origin", "", http.StatusPreconditionRequired)
	hit(http.MethodDelete, ownerJWT, "", "https://xdrive.example", "same-origin", `"1"`, http.StatusConflict)
	// Audit is part of the revocation transaction. If it fails, restore the
	// consent and any derived index instead of reporting a false success.
	if err := db.Migrator().DropTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	hit(http.MethodDelete, ownerJWT, "", "https://xdrive.example", "same-origin", `"2"`, http.StatusInternalServerError)
	if err := db.Where("asset_id = ?", asset.ID).Take(&grant).Error; err != nil ||
		grant.Revision != 2 || grant.RevokedAt != nil || !grant.AllowIndex {
		t.Fatalf("audit failure committed privacy mutation: %+v %v", grant, err)
	}
	if err := db.AutoMigrate(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	revoked := decode(hit(http.MethodDelete, ownerJWT, "", "https://xdrive.example", "same-origin", `"2"`, http.StatusOK))
	if revoked.Status != "revoked" || revoked.Revision != 3 || revoked.Authorized {
		t.Fatalf("revocation response incorrect: %+v", revoked)
	}
	hit(http.MethodDelete, ownerJWT, "", "https://xdrive.example", "same-origin", `"2"`, http.StatusConflict)
	after := decode(hit(http.MethodGet, ownerJWT, "", "", "", "", http.StatusOK))
	if after.Status != "revoked" || after.Authorized {
		t.Fatalf("revoked photo consent reappeared: %+v", after)
	}
	var audit []meta.AuditEvent
	if err := db.Find(&audit).Error; err != nil || len(audit) != 1 ||
		audit[0].Action != "media.photo_map.consent.revoke" ||
		strings.Contains(audit[0].Metadata, "31.5001") {
		t.Fatalf("revocation audit failed or leaked GPS: %+v %v", audit, err)
	}
}
