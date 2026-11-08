package api

import (
	"encoding/base64"
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

// Real PostgreSQL and authenticated HTTP contract. A device token alone
// cannot read a target: the current interactive Owner bearer, registered
// DeviceIdentity credential and separate Clipboard public-key grant must all match.
func TestClipboardTargetedDeviceOwnerAndRevocationPostgres(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	base, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "clipboard_target_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := base.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = base.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error })
	dsnURL, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := dsnURL.Query()
	q.Set("search_path", schema)
	dsnURL.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(dsnURL.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{},
		&meta.ContentBlob{}, &meta.Share{}, &meta.UploadSession{}, &meta.UploadPart{},
		&meta.LocalPushQuotaHold{}, &meta.AuditEvent{}, &meta.ClientDevice{},
		&meta.ClipboardVault{}, &meta.ClipboardItem{}, &meta.ClipboardChange{},
		&meta.ClipboardDeviceKey{},
	); err != nil {
		t.Fatal(err)
	}
	secret := "clipboard-device-owner-authorization-test-secret"
	router := (&Server{
		DB: db, Auth: auth.New(secret, time.Hour), RefreshTTL: time.Hour,
		AllowedOrigin: "http://localhost", MaxUploadBytes: 10 << 20,
	}).Router()
	ownerABearer := createTestUser(t, db, router, "device-owner-a", "password-a")
	ownerBBearer := createTestUser(t, db, router, "device-owner-b", "password-b")
	var ownerA, ownerB meta.User
	if err := db.Where("username = ?", "device-owner-a").Take(&ownerA).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("username = ?", "device-owner-b").Take(&ownerB).Error; err != nil {
		t.Fatal(err)
	}
	nonce := base64.StdEncoding.EncodeToString(make([]byte, 12))
	ciphertext := base64.StdEncoding.EncodeToString([]byte("ciphertext is authenticated by receiver"))
	for _, owner := range []struct {
		id     uint64
		bearer string
	}{
		{ownerA.ID, ownerABearer}, {ownerB.ID, ownerBBearer},
	} {
		request(t, router, http.MethodGet, "/api/v1/clipboard/vault",
			owner.bearer, nil, http.StatusOK)
		check := fmt.Sprintf("{\"nonce\":%q,\"ciphertext\":%q,\"scope\":%q}",
			nonce, ciphertext, fmt.Sprintf("https://nas.example.test:%d", owner.id))
		request(t, router, http.MethodPut, "/api/v1/clipboard/vault/check",
			owner.bearer, strings.NewReader(check), http.StatusOK)
	}
	deviceA := uuid.NewString()
	deviceA2 := uuid.NewString()
	deviceSecret := strings.Repeat("device-owner-a-token-", 3)
	now := time.Now().UTC()
	for _, id := range []string{deviceA, deviceA2} {
		if err := db.Create(&meta.ClientDevice{
			ID: id, OwnerID: ownerA.ID, Platform: "android", Name: "Phone",
			ClientVersion: "1", CredentialHash: deviceCredentialDigest(deviceSecret),
			CreatedAt: now, UpdatedAt: now,
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	publicKey := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("p", 32)))
	otherKey := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("q", 32)))
	ephemeral := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("e", 32)))
	wrapped := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("w", 60)))

	deviceRequest := func(method, path, bearer, id, token, payload string, expected int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(payload))
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		if id != "" {
			req.Header.Set("X-XDrive-Device-ID", id)
			req.Header.Set("X-XDrive-Device-Token", token)
		}
		if payload != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != expected {
			t.Fatalf("%s %s: got %d, expected %d: %s", method, path,
				rec.Code, expected, rec.Body.String())
		}
		return rec
	}
	enrollment := fmt.Sprintf("{\"public_key\":%q}", publicKey)
	deviceRequest(http.MethodPut, "/api/v1/clipboard/devices/self",
		ownerABearer, deviceA, deviceSecret, enrollment, http.StatusOK)
	deviceRequest(http.MethodPut, "/api/v1/clipboard/devices/self",
		ownerABearer, deviceA, deviceSecret, enrollment, http.StatusOK)
	deviceRequest(http.MethodPut, "/api/v1/clipboard/devices/self",
		ownerABearer, deviceA, deviceSecret,
		fmt.Sprintf("{\"public_key\":%q}", otherKey), http.StatusConflict)
	deviceRequest(http.MethodPut, "/api/v1/clipboard/devices/self",
		ownerBBearer, deviceA, deviceSecret, enrollment, http.StatusForbidden)
	deviceRequest(http.MethodPut, "/api/v1/clipboard/devices/self",
		ownerABearer, deviceA, "invalid-token", enrollment, http.StatusForbidden)
	deviceRequest(http.MethodPut, "/api/v1/clipboard/devices/self",
		"", deviceA, deviceSecret, enrollment, http.StatusUnauthorized)
	sourceBearer, err := auth.New(secret, time.Hour).
		IssueSourceRunAccess(ownerA.ID, ownerA.SessionVersion, 123, "clipboard-device-test")
	if err != nil {
		t.Fatal(err)
	}
	deviceRequest(http.MethodPut, "/api/v1/clipboard/devices/self",
		sourceBearer, deviceA, deviceSecret, enrollment, http.StatusForbidden)

	targetEvent := uuid.NewString()
	targetPayload := func(event string, node uint64) string {
		kind := "text/plain"
		if node != 0 {
			kind = "application/x-xdrive-node-ref"
		}
		return fmt.Sprintf(
			"{\"client_event_id\":%q,\"kind\":%q,\"nonce\":%q,\"ciphertext\":%q,"+
				"\"target_device_id\":%q,\"ephemeral_key\":%q,\"wrapped_key\":%q,\"node_id\":%d}",
			event, kind, nonce, ciphertext, deviceA, ephemeral, wrapped, node)
	}
	posted := deviceRequest(http.MethodPost, "/api/v1/clipboard/items",
		ownerABearer, "", "", targetPayload(targetEvent, 0), http.StatusCreated)
	var receipt clipboardItemResponse
	if err := json.Unmarshal(posted.Body.Bytes(), &receipt); err != nil ||
		receipt.ID == 0 || receipt.TargetDeviceID != deviceA {
		t.Fatalf("invalid directed receipt: %s, %v", posted.Body.String(), err)
	}
	// A signed-in Owner WITHOUT the target device must not see the envelope.
	unauthenticatedTarget := deviceRequest(http.MethodGet, "/api/v1/clipboard/items",
		ownerABearer, "", "", "", http.StatusOK)
	if strings.Contains(unauthenticatedTarget.Body.String(), targetEvent) {
		t.Fatal("Owner mailbox leaked directed encrypted content without registered device proof")
	}
	wrongDevice := deviceRequest(http.MethodGet, "/api/v1/clipboard/items",
		ownerABearer, deviceA2, deviceSecret, "", http.StatusOK)
	if strings.Contains(wrongDevice.Body.String(), targetEvent) {
		t.Fatal("other same-Owner device without Clipboard grant read target")
	}
	rightDevice := deviceRequest(http.MethodGet, "/api/v1/clipboard/items",
		ownerABearer, deviceA, deviceSecret, "", http.StatusOK)
	if !strings.Contains(rightDevice.Body.String(), targetEvent) {
		t.Fatal("registered device did not receive its directed envelope")
	}
	deviceRequest(http.MethodGet, "/api/v1/clipboard/items",
		ownerBBearer, deviceA, deviceSecret, "", http.StatusForbidden)
	deviceRequest(http.MethodDelete, fmt.Sprintf("/api/v1/clipboard/items/%d", receipt.ID),
		ownerABearer, "", "", "", http.StatusForbidden)

	// A Clipboard Node reference is only an existing, nontrashed Owner-owned File/CAS original.
	var foreign meta.Node
	if err := db.Create(&meta.Node{
		OwnerID: ownerB.ID, Name: "foreign.pdf", Type: "file", Revision: 1,
		CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("owner_id = ? AND name = ?", ownerB.ID, "foreign.pdf").
		Take(&foreign).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{
		NodeID: foreign.ID, Size: 64, StorageKey: "CAS/foreign", CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	deviceRequest(http.MethodPost, "/api/v1/clipboard/items",
		ownerABearer, "", "", targetPayload(uuid.NewString(), foreign.ID), http.StatusForbidden)
	var own meta.Node
	if err := db.Create(&meta.Node{
		OwnerID: ownerA.ID, Name: "photo.png", Type: "file", Revision: 1,
		CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("owner_id = ? AND name = ?", ownerA.ID, "photo.png").
		Take(&own).Error; err != nil {
		t.Fatal(err)
	}
	deviceRequest(http.MethodPost, "/api/v1/clipboard/items",
		ownerABearer, "", "", targetPayload(uuid.NewString(), own.ID), http.StatusForbidden)
	if err := db.Create(&meta.File{
		NodeID: own.ID, Size: 64, StorageKey: "CAS/owned", CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	deviceRequest(http.MethodPost, "/api/v1/clipboard/items",
		ownerABearer, "", "", targetPayload(uuid.NewString(), own.ID), http.StatusCreated)

	deviceRequest(http.MethodPost, "/api/v1/clipboard/devices/"+deviceA+"/revoke",
		ownerBBearer, "", "", "", http.StatusNotFound)
	deviceRequest(http.MethodPost, "/api/v1/clipboard/devices/"+deviceA+"/revoke",
		ownerABearer, "", "", "", http.StatusNoContent)
	deviceRequest(http.MethodPost, "/api/v1/clipboard/items",
		ownerABearer, "", "", targetPayload(uuid.NewString(), 0), http.StatusForbidden)
	revokedView := deviceRequest(http.MethodGet, "/api/v1/clipboard/items",
		ownerABearer, deviceA, deviceSecret, "", http.StatusOK)
	if strings.Contains(revokedView.Body.String(), targetEvent) {
		t.Fatal("revoked Clipboard key retained access to target")
	}
	deviceRequest(http.MethodPut, "/api/v1/clipboard/devices/self",
		ownerABearer, deviceA, deviceSecret, enrollment, http.StatusConflict)
}
