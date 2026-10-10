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

func TestVerifiedLocalDeviceIdentityRequiresCurrentDeviceCredential(t *testing.T) {
	db, server, owner, other, _ := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("verified-local-device-identity-test", time.Hour)
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
	secret := "test-device-identity-credential-only-held-by-owning-agent-12345"
	now := time.Now().UTC()
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "Desktop A",
		Platform: "windows", CredentialHash: deviceCredentialDigest(secret),
		CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	endpoint := "/api/v1/devices/self"
	valid := map[string]string{
		"X-XDrive-Device-ID":    device.ID,
		"X-XDrive-Device-Token": secret,
	}
	response := requestWithHeaders(t, router, http.MethodGet, endpoint, ownerToken, nil, http.StatusOK, valid)
	if response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("credential-verified device identity must not be cached: %q", response.Header().Get("Cache-Control"))
	}
	var result struct {
		DeviceID string `json:"device_id"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.DeviceID != device.ID {
		t.Fatalf("wrong verified device ID: %+v", result)
	}
	for _, sensitive := range []string{secret, device.CredentialHash, "root_id", "root_fingerprint", "device_token"} {
		if strings.Contains(response.Body.String(), sensitive) {
			t.Fatalf("verified identity leaked %q: %s", sensitive, response.Body.String())
		}
	}
	request(t, router, http.MethodGet, endpoint, ownerToken, nil, http.StatusForbidden)
	requestWithHeaders(t, router, http.MethodGet, endpoint, ownerToken, nil, http.StatusForbidden,
		map[string]string{"X-XDrive-Device-ID": device.ID})
	requestWithHeaders(t, router, http.MethodGet, endpoint, ownerToken, nil, http.StatusForbidden,
		map[string]string{"X-XDrive-Device-ID": device.ID, "X-XDrive-Device-Token": "forged-token"})
	requestWithHeaders(t, router, http.MethodGet, endpoint, ownerToken, nil, http.StatusForbidden,
		map[string]string{"X-XDrive-Device-ID": uuid.NewString(), "X-XDrive-Device-Token": secret})
	requestWithHeaders(t, router, http.MethodGet, endpoint, otherToken, nil, http.StatusForbidden, valid)

	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", device.ID).
		Update("revoked_at", now).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodGet, endpoint, ownerToken, nil, http.StatusForbidden, valid)
}
