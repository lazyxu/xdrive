package api

import (
	"crypto/sha256"
	"encoding/hex"
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

func TestOwningLocalIdentityEvidencePersistsOnlyPrivateAdvisoryClaims(t *testing.T) {
	db, server, owner, other, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{},
		&meta.SourceItemAlias{}, &meta.SyncRun{}, &meta.LocalSourceItemEvidence{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("owning-local-item-evidence-proof", time.Hour)
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
	deviceASecret := "local-evidence-owning-device-A-long-secret-0001"
	deviceBSecret := "local-evidence-foreign-device-B-long-secret-0002"
	deviceA := meta.ClientDevice{ID: uuid.NewString(), OwnerID: owner.ID, Name: "Own A",
		Platform: "windows", CredentialHash: deviceCredentialDigest(deviceASecret),
		CreatedAt: now, UpdatedAt: now}
	deviceB := meta.ClientDevice{ID: uuid.NewString(), OwnerID: owner.ID, Name: "Foreign B",
		Platform: "linux", CredentialHash: deviceCredentialDigest(deviceBSecret),
		CreatedAt: now, UpdatedAt: now}
	for _, device := range []meta.ClientDevice{deviceA, deviceB} {
		if err := db.Create(&device).Error; err != nil {
			t.Fatal(err)
		}
	}
	rootID := uuid.NewString()
	fingerprint := strings.Repeat("a", 64)
	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "Local backup")
	source := meta.Source{OwnerID: owner.ID, Name: "Local evidence",
		Kind: meta.SourceKindLocalFolder, Direction: meta.SourceDirectionPush,
		SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeSync,
		Status: meta.SourceStatusPaused, Revision: 7, TargetNodeID: &target.ID}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.LocalSourceBinding{
		SourceID: source.ID, OwnerID: owner.ID, DeviceID: deviceA.ID,
		RootID: rootID, RootFingerprint: fingerprint,
		CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	pathKey := func(path string) string {
		sum := sha256.Sum256([]byte("xdrive-local-path-v1\x00" + rootID + "\x00file\x00" + path))
		return hex.EncodeToString(sum[:])
	}
	firstNode := createFilePropertiesFile(t, db, owner.ID, target.ID, "first.jpg", 3)
	secondNode := createFilePropertiesFile(t, db, owner.ID, target.ID, "second.jpg", 4)
	makeItem := func(path string, node meta.Node) meta.SourceItem {
		t.Helper()
		row := meta.SourceItem{
			SourceID: source.ID, ExternalID: pathKey(path), Path: path,
			Kind: meta.SourceItemKindFile, State: meta.SourceItemStateSynced,
			NodeID: &node.ID, NodeRevision: node.Revision, Size: 3, LastSeenAt: now,
		}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
		return row
	}
	first := makeItem("photos/first.jpg", firstNode)
	second := makeItem("photos/second.jpg", secondNode)
	uri := fmt.Sprintf("/api/v1/sources/%d/local-identity/evidence", source.ID)
	own := map[string]string{
		"If-Match":                        "\"7\"",
		"X-XDrive-Device-ID":              deviceA.ID,
		"X-XDrive-Device-Token":           deviceASecret,
		"X-XDrive-Local-Root-ID":          rootID,
		"X-XDrive-Local-Root-Fingerprint": fingerprint,
	}
	headers := func() map[string]string {
		result := make(map[string]string, len(own))
		for k, v := range own {
			result[k] = v
		}
		return result
	}
	claim := localSourceItemEvidenceRequest{
		SourceItemID:           first.ID,
		PreviousSnapshotSHA256: strings.Repeat("1", 64),
		CurrentSnapshotSHA256:  strings.Repeat("2", 64),
		PreviousPathKey:        first.ExternalID,
		CurrentPathKey:         pathKey("photos/renamed-first.jpg"),
		PreviousNativeKey:      strings.Repeat("3", 64),
		CurrentNativeKey:       strings.Repeat("3", 64),
		PreviousStrong:         true, CurrentStrong: true,
		PreviousLinkCount: 1, CurrentLinkCount: 1,
	}
	encode := func(value localSourceItemEvidenceRequest) string {
		t.Helper()
		data, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	send := func(jwt string, proof map[string]string, input string, want int) *localSourceItemEvidenceResponse {
		t.Helper()
		response := requestWithHeaders(t, router, http.MethodPost, uri, jwt,
			strings.NewReader(input), want, proof)
		if want != http.StatusOK && want != http.StatusCreated {
			return nil
		}
		if response.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatalf("evidence reply is cacheable: %v", response.Header())
		}
		if response.Header().Get("ETag") != "\"7\"" {
			t.Fatalf("missing Source revision ETag: %v", response.Header())
		}
		for _, forbidden := range []string{"root_id", "root_fingerprint", "device_token",
			"previous_path", "current_path", "snapshot_sha256", "native_identity",
			"node_id", "source_item_alias", "photos/"} {
			if strings.Contains(response.Body.String(), forbidden) {
				t.Fatalf("private local evidence leaked %q", forbidden)
			}
		}
		var out localSourceItemEvidenceResponse
		if err := json.Unmarshal(response.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		if out.SourceID != source.ID || out.Revision != 7 ||
			out.SourceItemID != claim.SourceItemID || out.EvidenceID == 0 ||
			!out.Stored || out.Authoritative || out.MissingInferenceSafe {
			t.Fatalf("unsafe or incorrect evidence response: %+v", out)
		}
		return &out
	}
	send(ownerJWT, map[string]string{"If-Match": "\"7\""}, encode(claim), http.StatusForbidden)
	send(otherJWT, headers(), encode(claim), http.StatusNotFound)
	foreign := headers()
	foreign["X-XDrive-Device-ID"] = deviceB.ID
	foreign["X-XDrive-Device-Token"] = deviceBSecret
	send(ownerJWT, foreign, encode(claim), http.StatusForbidden)
	for _, changed := range []struct{ key, value string }{
		{"X-XDrive-Device-Token", deviceBSecret},
		{"X-XDrive-Local-Root-ID", uuid.NewString()},
		{"X-XDrive-Local-Root-Fingerprint", strings.Repeat("b", 64)},
	} {
		bad := headers()
		bad[changed.key] = changed.value
		send(ownerJWT, bad, encode(claim), http.StatusForbidden)
	}
	noRevision := headers()
	delete(noRevision, "If-Match")
	send(ownerJWT, noRevision, encode(claim), http.StatusPreconditionRequired)
	stale := headers()
	stale["If-Match"] = "\"6\""
	send(ownerJWT, stale, encode(claim), http.StatusConflict)

	for _, input := range []localSourceItemEvidenceRequest{
		{},
		func() localSourceItemEvidenceRequest { v := claim; v.SourceItemID = 0; return v }(),
		func() localSourceItemEvidenceRequest { v := claim; v.CurrentPathKey = v.PreviousPathKey; return v }(),
		func() localSourceItemEvidenceRequest {
			v := claim
			v.CurrentSnapshotSHA256 = v.PreviousSnapshotSHA256
			return v
		}(),
		func() localSourceItemEvidenceRequest {
			v := claim
			v.CurrentNativeKey = strings.Repeat("4", 64)
			return v
		}(),
		func() localSourceItemEvidenceRequest { v := claim; v.CurrentStrong = false; return v }(),
		func() localSourceItemEvidenceRequest { v := claim; v.PreviousLinkCount = 2; return v }(),
		func() localSourceItemEvidenceRequest {
			v := claim
			v.PreviousPathKey = strings.ToUpper(v.PreviousPathKey)
			return v
		}(),
		func() localSourceItemEvidenceRequest {
			v := claim
			v.PreviousSnapshotSHA256 = strings.Repeat("0", 64)
			return v
		}(),
	} {
		send(ownerJWT, headers(), encode(input), http.StatusBadRequest)
	}
	for _, input := range []string{
		`{"source_item_id":1,"unknown":true}`,
		`{"source_item_id":1}{"source_item_id":2}`,
		strings.Repeat(" ", 9<<10),
	} {
		send(ownerJWT, headers(), input, http.StatusBadRequest)
	}
	invalidItem := claim
	invalidItem.SourceItemID = second.ID
	send(ownerJWT, headers(), encode(invalidItem), http.StatusConflict)

	// Count-only recovery must never expose a SourceItem, local OS path,
	// device secret, private snapshot digest, or other-device metadata.
	summaryURI := fmt.Sprintf("/api/v1/sources/%d/local-identity/evidence-summary", source.ID)
	summaryPayload := fmt.Sprintf("{\"previous_snapshot_sha256\":%q,\"current_snapshot_sha256\":%q}",
		strings.Repeat("1", 64), strings.Repeat("2", 64))
	readSummary := func(jwt string, proof map[string]string, payload string, want int, n int64) {
		t.Helper()
		resp := requestWithHeaders(t, router, http.MethodPost, summaryURI,
			jwt, strings.NewReader(payload), want, proof)
		if want != http.StatusOK {
			return
		}
		if resp.Header().Get("Cache-Control") != "private, no-store" ||
			resp.Header().Get("ETag") != "\"7\"" {
			t.Fatalf("private advisory count response is cacheable or revisionless: %v", resp.Header())
		}
		for _, forbidden := range []string{"root_id", "fingerprint", "device_id",
			"native_identity", "source_item_id", "snapshot_sha256",
			"previous_path", "current_path", "photos/", "last_error"} {
			if strings.Contains(resp.Body.String(), forbidden) {
				t.Fatalf("advisory COUNT leaked %s", forbidden)
			}
		}
		var counted localEvidenceSummaryResponse
		if err := json.Unmarshal(resp.Body.Bytes(), &counted); err != nil {
			t.Fatal(err)
		}
		if counted.SourceID != source.ID || counted.Revision != 7 ||
			counted.StagedRecords != n || counted.Authoritative ||
			counted.MissingInferenceSafe {
			t.Fatalf("invalid private advisory count: %+v", counted)
		}
	}
	readSummary(ownerJWT, headers(), summaryPayload, http.StatusOK, 0)
	readSummary(ownerJWT, map[string]string{"If-Match": "\"7\""}, summaryPayload, http.StatusForbidden, 0)
	readSummary(otherJWT, headers(), summaryPayload, http.StatusNotFound, 0)
	readSummary(ownerJWT, foreign, summaryPayload, http.StatusForbidden, 0)
	readSummary(ownerJWT, stale, summaryPayload, http.StatusConflict, 0)
	for _, invalid := range []string{
		"{}",
		fmt.Sprintf("{\"previous_snapshot_sha256\":%q,\"current_snapshot_sha256\":%q}",
			strings.Repeat("0", 64), strings.Repeat("2", 64)),
		fmt.Sprintf("{\"previous_snapshot_sha256\":%q,\"current_snapshot_sha256\":%q}",
			strings.Repeat("1", 64), strings.Repeat("1", 64)),
		summaryPayload[:len(summaryPayload)-1] + ",\"unknown\":true}",
		summaryPayload + summaryPayload,
		strings.Repeat(" ", 600),
	} {
		readSummary(ownerJWT, headers(), invalid, http.StatusBadRequest, 0)
	}
	firstResult := send(ownerJWT, headers(), encode(claim), http.StatusCreated)
	if firstResult.Replayed {
		t.Fatalf("fresh local evidence incorrectly marked as replay: %+v", firstResult)
	}
	readSummary(ownerJWT, headers(), summaryPayload, http.StatusOK, 1)
	otherGeneration := fmt.Sprintf("{\"previous_snapshot_sha256\":%q,\"current_snapshot_sha256\":%q}",
		strings.Repeat("1", 64), strings.Repeat("4", 64))
	readSummary(ownerJWT, headers(), otherGeneration, http.StatusOK, 0)
	repeated := send(ownerJWT, headers(), encode(claim), http.StatusOK)
	if !repeated.Replayed || repeated.EvidenceID != firstResult.EvidenceID {
		t.Fatalf("exact replay created duplicate or changed identity: %+v %+v", firstResult, repeated)
	}
	// Same item + same generation cannot claim two different destination keys.
	newPathConflict := claim
	newPathConflict.CurrentPathKey = pathKey("photos/other-destination.jpg")
	send(ownerJWT, headers(), encode(newPathConflict), http.StatusConflict)
	// Another SourceItem cannot claim the same destination in one generation.
	otherItemConflict := claim
	otherItemConflict.SourceItemID = second.ID
	otherItemConflict.PreviousPathKey = second.ExternalID
	send(ownerJWT, headers(), encode(otherItemConflict), http.StatusConflict)
	// Different item already claims this identity as an alias.
	if err := db.Create(&meta.SourceItemAlias{
		SourceID: source.ID, SourceItemID: second.ID,
		AliasExternalID: claim.CurrentPathKey, AliasKind: meta.SourceItemAliasKindExternalID,
		CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	send(ownerJWT, headers(), encode(claim), http.StatusConflict)

	var evidence []meta.LocalSourceItemEvidence
	if err := db.Where("source_id = ?", source.ID).Find(&evidence).Error; err != nil {
		t.Fatal(err)
	}
	if len(evidence) != 1 || evidence[0].ID != firstResult.EvidenceID ||
		evidence[0].SourceItemID != first.ID || evidence[0].RootID != rootID ||
		evidence[0].SourceRevision != 7 {
		t.Fatalf("advisory evidence not persistently and privately fenced: %+v", evidence)
	}
	var sourceAfter meta.Source
	var itemAfter meta.SourceItem
	if err := db.First(&sourceAfter, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&itemAfter, first.ID).Error; err != nil {
		t.Fatal(err)
	}
	if sourceAfter.Revision != 7 || sourceAfter.Status != meta.SourceStatusPaused ||
		itemAfter.ExternalID != first.ExternalID || itemAfter.Path != first.Path ||
		itemAfter.NodeID == nil || *itemAfter.NodeID != firstNode.ID {
		t.Fatalf("evidence modified Source/SourceItem: source=%+v item=%+v", sourceAfter, itemAfter)
	}
	var runs, aliases int64
	if err := db.Model(&meta.SyncRun{}).Where("source_id = ?", source.ID).Count(&runs).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.SourceItemAlias{}).Where("source_id = ?", source.ID).Count(&aliases).Error; err != nil {
		t.Fatal(err)
	}
	if runs != 0 || aliases != 1 {
		t.Fatalf("advisory evidence created a run or alias: runs=%d aliases=%d", runs, aliases)
	}
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", deviceA.ID).
		Update("revoked_at", now).Error; err != nil {
		t.Fatal(err)
	}
	send(ownerJWT, headers(), encode(claim), http.StatusForbidden)
	readSummary(ownerJWT, headers(), summaryPayload, http.StatusForbidden, 0)
}
