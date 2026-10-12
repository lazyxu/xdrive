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

func TestQuarantineLocalSourceCommitIntentsOwningAgentOnlyAndNoCanonicalWrites(t *testing.T) {
	db, server, owner, other, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{},
		&meta.SourceItemAlias{}, &meta.SyncRun{},
		&meta.LocalSourceItemEvidence{}, &meta.LocalSourceCommitIntent{}); err != nil {
		t.Fatal(err)
	}
	for _, index := range []string{
		"idx_xd_local_ci_ev", "idx_xd_local_ci_gen_item", "idx_xd_local_ci_gen_path",
	} {
		if !db.Migrator().HasIndex(&meta.LocalSourceCommitIntent{}, index) {
			t.Fatalf("missing quarantine uniqueness index %s", index)
		}
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("quarantine-only-local-identity-stage", time.Hour)
	server.RefreshTTL = 24 * time.Hour
	router := server.Router()
	ownerJWT, _ := server.Auth.Issue(owner.ID, owner.SessionVersion)
	otherJWT, _ := server.Auth.Issue(other.ID, other.SessionVersion)
	now := time.Now().UTC()
	deviceSecret := "local-commit-quarantine-owning-agent-long-secret"
	otherSecret := "local-commit-quarantine-other-agent-long-secret"
	deviceA := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "Own A",
		Platform: "windows", CredentialHash: deviceCredentialDigest(deviceSecret),
		CreatedAt: now, UpdatedAt: now,
	}
	deviceB := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "Other B",
		Platform: "linux", CredentialHash: deviceCredentialDigest(otherSecret),
		CreatedAt: now, UpdatedAt: now,
	}
	for _, device := range []meta.ClientDevice{deviceA, deviceB} {
		if err := db.Create(&device).Error; err != nil {
			t.Fatal(err)
		}
	}
	rootID, fingerprint := uuid.NewString(), strings.Repeat("a", 64)
	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "Private backups")
	source := meta.Source{
		OwnerID: owner.ID, Name: "Quarantined", Kind: meta.SourceKindLocalFolder,
		Direction: meta.SourceDirectionPush, Status: meta.SourceStatusPaused,
		Revision: 7, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, TargetNodeID: &target.ID,
	}
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
		hash := sha256.Sum256([]byte("xdrive-local-path-v1\x00" + rootID + "\x00file\x00" + path))
		return hex.EncodeToString(hash[:])
	}
	node := createFilePropertiesFile(t, db, owner.ID, target.ID, "cloud-old.jpg", 3)
	item := meta.SourceItem{
		SourceID: source.ID, ExternalID: pathKey("old/one.jpg"),
		Path: "old/one.jpg", Kind: meta.SourceItemKindFile,
		State: meta.SourceItemStateSynced, NodeID: &node.ID,
		NodeRevision: node.Revision, Size: 3, LastSeenAt: now,
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	evidence := meta.LocalSourceItemEvidence{
		SourceID: source.ID, SourceRevision: source.Revision, SourceItemID: item.ID,
		DeviceID: deviceA.ID, RootID: rootID, RootFingerprint: fingerprint,
		PreviousSnapshotSHA256: strings.Repeat("1", 64),
		CurrentSnapshotSHA256:  strings.Repeat("2", 64),
		PreviousPathKey:        item.ExternalID, CurrentPathKey: pathKey("new/one.jpg"),
		NativeIdentityKey: strings.Repeat("3", 64),
		CreatedAt:         now, UpdatedAt: now,
	}
	if err := db.Create(&evidence).Error; err != nil {
		t.Fatal(err)
	}
	uri := fmt.Sprintf("/api/v1/sources/%d/local-identity/commit-intents", source.ID)
	proof := map[string]string{
		"If-Match":                        "\"7\"",
		"X-XDrive-Device-ID":              deviceA.ID,
		"X-XDrive-Device-Token":           deviceSecret,
		"X-XDrive-Local-Root-ID":          rootID,
		"X-XDrive-Local-Root-Fingerprint": fingerprint,
	}
	copyProof := func() map[string]string {
		cloned := make(map[string]string, len(proof))
		for k, v := range proof {
			cloned[k] = v
		}
		return cloned
	}
	input := localEvidencePreflightRequest{
		PreviousSnapshotSHA256: evidence.PreviousSnapshotSHA256,
		CurrentSnapshotSHA256:  evidence.CurrentSnapshotSHA256,
		EvidenceIDs:            []uint64{evidence.ID},
	}
	body, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	send := func(jwt string, headers map[string]string, payload string, status int) localCommitIntentResponse {
		t.Helper()
		rec := requestWithHeaders(t, router, http.MethodPost, uri, jwt, strings.NewReader(payload), status, headers)
		var got localCommitIntentResponse
		if status != http.StatusOK && status != http.StatusCreated {
			if strings.Contains(rec.Body.String(), rootID) ||
				strings.Contains(rec.Body.String(), fingerprint) ||
				strings.Contains(rec.Body.String(), deviceSecret) {
				t.Fatal("quarantine error leaked private authorization")
			}
			return got
		}
		if rec.Header().Get("Cache-Control") != "private, no-store" ||
			rec.Header().Get("ETag") != "\"7\"" {
			t.Fatalf("missing privacy and revision fence: %v", rec.Header())
		}
		for _, forbidden := range []string{
			"root_id", "device_id", "device_token", "sha256",
			"native_identity", "source_item_id", "storage_key", "cloud-old.jpg",
		} {
			if strings.Contains(rec.Body.String(), forbidden) {
				t.Fatalf("commit quarantine leaked %q", forbidden)
			}
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if got.SourceID != source.ID || got.Revision != 7 ||
			got.CommitSupported || got.Authoritative || got.MissingInferenceSafe {
			t.Fatalf("quarantine granted commit authority: %+v", got)
		}
		return got
	}
	send(ownerJWT, map[string]string{"If-Match": "\"7\""}, string(body), http.StatusForbidden)
	send(otherJWT, copyProof(), string(body), http.StatusNotFound)
	foreign := copyProof()
	foreign["X-XDrive-Device-ID"] = deviceB.ID
	foreign["X-XDrive-Device-Token"] = otherSecret
	send(ownerJWT, foreign, string(body), http.StatusForbidden)
	badToken := copyProof()
	badToken["X-XDrive-Device-Token"] = otherSecret
	send(ownerJWT, badToken, string(body), http.StatusForbidden)
	badRoot := copyProof()
	badRoot["X-XDrive-Local-Root-ID"] = uuid.NewString()
	send(ownerJWT, badRoot, string(body), http.StatusForbidden)
	missingIfMatch := copyProof()
	delete(missingIfMatch, "If-Match")
	send(ownerJWT, missingIfMatch, string(body), http.StatusPreconditionRequired)
	stale := copyProof()
	stale["If-Match"] = "\"6\""
	send(ownerJWT, stale, string(body), http.StatusConflict)
	for _, invalid := range []string{
		"{}", string(body) + "{}",
		`{"previous_snapshot_sha256":"bad","current_snapshot_sha256":"bad","evidence_ids":[1]}`,
		strings.Replace(string(body), "}", `,"unexpected":true}`, 1),
	} {
		send(ownerJWT, copyProof(), invalid, http.StatusBadRequest)
	}
	created := send(ownerJWT, copyProof(), string(body), http.StatusCreated)
	if created.Quarantined != 1 || created.Replayed != 0 {
		t.Fatalf("did not quarantine one candidate: %+v", created)
	}
	replayed := send(ownerJWT, copyProof(), string(body), http.StatusOK)
	if replayed.Quarantined != 0 || replayed.Replayed != 1 {
		t.Fatalf("idempotent replay incorrect: %+v", replayed)
	}
	var stored meta.LocalSourceCommitIntent
	if err := db.Where("source_id = ? AND evidence_id = ?", source.ID, evidence.ID).
		First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.SourceRevision != source.Revision ||
		stored.State != meta.LocalSourceCommitIntentStateQuarantined ||
		stored.DeviceID != deviceA.ID || stored.RootID != rootID ||
		stored.CurrentSnapshotSHA256 != evidence.CurrentSnapshotSHA256 {
		t.Fatalf("quarantine intent lost immutable proof scope: %+v", stored)
	}
	var canonical meta.SourceItem
	if err := db.First(&canonical, item.ID).Error; err != nil {
		t.Fatal(err)
	}
	if canonical.ExternalID != item.ExternalID || canonical.Path != item.Path ||
		canonical.NodeRevision != item.NodeRevision || canonical.State != item.State {
		t.Fatal("quarantine modified the authoritative SourceItem")
	}
	for _, model := range []any{&meta.SourceItemAlias{}, &meta.SyncRun{}} {
		var count int64
		if err := db.Model(model).Where("source_id = ?", source.ID).
			Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("quarantine mutated aliases or runs: count=%d error=%v", count, err)
		}
	}
	// Stale evidence cannot be replayed into a new binding, generation or path.
	changed := pathKey("new/conflicting.jpg")
	if err := db.Model(&meta.LocalSourceItemEvidence{}).
		Where("id = ?", evidence.ID).Update("current_path_key", changed).Error; err != nil {
		t.Fatal(err)
	}
	send(ownerJWT, copyProof(), string(body), http.StatusConflict)
	if err := db.Model(&meta.LocalSourceItemEvidence{}).
		Where("id = ?", evidence.ID).Update("current_path_key", evidence.CurrentPathKey).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", deviceA.ID).
		Update("revoked_at", time.Now().UTC()).Error; err != nil {
		t.Fatal(err)
	}
	send(ownerJWT, copyProof(), string(body), http.StatusForbidden)
}

func TestValidateLocalCommitIntentBatchFailsClosed(t *testing.T) {
	base := localEvidencePreflightRequest{
		PreviousSnapshotSHA256: strings.Repeat("1", 64),
		CurrentSnapshotSHA256:  strings.Repeat("2", 64),
		EvidenceIDs:            []uint64{1},
	}
	if !validLocalCommitIntentRequest(base) {
		t.Fatal("valid private quarantine input rejected")
	}
	for _, ids := range [][]uint64{
		nil, {0}, {2, 1}, {1, 1},
		{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17},
	} {
		value := base
		value.EvidenceIDs = ids
		if validLocalCommitIntentRequest(value) {
			t.Fatalf("unsafe private quarantine batch accepted: %v", ids)
		}
	}
}
