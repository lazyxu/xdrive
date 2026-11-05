package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestSourceArchiveRetainsHistorySharesCASAndRestoresPaused(t *testing.T) {
	db, server, owner, stranger, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.SyncRun{}, &meta.FileVersion{}, &meta.Share{}, &meta.SourceCollection{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("source-archive-integration-test", time.Hour)
	router := server.Router()
	token, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	strangerToken, err := server.Auth.Issue(stranger.ID, stranger.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "existing pull target")
	photo := createFilePropertiesFile(t, db, owner.ID, target.ID, "photo.jpg", 12)
	targetID := target.ID
	requestedAt := time.Now().UTC()
	source := meta.Source{
		OwnerID: owner.ID, Name: "Archived Pull", Kind: "synology_files",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusActive,
		Revision: 1, TargetNodeID: &targetID, RunRequestedAt: &requestedAt,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	item := meta.SourceItem{
		SourceID: source.ID, ExternalID: "remote:photo", NodeID: &photo.ID,
		Kind: meta.SourceItemKindFile, Path: "photo.jpg", NodeRevision: photo.Revision,
		State: meta.SourceItemStateSynced, LastSeenAt: time.Now().UTC(),
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	finished := time.Now().UTC()
	run := meta.SyncRun{
		ID: uuid.NewString(), SourceID: source.ID, SourceRevision: source.Revision,
		Mode: meta.SourceRunModeScan, Trigger: meta.SyncRunTriggerManual,
		Status: meta.SyncRunStatusCompleted, StartedAt: finished.Add(-time.Minute),
		FinishedAt: &finished,
	}
	share := meta.Share{OwnerID: owner.ID, NodeID: target.ID,
		TokenHash: strings.Repeat("a", 64), Access: "read_only"}
	version := meta.FileVersion{NodeID: photo.ID, Revision: 1, Size: 11,
		StorageKey: "archived/history", SHA256: strings.Repeat("b", 64)}
	collection := meta.SourceCollection{SourceID: source.ID, ExternalID: "album",
		Kind: "album", Name: "Old album", State: meta.SourceCollectionStateActive,
		LastSeenAt: finished}
	for _, err := range []error{
		db.Create(&run).Error, db.Create(&share).Error,
		db.Create(&version).Error, db.Create(&collection).Error,
	} {
		if err != nil {
			t.Fatal(err)
		}
	}
	url := fmt.Sprintf("/api/v1/sources/%d", source.ID)
	requestWithHeaders(t, router, http.MethodPost, url+"/archive",
		strangerToken, nil, http.StatusNotFound,
		map[string]string{"If-Match": `"1"`})
	archivedResp := requestWithHeaders(t, router, http.MethodPost, url+"/archive",
		token, nil, http.StatusOK, map[string]string{"If-Match": `"1"`})
	var archived sourceDTO
	if err := json.Unmarshal(archivedResp.Body.Bytes(), &archived); err != nil {
		t.Fatal(err)
	}
	if archived.Status != meta.SourceStatusArchived || archived.Revision != 2 ||
		archived.TargetNodeID == nil || *archived.TargetNodeID != target.ID ||
		archived.RunRequestedAt != nil {
		t.Fatalf("archive changed source target or retained its next run: %+v", archived)
	}
	var visible []sourceDTO
	res := request(t, router, http.MethodGet, "/api/v1/sources", token, nil, http.StatusOK)
	if err := json.Unmarshal(res.Body.Bytes(), &visible); err != nil {
		t.Fatal(err)
	}
	for _, row := range visible {
		if row.ID == source.ID {
			t.Fatal("archived Source remained in default list")
		}
	}
	all := request(t, router, http.MethodGet, "/api/v1/sources?include_archived=true", token, nil, http.StatusOK)
	if err := json.Unmarshal(all.Body.Bytes(), &visible); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, row := range visible {
		if row.ID == source.ID && row.Status == meta.SourceStatusArchived {
			found = true
		}
	}
	if !found {
		t.Fatal("archived Source cannot be recovered from owner list")
	}
	// Credential refresh can auto-activate a Yike/Synology Pull Source in
	// older code; archived status must never be cleared through these APIs.
	request(t, router, http.MethodDelete, url+"/credential", token, nil, http.StatusConflict)
	requestWithHeaders(t, router, http.MethodPut, url+"/connector-config", token,
		strings.NewReader(`{"payload":{"roots":["/photos"]}}`),
		http.StatusConflict, map[string]string{"If-Match": `"1"`})
	request(t, router, http.MethodPost, url+"/trigger", token, nil, http.StatusConflict)
	requestWithHeaders(t, router, http.MethodPatch, url, token, strings.NewReader(`{"name":"altered"}`),
		http.StatusConflict, map[string]string{"If-Match": `"2"`})
	requestWithHeaders(t, router, http.MethodDelete, url, token, nil,
		http.StatusConflict, map[string]string{"If-Match": `"2"`})
	requestWithHeaders(t, router, http.MethodPost, url+"/restore", token,
		nil, http.StatusConflict, map[string]string{"If-Match": `"1"`})

	restoredResp := requestWithHeaders(t, router, http.MethodPost, url+"/restore",
		token, nil, http.StatusOK, map[string]string{"If-Match": `"2"`})
	var restored sourceDTO
	if err := json.Unmarshal(restoredResp.Body.Bytes(), &restored); err != nil {
		t.Fatal(err)
	}
	if restored.Status != meta.SourceStatusPaused || restored.Revision != 3 ||
		restored.TargetNodeID == nil || *restored.TargetNodeID != target.ID ||
		restored.RunRequestedAt != nil {
		t.Fatalf("restore activated Source or changed target: %+v", restored)
	}
	request(t, router, http.MethodPost, url+"/trigger", token, nil, http.StatusConflict)
	// A restored Source is visible to the default list, but never scheduled
	// automatically before the Owner explicitly reactivates it.
	res = request(t, router, http.MethodGet, "/api/v1/sources", token, nil, http.StatusOK)
	if err := json.Unmarshal(res.Body.Bytes(), &visible); err != nil {
		t.Fatal(err)
	}
	found = false
	for _, row := range visible {
		if row.ID == source.ID && row.Status == meta.SourceStatusPaused {
			found = true
		}
	}
	if !found {
		t.Fatal("restored Source not visible as paused")
	}
	// DELETE after restore re-archives the retained Source; it never discards
	// provider identity or synchronization history.
	requestWithHeaders(t, router, http.MethodDelete, url, token, nil,
		http.StatusNoContent, map[string]string{"If-Match": `"3"`})
	var archivedAgain meta.Source
	if err := db.First(&archivedAgain, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if archivedAgain.Status != meta.SourceStatusArchived || archivedAgain.Revision != 4 ||
		archivedAgain.TargetNodeID == nil || *archivedAgain.TargetNodeID != target.ID ||
		archivedAgain.RunRequestedAt != nil {
		t.Fatalf("DELETE did not re-archive the restored Source: %+v", archivedAgain)
	}

	var savedSource meta.Source
	var savedItem meta.SourceItem
	var savedRun meta.SyncRun
	var savedNode meta.Node
	var savedShare meta.Share
	var savedVersion meta.FileVersion
	var savedCollection meta.SourceCollection
	for _, err := range []error{
		db.First(&savedSource, source.ID).Error,
		db.First(&savedItem, item.ID).Error,
		db.Where("id = ?", run.ID).First(&savedRun).Error,
		db.First(&savedNode, photo.ID).Error,
		db.First(&savedShare, share.ID).Error,
		db.First(&savedVersion, version.ID).Error,
		db.First(&savedCollection, collection.ID).Error,
	} {
		if err != nil {
			t.Fatal(err)
		}
	}
	if savedSource.ID != source.ID || savedSource.Status != meta.SourceStatusArchived || savedSource.Revision != 4 ||
		savedItem.NodeID == nil || *savedItem.NodeID != photo.ID ||
		savedItem.Path != "photo.jpg" || savedRun.ID != run.ID ||
		savedRun.Status != meta.SyncRunStatusCompleted ||
		savedNode.ParentID == nil || *savedNode.ParentID != target.ID ||
		savedShare.NodeID != target.ID || savedShare.TokenHash != share.TokenHash ||
		savedVersion.StorageKey != version.StorageKey ||
		savedCollection.ExternalID != collection.ExternalID {
		t.Fatal("archiving/restore erased sync history or changed Node/Share/CAS identity")
	}

}

func TestSourceArchiveRejectsActiveSyncWithoutMutatingSource(t *testing.T) {
	db, server, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("source-archive-running-test", time.Hour)
	router := server.Router()
	token, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "active source")
	source := meta.Source{OwnerID: owner.ID, Name: "Active",
		Kind: "synology_files", Direction: meta.SourceDirectionPull,
		SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeScan,
		Status: meta.SourceStatusActive, Revision: 1, TargetNodeID: &target.ID}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	run := meta.SyncRun{ID: uuid.NewString(), SourceID: source.ID,
		SourceRevision: source.Revision, Mode: meta.SourceRunModeScan,
		Trigger: meta.SyncRunTriggerManual, Status: meta.SyncRunStatusRunning,
		StartedAt: time.Now().UTC()}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	url := fmt.Sprintf("/api/v1/sources/%d", source.ID)
	requestWithHeaders(t, router, http.MethodPost, url+"/archive", token, nil,
		http.StatusConflict, map[string]string{"If-Match": `"1"`})
	var after meta.Source
	if err := db.First(&after, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.Status != meta.SourceStatusActive || after.Revision != source.Revision {
		t.Fatalf("archived an actively syncing Source: %+v", after)
	}
	if err := db.Model(&meta.SyncRun{}).Where("id = ?", run.ID).
		Update("status", meta.SyncRunStatusCancelled).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodPost, url+"/archive", token, nil,
		http.StatusOK, map[string]string{"If-Match": `"1"`})
}
