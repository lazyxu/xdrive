package api

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestIOSPhotoRetentionRequiresExactCurrentOwnerAndDevice(t *testing.T) {
	db, server, owner, other, _ := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.UploadSession{},
		&meta.ContentBlob{}, &meta.IOSPhotoOriginalHold{},
		&meta.IOSPhotoOriginalHoldAncestor{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("ios-retention-exact-owner-device", time.Hour)
	ownerJWT, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	foreignJWT, err := server.Auth.Issue(other.ID, other.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	deviceSecret := "ios-retention-device-secret-0123456789abcdef"
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Platform: "ios",
		Name: "iPhone", CredentialHash: deviceCredentialDigest(deviceSecret),
		CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	router := server.Router()
	deviceHeaders := map[string]string{
		"X-XDrive-Device-ID":    device.ID,
		"X-XDrive-Device-Token": deviceSecret,
	}
	requestWithHeaders(t, router, http.MethodPut,
		"/api/v1/ios/photos/backup-destination", ownerJWT,
		strings.NewReader(`{"name":"iPhone"}`), http.StatusCreated, deviceHeaders)
	url := "/api/v1/ios/photos/managed/original-retention"
	body := `{"node_id":999999999,"node_revision":1,"session_id":"` +
		uuid.NewString() + `","sha256":"` + strings.Repeat("a", 64) +
		`","byte_size":200,"kind":"image"}`

	// The same Owner/Device scope can request a new proof, but an unknown
	// finalized managed original must never become an invented hold.
	requestWithHeaders(t, router, http.MethodPost, url, ownerJWT,
		strings.NewReader(body), http.StatusConflict, deviceHeaders)
	requestWithHeaders(t, router, http.MethodPost, url, "",
		strings.NewReader(body), http.StatusUnauthorized, deviceHeaders)
	requestWithHeaders(t, router, http.MethodPost, url, foreignJWT,
		strings.NewReader(body), http.StatusForbidden, deviceHeaders)
	requestWithHeaders(t, router, http.MethodPost, url, ownerJWT,
		strings.NewReader(body), http.StatusForbidden, nil)
	requestWithHeaders(t, router, http.MethodGet, url+"/"+uuid.NewString(),
		ownerJWT, nil, http.StatusNotFound, deviceHeaders)
}
