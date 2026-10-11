package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestDeviceBackupHeartbeatRequiresCurrentOwningDeviceAndExpires(t *testing.T) {
	db, server, owner, other, _ := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("device-heartbeat-proof-secret", time.Hour)
	server.RefreshTTL = 24 * time.Hour
	router := server.Router()
	ownerToken, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	otherToken, err := server.Auth.Issue(other.ID, other.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	secret := "private-agent-device-heartbeat-credential-123456789"
	now := time.Now().UTC()
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "My Windows PC",
		Platform: "windows", CredentialHash: deviceCredentialDigest(secret),
		LastSeenAt: &now, CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	read := func(token string) (deviceBackupReadDTO, string) {
		t.Helper()
		resp := request(t, router, http.MethodGet, "/api/v1/device-backups", token, nil, http.StatusOK)
		var data struct {
			Devices []deviceBackupReadDTO `json:"devices"`
		}
		if err := json.Unmarshal(resp.Body.Bytes(), &data); err != nil || len(data.Devices) != 1 {
			t.Fatalf("invalid device backup read: %+v %v", data, err)
		}
		if resp.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatal("device status must never be cached")
		}
		return data.Devices[0], resp.Body.String()
	}
	before, _ := read(ownerToken)
	if before.ConnectionState != "unknown" || before.Revoked {
		t.Fatalf("registration or LastSeenAt misrepresented as heartbeat: %+v", before)
	}
	endpoint := "/api/v1/devices/self/heartbeat"
	headers := map[string]string{
		"X-XDrive-Device-ID": device.ID, "X-XDrive-Device-Token": secret,
	}
	request(t, router, http.MethodPost, endpoint, ownerToken, nil, http.StatusForbidden)
	requestWithHeaders(t, router, http.MethodPost, endpoint, otherToken, nil, http.StatusForbidden, headers)
	requestWithHeaders(t, router, http.MethodPost, endpoint, ownerToken, nil, http.StatusForbidden,
		map[string]string{"X-XDrive-Device-ID": uuid.NewString(), "X-XDrive-Device-Token": secret})
	requestWithHeaders(t, router, http.MethodPost, endpoint, ownerToken, nil, http.StatusForbidden,
		map[string]string{"X-XDrive-Device-ID": device.ID, "X-XDrive-Device-Token": strings.Repeat("x", 44)})
	requestWithHeaders(t, router, http.MethodPost, endpoint+"?source_id=1", ownerToken, nil,
		http.StatusBadRequest, headers)
	requestWithHeaders(t, router, http.MethodPost, endpoint, ownerToken,
		strings.NewReader("{}"), http.StatusBadRequest, headers)
	var stored meta.ClientDevice
	if err := db.Where("id = ?", device.ID).Take(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.HeartbeatAt != nil {
		t.Fatal("failed or foreign proof unexpectedly recorded a heartbeat")
	}

	result := requestWithHeaders(t, router, http.MethodPost, endpoint, ownerToken, nil,
		http.StatusNoContent, headers)
	if result.Header().Get("Cache-Control") != "private, no-store" ||
		result.Body.Len() != 0 {
		t.Fatalf("heartbeat returned cacheable or sensitive data: %d %s", result.Code, result.Body.String())
	}
	online, payload := read(ownerToken)
	if online.ConnectionState != "online" || online.Revoked ||
		strings.Contains(payload, secret) || strings.Contains(payload, "heartbeat_at") ||
		strings.Contains(payload, "credential_hash") {
		t.Fatalf("live read leaked proof or misrepresented presence: %+v %s", online, payload)
	}
	if err := db.Where("id = ?", device.ID).Take(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.HeartbeatAt == nil || stored.LastSeenAt == nil ||
		stored.LastSeenAt.Before(now) {
		t.Fatal("successful device proof did not persist server-observed heartbeat")
	}

	stale := time.Now().UTC().Add(-5 * time.Minute)
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", device.ID).
		Update("heartbeat_at", stale).Error; err != nil {
		t.Fatal(err)
	}
	offline, _ := read(ownerToken)
	if offline.ConnectionState != "offline" {
		t.Fatalf("expired authenticated heartbeat shown online: %+v", offline)
	}
	future := time.Now().UTC().Add(time.Hour)
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", device.ID).
		Update("heartbeat_at", future).Error; err != nil {
		t.Fatal(err)
	}
	untrusted, _ := read(ownerToken)
	if untrusted.ConnectionState != "unknown" {
		t.Fatalf("future-skew heartbeat shown online: %+v", untrusted)
	}
	requestWithHeaders(t, router, http.MethodPost, endpoint, ownerToken, nil,
		http.StatusNoContent, headers)
	request(t, router, http.MethodPost, "/api/v1/devices/"+device.ID+"/revoke",
		ownerToken, nil, http.StatusNoContent)
	requestWithHeaders(t, router, http.MethodPost, endpoint, ownerToken, nil,
		http.StatusForbidden, headers)
	revoked, _ := read(ownerToken)
	if !revoked.Revoked || revoked.ConnectionState != "unknown" {
		t.Fatalf("revoked credential still appeared online: %+v", revoked)
	}
	otherList := request(t, router, http.MethodGet, "/api/v1/device-backups",
		otherToken, nil, http.StatusOK)
	if strings.Contains(otherList.Body.String(), device.ID) {
		t.Fatal("another owner observed a device")
	}
}

func TestDeviceBackupConnectionStateNeverInfersPresenceFromRegistration(t *testing.T) {
	now := time.Now().UTC()
	registered := meta.ClientDevice{LastSeenAt: &now}
	if state := deviceBackupConnectionState(registered, now); state != "unknown" {
		t.Fatalf("LastSeenAt was accepted as heartbeat: %s", state)
	}
	registered.HeartbeatAt = &now
	if state := deviceBackupConnectionState(registered, now); state != "online" {
		t.Fatalf("fresh authenticated heartbeat rejected: %s", state)
	}
	expired := now.Add(-deviceBackupHeartbeatTTL - time.Second)
	registered.HeartbeatAt = &expired
	if state := deviceBackupConnectionState(registered, now); state != "offline" {
		t.Fatalf("expired heartbeat accepted: %s", state)
	}
	revoked := now
	registered.RevokedAt = &revoked
	if state := deviceBackupConnectionState(registered, now); state != "unknown" {
		t.Fatalf("revoked device appeared online: %s", state)
	}
}
