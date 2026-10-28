package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

// iOS credentials can prove current Owner device identity and presence only.
// They must not be promoted to desktop Agent local_folder Source credentials.
func TestIOSDeviceIdentityCannotClaimLocalSourceOrCrossOwner(t *testing.T) {
	db, server, owner, other, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("ios-device-identity-isolation", time.Hour)
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

	registered := request(t, router, http.MethodPost, "/api/v1/devices", ownerToken,
		strings.NewReader(`{"name":"iPhone Photos","platform":"ios","client_version":"0.1"}`),
		http.StatusCreated)
	var enrolled registeredClientDeviceDTO
	if err := json.Unmarshal(registered.Body.Bytes(), &enrolled); err != nil {
		t.Fatal(err)
	}
	if enrolled.Device.ID == "" || enrolled.Device.Platform != "ios" ||
		len(enrolled.DeviceToken) < 32 || registered.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("bad iOS registration: %+v", enrolled.Device)
	}
	var persisted meta.ClientDevice
	if err := db.Where("id = ?", enrolled.Device.ID).Take(&persisted).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.OwnerID != owner.ID || persisted.Platform != "ios" ||
		persisted.CredentialHash == enrolled.DeviceToken {
		t.Fatal("iOS token was unbound, persisted in plaintext, or misclassified")
	}
	if !clientDeviceIdentityCredentialMatches(persisted, enrolled.DeviceToken) {
		t.Fatal("fresh iOS identity token rejected")
	}
	if clientDeviceCredentialMatches(persisted, enrolled.DeviceToken) {
		t.Fatal("iOS identity token incorrectly permits desktop Agent/Root mutations")
	}

	headers := map[string]string{
		"X-XDrive-Device-ID": enrolled.Device.ID,
		"X-XDrive-Device-Token": enrolled.DeviceToken,
	}
	response := requestWithHeaders(t, router, http.MethodGet, "/api/v1/devices/self",
		ownerToken, nil, http.StatusOK, headers)
	var identity struct {
		DeviceID string `json:"device_id"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &identity); err != nil {
		t.Fatal(err)
	}
	if identity.DeviceID != enrolled.Device.ID ||
		strings.Contains(response.Body.String(), enrolled.DeviceToken) ||
		strings.Contains(response.Body.String(), "root_id") {
		t.Fatalf("iOS device identity must disclose no Root or secret: %s", response.Body.String())
	}
	requestWithHeaders(t, router, http.MethodGet, "/api/v1/devices/self",
		otherToken, nil, http.StatusForbidden, headers)
	request(t, router, http.MethodGet, "/api/v1/devices/self", ownerToken,
		nil, http.StatusForbidden)

	heartbeat := requestWithHeaders(t, router, http.MethodPost,
		"/api/v1/devices/self/heartbeat", ownerToken, nil, http.StatusNoContent, headers)
	if heartbeat.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal("iOS identity heartbeat must not be publicly cached")
	}
	requestWithHeaders(t, router, http.MethodPost, "/api/v1/devices/self/heartbeat",
		otherToken, nil, http.StatusForbidden, headers)

	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "iOS identity-only target")
	local := fmt.Sprintf(
		`{"name":"iPhone Photos local claim","kind":"local_folder","direction":"push","sync_mode":"backup","run_mode":"sync","schedule_type":"manual","target_node_id":%d}`, target.ID,
	)
	requestWithHeaders(t, router, http.MethodPost, "/api/v1/sources", ownerToken,
		strings.NewReader(local), http.StatusForbidden, headers)

	request(t, router, http.MethodPost,
		"/api/v1/devices/"+enrolled.Device.ID+"/revoke",
		ownerToken, nil, http.StatusNoContent)
	requestWithHeaders(t, router, http.MethodGet, "/api/v1/devices/self",
		ownerToken, nil, http.StatusForbidden, headers)
	requestWithHeaders(t, router, http.MethodPost, "/api/v1/devices/self/heartbeat",
		ownerToken, nil, http.StatusForbidden, headers)

	// iOS is the only newly admitted identity-only platform; no new broad
	// Android/browser device credential class is accidentally allowed.
	request(t, router, http.MethodPost, "/api/v1/devices", ownerToken,
		strings.NewReader(`{"name":"Android","platform":"android","client_version":"0.1"}`),
		http.StatusBadRequest)
}

func TestDesktopDeviceCredentialStillAuthorizesAgentIdentity(t *testing.T) {
	token := "desktop-credential-value-at-least-32-characters"
	device := meta.ClientDevice{
		Platform: "windows",
		CredentialHash: deviceCredentialDigest(token),
	}
	if !clientDeviceCredentialMatches(device, token) ||
		!clientDeviceIdentityCredentialMatches(device, token) {
		t.Fatal("existing desktop credential behavior changed")
	}
}
