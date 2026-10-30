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

// Android native photo backup must have a real Owner device identity but may
// NEVER inherit desktop local-folder Source/Root/Agent privileges.
func TestAndroidIdentityOnlyCannotClaimLocalSourceOrCrossOwner(t *testing.T) {
    db, server, owner, other, root := setupFilePropertiesTestDB(t)
    if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SyncRun{}); err != nil {
        t.Fatal(err)
    }
    gin.SetMode(gin.TestMode)
    server.Auth = auth.New("android-device-identity-isolation", time.Hour)
    server.RefreshTTL = 24 * time.Hour
    router := server.Router()
    ownerToken, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
    if err != nil { t.Fatal(err) }
    otherToken, err := server.Auth.Issue(other.ID, other.SessionVersion)
    if err != nil { t.Fatal(err) }

    registered := request(t, router, http.MethodPost, "/api/v1/devices", ownerToken,
        strings.NewReader(`{"name":"Android Photos","platform":"android","client_version":"0.1"}`),
        http.StatusCreated)
    var enrolled registeredClientDeviceDTO
    if err := json.Unmarshal(registered.Body.Bytes(), &enrolled); err != nil {
        t.Fatal(err)
    }
    if enrolled.Device.ID == "" || enrolled.Device.Platform != "android" ||
        len(enrolled.DeviceToken) < 32 || registered.Header().Get("Cache-Control") != "no-store" {
        t.Fatalf("Android device enrollment lacked required identity evidence: %+v", enrolled.Device)
    }
    var persisted meta.ClientDevice
    if err := db.Where("id = ?", enrolled.Device.ID).Take(&persisted).Error; err != nil {
        t.Fatal(err)
    }
    if persisted.OwnerID != owner.ID || persisted.Platform != "android" ||
        persisted.CredentialHash == enrolled.DeviceToken {
        t.Fatal("Android enrollment leaked plaintext token, Owner or platform")
    }
    if !clientDeviceIdentityCredentialMatches(persisted, enrolled.DeviceToken) ||
        clientDeviceCredentialMatches(persisted, enrolled.DeviceToken) {
        t.Fatal("Android identity token incorrectly accepted as a Desktop Agent credential")
    }
    headers := map[string]string{
        "X-XDrive-Device-ID": enrolled.Device.ID,
        "X-XDrive-Device-Token": enrolled.DeviceToken,
    }
    response := requestWithHeaders(t, router, http.MethodGet, "/api/v1/devices/self",
        ownerToken, nil, http.StatusOK, headers)
    var self struct { DeviceID string `json:"device_id"` }
    if err := json.Unmarshal(response.Body.Bytes(), &self); err != nil {
        t.Fatal(err)
    }
    if self.DeviceID != enrolled.Device.ID ||
        strings.Contains(response.Body.String(), enrolled.DeviceToken) ||
        strings.Contains(response.Body.String(), "root_id") {
        t.Fatalf("Android self endpoint exposed privileged capabilities: %s", response.Body.String())
    }
    requestWithHeaders(t, router, http.MethodGet, "/api/v1/devices/self",
        otherToken, nil, http.StatusForbidden, headers)
    request(t, router, http.MethodGet, "/api/v1/devices/self", ownerToken,
        nil, http.StatusForbidden)

    heartbeat := requestWithHeaders(t, router, http.MethodPost,
        "/api/v1/devices/self/heartbeat", ownerToken,
        nil, http.StatusNoContent, headers)
    if heartbeat.Header().Get("Cache-Control") != "private, no-store" {
        t.Fatal("Android identity heartbeat must be private and noncacheable")
    }
    requestWithHeaders(t, router, http.MethodPost,
        "/api/v1/devices/self/heartbeat", otherToken,
        nil, http.StatusForbidden, headers)

    target := createFilePropertiesDir(t, db, owner.ID, root.ID, "Android identity-only target")
    localFolder := fmt.Sprintf(
        `{"name":"Android local-folder escalation","kind":"local_folder","direction":"push","sync_mode":"backup","run_mode":"sync","schedule_type":"manual","target_node_id":%d}`,
        target.ID,
    )
    requestWithHeaders(t, router, http.MethodPost, "/api/v1/sources", ownerToken,
        strings.NewReader(localFolder), http.StatusForbidden, headers)

    request(t, router, http.MethodPost, "/api/v1/devices/"+enrolled.Device.ID+"/revoke",
        ownerToken, nil, http.StatusNoContent)
    requestWithHeaders(t, router, http.MethodGet, "/api/v1/devices/self",
        ownerToken, nil, http.StatusForbidden, headers)
    requestWithHeaders(t, router, http.MethodPost,
        "/api/v1/devices/self/heartbeat", ownerToken,
        nil, http.StatusForbidden, headers)
}
