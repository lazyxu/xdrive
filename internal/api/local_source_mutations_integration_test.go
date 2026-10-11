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

func TestBoundLocalSourceWritesRequireOwningDeviceAndRoot(t *testing.T) {
	db, server, owner, other, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(
		&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SyncRun{},
		&meta.SourceRunFailure{}, &meta.SourceCollection{},
		&meta.SourceCredential{}, &meta.SourceConnectorConfig{},
	); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("bound-local-source-mutation-proof", time.Hour)
	server.RefreshTTL = 24 * time.Hour
	router := server.Router()
	ownerJWT, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	otherJWT, err := server.Auth.Issue(other.ID, other.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	deviceASecret := "bound-mutation-device-A-long-private-credential-001"
	deviceBSecret := "bound-mutation-device-B-long-private-credential-002"
	deviceA := meta.ClientDevice{ID: uuid.NewString(), OwnerID: owner.ID, Name: "Desktop A", Platform: "windows", CredentialHash: deviceCredentialDigest(deviceASecret), CreatedAt: now, UpdatedAt: now}
	deviceB := meta.ClientDevice{ID: uuid.NewString(), OwnerID: owner.ID, Name: "Desktop B", Platform: "linux", CredentialHash: deviceCredentialDigest(deviceBSecret), CreatedAt: now, UpdatedAt: now}
	for _, device := range []meta.ClientDevice{deviceA, deviceB} {
		if err := db.Create(&device).Error; err != nil {
			t.Fatal(err)
		}
	}
	rootID := uuid.NewString()
	fingerprint := strings.Repeat("a", 64)
	targetID := root.ID
	makeBound := func(name string) meta.Source {
		t.Helper()
		source := meta.Source{OwnerID: owner.ID, Name: name, Kind: meta.SourceKindLocalFolder, Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusPaused, Revision: 1, TargetNodeID: &targetID}
		if err := db.Create(&source).Error; err != nil {
			t.Fatal(err)
		}
		binding := meta.LocalSourceBinding{SourceID: source.ID, OwnerID: owner.ID, DeviceID: deviceA.ID, RootID: rootID, RootFingerprint: fingerprint, CreatedAt: now, UpdatedAt: now}
		if err := db.Create(&binding).Error; err != nil {
			t.Fatal(err)
		}
		return source
	}
	sourceA := makeBound("A root")
	sourceB := makeBound("A spare root")
	sourceC := makeBound("A revoke root")
	sourceD := makeBound("A retarget root")
	modeSource := makeBound("A mode policy root")
	rulesSource := makeBound("A private ignore rules root")
	scheduleSource := makeBound("A private pending schedule root")
	sourceURL := fmt.Sprintf("/api/v1/sources/%d", sourceA.ID)
	own := map[string]string{
		"X-XDrive-Device-ID":              deviceA.ID,
		"X-XDrive-Device-Token":           deviceASecret,
		"X-XDrive-Local-Root-ID":          rootID,
		"X-XDrive-Local-Root-Fingerprint": fingerprint,
		"If-Match":                        "\"1\"",
	}
	copyHeaders := func() map[string]string {
		headers := make(map[string]string, len(own))
		for key, value := range own {
			headers[key] = value
		}
		return headers
	}
	operations := []struct {
		method string
		suffix string
		body   string
	}{
		{http.MethodPatch, "", "{\"name\":\"unauthorized change\"}"},
		{http.MethodDelete, "", ""},
		{http.MethodPost, "/trigger", ""},
		{http.MethodDelete, "/local-binding", ""},
	}
	for _, op := range operations {
		t.Run(op.method+op.suffix, func(t *testing.T) {
			var payload = func() *strings.Reader { return strings.NewReader(op.body) }
			requestWithHeaders(t, router, op.method, sourceURL+op.suffix, ownerJWT, payload(), http.StatusForbidden, map[string]string{"If-Match": "\"1\""})
			requestWithHeaders(t, router, op.method, sourceURL+op.suffix, otherJWT, payload(), http.StatusNotFound, own)
			foreign := copyHeaders()
			foreign["X-XDrive-Device-ID"] = deviceB.ID
			foreign["X-XDrive-Device-Token"] = deviceBSecret
			requestWithHeaders(t, router, op.method, sourceURL+op.suffix, ownerJWT, payload(), http.StatusForbidden, foreign)
			for _, replace := range []struct{ header, value string }{
				{"X-XDrive-Device-Token", "invalid credential"},
				{"X-XDrive-Local-Root-ID", uuid.NewString()},
				{"X-XDrive-Local-Root-Fingerprint", strings.Repeat("b", 64)},
			} {
				headers := copyHeaders()
				headers[replace.header] = replace.value
				requestWithHeaders(t, router, op.method, sourceURL+op.suffix, ownerJWT, payload(), http.StatusForbidden, headers)
			}
		})
	}
	// The target-only mutation uses the same credential/Root transaction
	// fencing, validates owner and directory type, and retains Source identity.
	newTarget := meta.Node{
		OwnerID: owner.ID, ParentID: &root.ID, Name: "backup-new-target",
		Type: meta.NodeTypeDir, Revision: 1,
	}
	if err := db.Create(&newTarget).Error; err != nil {
		t.Fatal(err)
	}
	foreignTarget := meta.Node{
		OwnerID: other.ID, Name: "foreign-backup-target",
		Type: meta.NodeTypeDir, Revision: 1,
	}
	if err := db.Create(&foreignTarget).Error; err != nil {
		t.Fatal(err)
	}
	targetURL := fmt.Sprintf("/api/v1/sources/%d", sourceD.ID)
	validTargetBody := fmt.Sprintf(`{"target_node_id":%d}`, newTarget.ID)
	foreignTargetBody := fmt.Sprintf(`{"target_node_id":%d}`, foreignTarget.ID)
	requestWithHeaders(t, router, http.MethodPatch, targetURL, ownerJWT, strings.NewReader(validTargetBody), http.StatusForbidden,
		map[string]string{"If-Match": "\"1\""})
	badDevice := copyHeaders()
	badDevice["X-XDrive-Device-ID"] = deviceB.ID
	badDevice["X-XDrive-Device-Token"] = deviceBSecret
	requestWithHeaders(t, router, http.MethodPatch, targetURL, ownerJWT, strings.NewReader(validTargetBody), http.StatusForbidden, badDevice)
	requestWithHeaders(t, router, http.MethodPatch, targetURL, ownerJWT, strings.NewReader(foreignTargetBody), http.StatusBadRequest, own)
	retargetResponse := requestWithHeaders(t, router, http.MethodPatch, targetURL, ownerJWT, strings.NewReader(validTargetBody), http.StatusOK, own)
	var retargeted sourceDTO
	if err := json.Unmarshal(retargetResponse.Body.Bytes(), &retargeted); err != nil {
		t.Fatal(err)
	}
	if retargeted.ID != sourceD.ID || retargeted.Revision != 2 ||
		retargeted.TargetNodeID == nil || *retargeted.TargetNodeID != newTarget.ID ||
		retargeted.SyncMode != meta.SourceSyncModeBackup || retargeted.Status != meta.SourceStatusPaused {
		t.Fatalf("own local target update changed protected Source semantics: %+v", retargeted)
	}
	requestWithHeaders(t, router, http.MethodPatch, targetURL, ownerJWT, strings.NewReader(validTargetBody), http.StatusConflict, own)

	// A mode-only PATCH is protected by the same transaction fence and
	// clears any prior Mirror deletion evidence before future scans.
	modeURL := fmt.Sprintf("/api/v1/sources/%d", modeSource.ID)
	item := meta.SourceItem{
		SourceID: modeSource.ID, ExternalID: "policy-evidence-item",
		Kind: meta.SourceItemKindFile, Path: "photo.jpg",
		State: meta.SourceItemStateSynced, LastSeenAt: now,
		MirrorMissingFullScans: 2, MirrorMissingSince: &now,
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodPatch, modeURL, ownerJWT, strings.NewReader("{\"sync_mode\":\"mirror\"}"), http.StatusForbidden,
		map[string]string{"If-Match": "\"1\""})
	foreignMode := copyHeaders()
	foreignMode["X-XDrive-Device-ID"] = deviceB.ID
	foreignMode["X-XDrive-Device-Token"] = deviceBSecret
	requestWithHeaders(t, router, http.MethodPatch, modeURL, ownerJWT, strings.NewReader("{\"sync_mode\":\"mirror\"}"), http.StatusForbidden, foreignMode)
	var untouchedItem meta.SourceItem
	if err := db.First(&untouchedItem, item.ID).Error; err != nil ||
		untouchedItem.MirrorMissingFullScans != 2 || untouchedItem.MirrorMissingSince == nil {
		t.Fatalf("rejected backup policy changed deletion evidence: %+v err=%v", untouchedItem, err)
	}
	modeResponse := requestWithHeaders(t, router, http.MethodPatch, modeURL, ownerJWT, strings.NewReader("{\"sync_mode\":\"mirror\"}"), http.StatusOK, own)
	var modeUpdated sourceDTO
	if err := json.Unmarshal(modeResponse.Body.Bytes(), &modeUpdated); err != nil {
		t.Fatal(err)
	}
	if modeUpdated.SyncMode != meta.SourceSyncModeMirror || modeUpdated.Status != meta.SourceStatusPaused ||
		modeUpdated.ID != modeSource.ID || modeUpdated.Revision != 2 {
		t.Fatalf("policy update changed Source identity or activated execution: %+v", modeUpdated)
	}
	var resetItem meta.SourceItem
	if err := db.First(&resetItem, item.ID).Error; err != nil ||
		resetItem.MirrorMissingFullScans != 0 || resetItem.MirrorMissingSince != nil {
		t.Fatalf("policy change failed to clear Mirror evidence: %+v err=%v", resetItem, err)
	}
	requestWithHeaders(t, router, http.MethodPatch, modeURL, ownerJWT, strings.NewReader("{\"sync_mode\":\"backup\"}"), http.StatusConflict, own)

	// Generic Source reads stay redacted. Only an exact owning Agent may
	// retrieve local rules through the private, transaction-proofed route.
	rulesURL := fmt.Sprintf("/api/v1/sources/%d", rulesSource.ID)
	privateRulesURL := rulesURL + "/local-rules"
	initialRules := "*.tmp\nprivate/\n!private/keep.jpg"
	if err := db.Model(&meta.Source{}).Where("id = ?", rulesSource.ID).
		Update("ignore_rules", initialRules).Error; err != nil {
		t.Fatal(err)
	}
	generic := request(t, router, http.MethodGet, rulesURL, ownerJWT, nil, http.StatusOK)
	var redacted sourceDTO
	if err := json.Unmarshal(generic.Body.Bytes(), &redacted); err != nil {
		t.Fatal(err)
	}
	if redacted.IgnoreRules != "" {
		t.Fatal("generic owner-JWT read leaked local ignore rules")
	}
	requestWithHeaders(t, router, http.MethodGet, privateRulesURL, ownerJWT, nil, http.StatusForbidden, nil)
	requestWithHeaders(t, router, http.MethodGet, privateRulesURL, otherJWT, nil, http.StatusNotFound, own)
	foreignRules := copyHeaders()
	foreignRules["X-XDrive-Device-ID"] = deviceB.ID
	foreignRules["X-XDrive-Device-Token"] = deviceBSecret
	requestWithHeaders(t, router, http.MethodGet, privateRulesURL, ownerJWT, nil, http.StatusForbidden, foreignRules)
	spoofedRules := copyHeaders()
	spoofedRules["X-XDrive-Local-Root-Fingerprint"] = strings.Repeat("f", 64)
	requestWithHeaders(t, router, http.MethodGet, privateRulesURL, ownerJWT, nil, http.StatusForbidden, spoofedRules)
	authorizedRules := requestWithHeaders(t, router, http.MethodGet, privateRulesURL, ownerJWT, nil, http.StatusOK, own)
	var privateDTO localSourceIgnoreRulesDTO
	if err := json.Unmarshal(authorizedRules.Body.Bytes(), &privateDTO); err != nil {
		t.Fatal(err)
	}
	if privateDTO.SourceID != rulesSource.ID || privateDTO.Revision != 1 ||
		privateDTO.IgnoreRules != initialRules ||
		authorizedRules.Header().Get("Cache-Control") != "private, no-store" ||
		authorizedRules.Header().Get("ETag") != "\"1\"" {
		t.Fatalf("private rules response is wrong or cacheable: %+v", privateDTO)
	}
	for _, sensitive := range []string{"root_id", "device_token", "root_fingerprint", "checkpoint"} {
		if strings.Contains(authorizedRules.Body.String(), sensitive) {
			t.Fatalf("private rules leaked a native secret: %s", sensitive)
		}
	}

	// Updating rules with the owning Root must preserve the paused status,
	// increment revision, and discard obsolete Mirror deletion evidence.
	itemRules := meta.SourceItem{
		SourceID: rulesSource.ID, ExternalID: "rules-test-history",
		Kind: meta.SourceItemKindFile, Path: "safe.txt",
		State: meta.SourceItemStateSynced, LastSeenAt: now,
		MirrorMissingFullScans: 2, MirrorMissingSince: &now,
	}
	if err := db.Create(&itemRules).Error; err != nil {
		t.Fatal(err)
	}
	validRules := "{\"ignore_rules\":\"*.cache\\n!keep.cache\"}"
	requestWithHeaders(t, router, http.MethodPatch, rulesURL, ownerJWT, strings.NewReader(validRules),
		http.StatusForbidden, map[string]string{"If-Match": "\"1\""})
	requestWithHeaders(t, router, http.MethodPatch, rulesURL, ownerJWT, strings.NewReader(validRules),
		http.StatusForbidden, foreignRules)
	requestWithHeaders(t, router, http.MethodPatch, rulesURL, ownerJWT, strings.NewReader("{\"ignore_rules\":\"../escape\"}"),
		http.StatusBadRequest, own)
	var oldItem meta.SourceItem
	if err := db.First(&oldItem, itemRules.ID).Error; err != nil || oldItem.MirrorMissingFullScans != 2 {
		t.Fatalf("rejected rules change mutated missing evidence: %+v err=%v", oldItem, err)
	}
	savedRules := requestWithHeaders(t, router, http.MethodPatch, rulesURL, ownerJWT, strings.NewReader(validRules),
		http.StatusOK, own)
	var savedSource sourceDTO
	if err := json.Unmarshal(savedRules.Body.Bytes(), &savedSource); err != nil {
		t.Fatal(err)
	}
	if savedSource.ID != rulesSource.ID || savedSource.Revision != 2 ||
		savedSource.Status != meta.SourceStatusPaused || savedSource.IgnoreRules != "" {
		t.Fatalf("Source PATCH exposed private rules or activated backup: %+v", savedSource)
	}
	var currentItem meta.SourceItem
	if err := db.First(&currentItem, itemRules.ID).Error; err != nil ||
		currentItem.MirrorMissingFullScans != 0 || currentItem.MirrorMissingSince != nil {
		t.Fatalf("rule update did not reset Mirror evidence: %+v err=%v", currentItem, err)
	}
	requestWithHeaders(t, router, http.MethodPatch, rulesURL, ownerJWT, strings.NewReader(validRules),
		http.StatusConflict, own)
	stalePrivate := requestWithHeaders(t, router, http.MethodGet, privateRulesURL, ownerJWT, nil,
		http.StatusOK, own)
	var newRules localSourceIgnoreRulesDTO
	if err := json.Unmarshal(stalePrivate.Body.Bytes(), &newRules); err != nil ||
		newRules.Revision != 2 || newRules.IgnoreRules != "*.cache\n!keep.cache" {
		t.Fatalf("private rules did not reflect latest revision: %+v err=%v", newRules, err)
	}

	// Generic owner-JWT reads must redact native schedule configuration,
	// just as they redact local filesystem ignore rules. Only the bound
	// owning Agent may use the private schedule endpoint.
	scheduleURL := fmt.Sprintf("/api/v1/sources/%d", scheduleSource.ID)
	privateScheduleURL := scheduleURL + "/local-schedule"
	initialSchedule := map[string]any{
		"schedule_type": "cron", "schedule_expression": "0 3 * * *", "schedule_timezone": "UTC",
	}
	if err := db.Model(&meta.Source{}).Where("id = ?", scheduleSource.ID).
		Updates(initialSchedule).Error; err != nil {
		t.Fatal(err)
	}
	scheduleGeneric := request(t, router, http.MethodGet, scheduleURL, ownerJWT, nil, http.StatusOK)
	var scheduleGenericDTO sourceDTO
	if err := json.Unmarshal(scheduleGeneric.Body.Bytes(), &scheduleGenericDTO); err != nil {
		t.Fatal(err)
	}
	if scheduleGenericDTO.ScheduleType != "" || scheduleGenericDTO.ScheduleExpression != "" ||
		scheduleGenericDTO.ScheduleTimezone != "" {
		t.Fatalf("generic owner-JWT Source leaked private native schedule: %+v", scheduleGenericDTO)
	}
	requestWithHeaders(t, router, http.MethodGet, privateScheduleURL, ownerJWT, nil, http.StatusForbidden, nil)
	requestWithHeaders(t, router, http.MethodGet, privateScheduleURL, otherJWT, nil, http.StatusNotFound, own)
	foreignSchedule := copyHeaders()
	foreignSchedule["X-XDrive-Device-ID"] = deviceB.ID
	foreignSchedule["X-XDrive-Device-Token"] = deviceBSecret
	requestWithHeaders(t, router, http.MethodGet, privateScheduleURL, ownerJWT, nil, http.StatusForbidden, foreignSchedule)
	wrongScheduleRoot := copyHeaders()
	wrongScheduleRoot["X-XDrive-Local-Root-ID"] = uuid.NewString()
	requestWithHeaders(t, router, http.MethodGet, privateScheduleURL, ownerJWT, nil, http.StatusForbidden, wrongScheduleRoot)
	scheduleRead := requestWithHeaders(t, router, http.MethodGet, privateScheduleURL, ownerJWT, nil, http.StatusOK, own)
	var privateSchedule localSourceScheduleDTO
	if err := json.Unmarshal(scheduleRead.Body.Bytes(), &privateSchedule); err != nil {
		t.Fatal(err)
	}
	if privateSchedule.SourceID != scheduleSource.ID || privateSchedule.Revision != 1 ||
		privateSchedule.ScheduleType != "cron" || privateSchedule.ScheduleExpression != "0 3 * * *" ||
		privateSchedule.ScheduleTimezone != "UTC" ||
		scheduleRead.Header().Get("Cache-Control") != "private, no-store" ||
		scheduleRead.Header().Get("ETag") != "\"1\"" {
		t.Fatalf("private local schedule read invalid or cacheable: %+v", privateSchedule)
	}
	for _, field := range []string{"device_token", "root_fingerprint", "root_id", "local_path", "ignore_rules", "checkpoint"} {
		if strings.Contains(scheduleRead.Body.String(), field) {
			t.Fatalf("private local schedule leaked %s", field)
		}
	}

	// An invalid expression/timezone is never persisted. Owner JWT and a
	// foreign same-account device cannot change the schedule, even when
	// they know the Source ID and exactly which revision to submit.
	for _, invalid := range []string{
		`{"schedule_type":"cron","schedule_expression":"0 3 * *","schedule_timezone":"UTC"}`,
		`{"schedule_type":"cron","schedule_expression":"0 3 * * *","schedule_timezone":"Invalid/Timezone"}`,
		`{"schedule_type":"interval","schedule_expression":"30s","schedule_timezone":""}`,
	} {
		requestWithHeaders(t, router, http.MethodPatch, scheduleURL, ownerJWT, strings.NewReader(invalid),
			http.StatusBadRequest, own)
	}
	validManual := `{"schedule_type":"manual","schedule_expression":"","schedule_timezone":""}`
	requestWithHeaders(t, router, http.MethodPatch, scheduleURL, ownerJWT, strings.NewReader(validManual),
		http.StatusForbidden, map[string]string{"If-Match": "\"1\""})
	requestWithHeaders(t, router, http.MethodPatch, scheduleURL, ownerJWT, strings.NewReader(validManual),
		http.StatusForbidden, foreignSchedule)
	scheduleEvidence := meta.SourceItem{
		SourceID: scheduleSource.ID, ExternalID: "schedule-pending-history",
		Kind: meta.SourceItemKindFile, Path: "do-not-delete.jpg",
		State: meta.SourceItemStateSynced, LastSeenAt: now,
		MirrorMissingFullScans: 2, MirrorMissingSince: &now,
	}
	if err := db.Create(&scheduleEvidence).Error; err != nil {
		t.Fatal(err)
	}
	savedSchedule := requestWithHeaders(t, router, http.MethodPatch, scheduleURL, ownerJWT,
		strings.NewReader(validManual), http.StatusOK, own)
	var savedScheduleSource sourceDTO
	if err := json.Unmarshal(savedSchedule.Body.Bytes(), &savedScheduleSource); err != nil {
		t.Fatal(err)
	}
	if savedScheduleSource.ID != scheduleSource.ID || savedScheduleSource.Revision != 2 ||
		savedScheduleSource.Status != meta.SourceStatusPaused ||
		savedScheduleSource.ScheduleType != "" || savedScheduleSource.ScheduleExpression != "" ||
		savedScheduleSource.ScheduleTimezone != "" || savedScheduleSource.RunRequestedAt != nil {
		t.Fatalf("saved-only local schedule activated execution or revealed configuration: %+v", savedScheduleSource)
	}
	savedPrivateSchedule := requestWithHeaders(t, router, http.MethodGet, privateScheduleURL, ownerJWT, nil,
		http.StatusOK, own)
	var manualPrivate localSourceScheduleDTO
	if err := json.Unmarshal(savedPrivateSchedule.Body.Bytes(), &manualPrivate); err != nil ||
		manualPrivate.Revision != 2 || manualPrivate.ScheduleType != "manual" ||
		manualPrivate.ScheduleExpression != "" || manualPrivate.ScheduleTimezone != "" {
		t.Fatalf("private schedule was not persisted: %+v err=%v", manualPrivate, err)
	}
	var stillIntact meta.SourceItem
	if err := db.First(&stillIntact, scheduleEvidence.ID).Error; err != nil ||
		stillIntact.MirrorMissingFullScans != 2 || stillIntact.MirrorMissingSince == nil {
		t.Fatalf("saved schedule touched Mirror evidence: %+v err=%v", stillIntact, err)
	}
	requestWithHeaders(t, router, http.MethodPatch, scheduleURL, ownerJWT,
		strings.NewReader(validManual), http.StatusConflict, own)
	// Even a synthetic, database-forced active local Source stays protected.
	if err := db.Model(&meta.Source{}).Where("id = ?", scheduleSource.ID).
		Update("status", meta.SourceStatusActive).Error; err != nil {
		t.Fatal(err)
	}
	scheduleRevision2 := copyHeaders()
	scheduleRevision2["If-Match"] = "\"2\""
	requestWithHeaders(t, router, http.MethodPatch, scheduleURL, ownerJWT,
		strings.NewReader(validManual), http.StatusConflict, scheduleRevision2)
	requestWithHeaders(t, router, http.MethodGet, privateScheduleURL, ownerJWT, nil,
		http.StatusConflict, scheduleRevision2)
	if err := db.Model(&meta.Source{}).Where("id = ?", scheduleSource.ID).
		Update("status", meta.SourceStatusPaused).Error; err != nil {
		t.Fatal(err)
	}

	var unchanged meta.Source
	if err := db.Where("id = ?", sourceA.ID).First(&unchanged).Error; err != nil {
		t.Fatal(err)
	}
	if unchanged.Revision != 1 || unchanged.Name != "A root" || unchanged.RunRequestedAt != nil {
		t.Fatalf("rejected writes changed local Source: %+v", unchanged)
	}
	validChange := requestWithHeaders(t, router, http.MethodPatch, sourceURL, ownerJWT, strings.NewReader("{\"name\":\"A renamed root\"}"), http.StatusOK, own)
	var changed sourceDTO
	if err := json.Unmarshal(validChange.Body.Bytes(), &changed); err != nil {
		t.Fatal(err)
	}
	if changed.Name != "A renamed root" || changed.Revision != 2 {
		t.Fatalf("owning Desktop could not update its bound local Source: %+v", changed)
	}
	fresh := copyHeaders()
	fresh["If-Match"] = "\"2\""
	requestWithHeaders(t, router, http.MethodPatch, sourceURL, ownerJWT, strings.NewReader("{\"status\":\"active\"}"), http.StatusConflict, fresh)
	requestWithHeaders(t, router, http.MethodPost, sourceURL+"/trigger", ownerJWT, nil, http.StatusConflict, fresh)
	if err := db.Model(&meta.Source{}).Where("id = ?", sourceA.ID).Update("status", meta.SourceStatusActive).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodPost, sourceURL+"/trigger", ownerJWT, nil, http.StatusConflict, fresh)
	if err := db.Model(&meta.Source{}).Where("id = ?", sourceA.ID).Update("status", meta.SourceStatusPaused).Error; err != nil {
		t.Fatal(err)
	}
	// The owning Desktop can remove an already-bound Source directly.
	requestWithHeaders(t, router, http.MethodDelete, sourceURL, ownerJWT, nil, http.StatusNoContent, fresh)

	// Removing a pristine local Source must not delete its cloud directory.
	var retainedTarget int64
	if err := db.Model(&meta.Node{}).Where("id = ?", targetID).Count(&retainedTarget).Error; err != nil || retainedTarget != 1 {
		t.Fatalf("removal must retain cloud target: count=%d err=%v", retainedTarget, err)
	}

	// Source IDs with any durable activity or pending active status must
	// remain intact; hard deletion otherwise cascades away history.
	historyRunSource := makeBound("A historically executed root")
	historyItemSource := makeBound("A historical item root")
	activeSource := makeBound("A active root")
	if err := db.Create(&meta.SyncRun{
		ID: uuid.NewString(), SourceID: historyRunSource.ID, RunNumber: 1,
		Status: meta.SyncRunStatusCompleted, Mode: meta.SourceRunModeSync,
		Trigger: meta.SyncRunTriggerManual, StartedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.SourceItem{
		SourceID: historyItemSource.ID, ExternalID: "file:stable",
		Kind: meta.SourceItemKindFile, Path: "preserve.jpg",
		State: meta.SourceItemStatePending, LastSeenAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.Source{}).Where("id = ?", activeSource.ID).
		Update("status", meta.SourceStatusActive).Error; err != nil {
		t.Fatal(err)
	}
	for _, blocked := range []meta.Source{historyRunSource, historyItemSource, activeSource} {
		url := fmt.Sprintf("/api/v1/sources/%d", blocked.ID)
		requestWithHeaders(t, router, http.MethodDelete, url, ownerJWT, nil, http.StatusConflict, own)
		var retainedSource meta.Source
		if err := db.Where("id = ?", blocked.ID).Take(&retainedSource).Error; err != nil {
			t.Fatalf("history guard deleted Source %d: %v", blocked.ID, err)
		}
	}
	var preservedRuns, preservedItems int64
	if err := db.Model(&meta.SyncRun{}).Where("source_id = ?", historyRunSource.ID).
		Count(&preservedRuns).Error; err != nil || preservedRuns != 1 {
		t.Fatalf("run lost during rejected removal: count=%d err=%v", preservedRuns, err)
	}
	if err := db.Model(&meta.SourceItem{}).Where("source_id = ?", historyItemSource.ID).
		Count(&preservedItems).Error; err != nil || preservedItems != 1 {
		t.Fatalf("item lost during rejected removal: count=%d err=%v", preservedItems, err)
	}

	spareURL := fmt.Sprintf("/api/v1/sources/%d", sourceB.ID)
	requestWithHeaders(t, router, http.MethodDelete, spareURL+"/local-binding", ownerJWT, nil, http.StatusNoContent, own)
	request(t, router, http.MethodGet, spareURL+"/local-binding", ownerJWT, nil, http.StatusNotFound)
	// Without a surviving device-ownership claim, unbound legacy Sources
	// intentionally fail closed rather than becoming remotely deletable.
	requestWithHeaders(t, router, http.MethodDelete, spareURL, ownerJWT, nil, http.StatusForbidden, fresh)

	revokeAt := now.Add(time.Second)
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", deviceA.ID).Update("revoked_at", revokeAt).Error; err != nil {
		t.Fatal(err)
	}
	revokedURL := fmt.Sprintf("/api/v1/sources/%d", sourceC.ID)
	requestWithHeaders(t, router, http.MethodPatch, revokedURL, ownerJWT, strings.NewReader("{\"name\":\"revoked\"}"), http.StatusForbidden, own)
	requestWithHeaders(t, router, http.MethodDelete, revokedURL+"/local-binding", ownerJWT, nil, http.StatusForbidden, own)
	var stillBound meta.LocalSourceBinding
	if err := db.Where("source_id = ?", sourceC.ID).First(&stillBound).Error; err != nil {
		t.Fatal(err)
	}
}

func TestNonLocalSourceWritesPreserveOwnerJWTCompatibility(t *testing.T) {
	db, server, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(
		&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SyncRun{},
		&meta.SourceRunFailure{}, &meta.SourceCollection{},
		&meta.SourceCredential{}, &meta.SourceConnectorConfig{},
	); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("non-local-pull-mutation-regression", time.Hour)
	server.RefreshTTL = 24 * time.Hour
	router := server.Router()
	ownerJWT, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	targetID := root.ID
	source := meta.Source{OwnerID: owner.ID, Name: "Pull owner JWT", Kind: "yike_photos", Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive, Revision: 1, TargetNodeID: &targetID}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	url := fmt.Sprintf("/api/v1/sources/%d", source.ID)
	requestWithHeaders(t, router, http.MethodPatch, url, ownerJWT, strings.NewReader("{\"name\":\"Pull updated\"}"), http.StatusOK, map[string]string{"If-Match": "\"1\""})
	request(t, router, http.MethodPost, url+"/trigger", ownerJWT, nil, http.StatusAccepted)
	requestWithHeaders(t, router, http.MethodDelete, url, ownerJWT, nil, http.StatusNoContent, map[string]string{"If-Match": "\"2\""})
}
