package api

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// A caller with the same account but a different machine must never
// discard another device's staging Source. A bound or historically used
// Source must never be deleted through this narrow creator-only endpoint.
func TestLocalSourceDraftDiscardRequiresCreatorAndEmptyHistory(t *testing.T) {
	db, srv, owner, other, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(
		&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SyncRun{},
		&meta.SourceRunFailure{}, &meta.SourceCollection{},
		&meta.SourceCredential{}, &meta.SourceConnectorConfig{},
	); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	srv.Auth = auth.New("local-draft-creator-test", time.Hour)
	router := srv.Router()
	ownerJWT, err := srv.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	otherJWT, err := srv.Auth.Issue(other.ID, other.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	secretA := "local-draft-device-a-long-enrollment-secret-001"
	secretB := "local-draft-device-b-long-enrollment-secret-002"
	deviceA := meta.ClientDevice{ID: uuid.NewString(), OwnerID: owner.ID, Name: "A", Platform: "windows", CredentialHash: deviceCredentialDigest(secretA), CreatedAt: now, UpdatedAt: now}
	deviceB := meta.ClientDevice{ID: uuid.NewString(), OwnerID: owner.ID, Name: "B", Platform: "linux", CredentialHash: deviceCredentialDigest(secretB), CreatedAt: now, UpdatedAt: now}
	for _, device := range []meta.ClientDevice{deviceA, deviceB} {
		if err := db.Create(&device).Error; err != nil {
			t.Fatal(err)
		}
	}
	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "Backup")
	creator := deviceA.ID
	newDraft := func(name string, claim *string) meta.Source {
		t.Helper()
		source := meta.Source{
			OwnerID: owner.ID, Name: name, Kind: meta.SourceKindLocalFolder,
			Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
			RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusPaused,
			Revision: 1, TargetNodeID: &target.ID, LocalCreatorDeviceID: claim,
		}
		if err := db.Create(&source).Error; err != nil {
			t.Fatal(err)
		}
		return source
	}
	urlFor := func(source meta.Source) string {
		return fmt.Sprintf("/api/v1/sources/%d/local-draft", source.ID)
	}
	valid := map[string]string{
		"If-Match": `"1"`, "X-XDrive-Device-ID": deviceA.ID,
		"X-XDrive-Device-Token": secretA,
	}
	foreign := map[string]string{
		"If-Match": `"1"`, "X-XDrive-Device-ID": deviceB.ID,
		"X-XDrive-Device-Token": secretB,
	}
	source := newDraft("Discard my staging Source", &creator)
	path := urlFor(source)
	requestWithHeaders(t, router, http.MethodDelete, path, ownerJWT, nil, http.StatusForbidden,
		map[string]string{"If-Match": `"1"`})
	requestWithHeaders(t, router, http.MethodDelete, path, ownerJWT, nil, http.StatusForbidden, foreign)
	requestWithHeaders(t, router, http.MethodDelete, path, otherJWT, nil, http.StatusForbidden, valid)
	requestWithHeaders(t, router, http.MethodDelete, path, ownerJWT, nil, http.StatusForbidden,
		map[string]string{"If-Match": `"1"`, "X-XDrive-Device-ID": deviceA.ID, "X-XDrive-Device-Token": secretB})
	// Generic Source DELETE remains Root-credential guarded even for
	// an unbound Source with a valid creating-device enrollment.
	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/sources/%d", source.ID),
		ownerJWT, nil, http.StatusForbidden, valid)
	requestWithHeaders(t, router, http.MethodDelete, path, ownerJWT, nil, http.StatusConflict,
		map[string]string{"If-Match": `"2"`, "X-XDrive-Device-ID": deviceA.ID, "X-XDrive-Device-Token": secretA})
	requestWithHeaders(t, router, http.MethodDelete, path, ownerJWT, nil, http.StatusNoContent, valid)
	var deleted meta.Source
	if err := db.Where("id = ?", source.ID).Take(&deleted).Error; err == nil {
		t.Fatal("creator's empty draft was not removed")
	} else if err != gorm.ErrRecordNotFound {
		t.Fatal(err)
	}
	var retained int64
	if err := db.Model(&meta.Node{}).Where("id = ?", target.ID).Count(&retained).Error; err != nil || retained != 1 {
		t.Fatalf("discard must retain target Node: count=%d err=%v", retained, err)
	}

	legacy := newDraft("Legacy unclaimed", nil)
	requestWithHeaders(t, router, http.MethodDelete, urlFor(legacy), ownerJWT, nil, http.StatusForbidden, valid)

	bound := newDraft("Bound root", &creator)
	if err := db.Create(&meta.LocalSourceBinding{
		SourceID: bound.ID, OwnerID: owner.ID, DeviceID: deviceA.ID,
		RootID: uuid.NewString(), RootFingerprint: strings.Repeat("a", 64),
		CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodDelete, urlFor(bound), ownerJWT, nil, http.StatusConflict, valid)

	historic := newDraft("Historical run", &creator)
	if err := db.Create(&meta.SyncRun{
		ID: uuid.NewString(), SourceID: historic.ID, RunNumber: 1,
		Status: meta.SyncRunStatusCompleted, Mode: meta.SourceRunModeSync,
		Trigger: meta.SyncRunTriggerManual, StartedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodDelete, urlFor(historic), ownerJWT, nil, http.StatusConflict, valid)

	item := newDraft("Historical item", &creator)
	if err := db.Create(&meta.SourceItem{
		SourceID: item.ID, ExternalID: "path:one", Kind: meta.SourceItemKindFile,
		Path: "private.jpg", State: meta.SourceItemStatePending, LastSeenAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodDelete, urlFor(item), ownerJWT, nil, http.StatusConflict, valid)

	active := newDraft("Unexpectedly active", &creator)
	if err := db.Model(&meta.Source{}).Where("id = ?", active.ID).
		Update("status", meta.SourceStatusActive).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodDelete, urlFor(active), ownerJWT, nil, http.StatusConflict, valid)

	revoked := newDraft("Revoked creator", &creator)
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", deviceA.ID).
		Update("revoked_at", now).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodDelete, urlFor(revoked), ownerJWT, nil, http.StatusForbidden, valid)
	// A second enrolled installation cannot use its own valid token to
	// reclaim a revoked creator's draft.
	requestWithHeaders(t, router, http.MethodDelete, urlFor(revoked), ownerJWT, nil, http.StatusForbidden, foreign)
	var count int64
	if err := db.Model(&meta.Source{}).Where("id IN ?", []uint64{
		legacy.ID, bound.ID, historic.ID, item.ID, active.ID, revoked.ID,
	}).Count(&count).Error; err != nil || count != 6 {
		t.Fatalf("cleanup must retain all protected Sources: count=%d err=%v", count, err)
	}
}
