package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
)

func TestQuarantineLocalSourceCommitIntentsOwningAgentOnlyAndNoCanonicalWrites(t *testing.T) {
	db, server, owner, other, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{},
		&meta.SourceItemAlias{}, &meta.SyncRun{}, &meta.FileVersion{}, &meta.ContentBlob{},
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

	// L03-E1a ties the persisted quarantine IDs to *actual* currently
	// readable CAS bytes, but remains a time-bounded non-authoritative check.
	// The existing E0 write did NOT need CAS bytes; prepare a real fixture now.
	casStore, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server.Store = casStore
	original := "abc"
	sum := sha256.Sum256([]byte(original))
	sha := hex.EncodeToString(sum[:])
	key, err := storage.ContentAddressedKey(sha)
	if err != nil {
		t.Fatal(err)
	}
	putOriginal := func(payload string) {
		t.Helper()
		if n, err := casStore.Put(context.Background(), key, strings.NewReader(payload)); err != nil || n != int64(len(payload)) {
			t.Fatalf("CAS fixture write failed: %d %v", n, err)
		}
	}
	putOriginal(original)
	if err := db.Model(&meta.File{}).Where("node_id = ?", node.ID).
		Updates(map[string]any{"sha256": sha, "storage_key": key}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.SourceItem{}).Where("id = ?", item.ID).
		Update("sha256", sha).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.FileVersion{
		NodeID: node.ID, Revision: node.Revision, Size: 3,
		SHA256: sha, StorageKey: key, CreatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.ContentBlob{
		SHA256: sha, Size: 3, StorageKey: key,
		State: meta.ContentBlobStateReady, RefCount: 1,
		CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	contentInput := localEvidenceCloudMetadataRequest{
		PreviousSnapshotSHA256: evidence.PreviousSnapshotSHA256,
		CurrentSnapshotSHA256:  evidence.CurrentSnapshotSHA256,
		Items: []localEvidenceCloudMetadataItem{
			{EvidenceID: evidence.ID, SHA256: sha, Size: 3},
		},
	}
	contentJSON, err := json.Marshal(contentInput)
	if err != nil {
		t.Fatal(err)
	}
	contentURI := uri + "/content-preflight"
	checkContent := func(jwt string, headers map[string]string, payload string, status int) {
		t.Helper()
		rec := requestWithHeaders(t, router, http.MethodPost, contentURI, jwt, strings.NewReader(payload), status, headers)
		for _, private := range []string{rootID, fingerprint, deviceSecret, key, "cloud-old.jpg"} {
			if strings.Contains(rec.Body.String(), private) {
				t.Fatalf("quarantine physical response leaked private value")
			}
		}
		if status != http.StatusOK {
			return
		}
		if rec.Header().Get("Cache-Control") != "private, no-store" ||
			rec.Header().Get("ETag") != "\"7\"" {
			t.Fatalf("quarantine content preflight lost privacy/revision fence")
		}
		var got localQuarantinedContentResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if got.SourceID != source.ID || got.Revision != 7 || got.Checked != 1 ||
			!got.QuarantineMatched || !got.PhysicalCASMatched ||
			got.CloudBytesVerified || got.ContentVerified ||
			got.CommitSupported || got.Authoritative || got.MissingInferenceSafe {
			t.Fatalf("quarantine physical preflight falsely granted commit authority: %+v", got)
		}
	}
	checkContent(ownerJWT, map[string]string{"If-Match": "\"7\""}, string(contentJSON), http.StatusForbidden)
	checkContent(otherJWT, copyProof(), string(contentJSON), http.StatusNotFound)
	checkContent(ownerJWT, foreign, string(contentJSON), http.StatusForbidden)
	checkContent(ownerJWT, badToken, string(contentJSON), http.StatusForbidden)
	checkContent(ownerJWT, badRoot, string(contentJSON), http.StatusForbidden)
	checkContent(ownerJWT, stale, string(contentJSON), http.StatusConflict)
	checkContent(ownerJWT, copyProof(), "{}", http.StatusBadRequest)
	checkContent(ownerJWT, copyProof(), string(contentJSON)+"{}", http.StatusBadRequest)
	checkContent(ownerJWT, copyProof(), strings.Replace(string(contentJSON), "}", ",\"untrusted\":true}", 1), http.StatusBadRequest)
	checkContent(ownerJWT, copyProof(), string(contentJSON), http.StatusOK)
	// L03-E1b0: the combined quarantine+cloud metadata transaction must
	// fail closed when current FileVersion/CAS rows drift, without reusing
	// either a previous quarantine read or a positive physical observation.
	if err := db.Model(&meta.FileVersion{}).Where("node_id = ? AND revision = ?", node.ID, node.Revision).
		Update("sha256", strings.Repeat("f", 64)).Error; err != nil {
		t.Fatal(err)
	}
	checkContent(ownerJWT, copyProof(), string(contentJSON), http.StatusConflict)
	if err := db.Model(&meta.FileVersion{}).Where("node_id = ? AND revision = ?", node.ID, node.Revision).
		Update("sha256", sha).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.ContentBlob{}).Where("sha256 = ?", sha).
		Update("ref_count", 0).Error; err != nil {
		t.Fatal(err)
	}
	checkContent(ownerJWT, copyProof(), string(contentJSON), http.StatusConflict)
	if err := db.Model(&meta.ContentBlob{}).Where("sha256 = ?", sha).
		Update("ref_count", 1).Error; err != nil {
		t.Fatal(err)
	}
	checkContent(ownerJWT, copyProof(), string(contentJSON), http.StatusOK)
	// A valid, unquarantined evidence ID must not gain precommit status.
	unquarantined := contentInput
	unquarantined.Items = []localEvidenceCloudMetadataItem{
		{EvidenceID: evidence.ID + 1000, SHA256: sha, Size: 3},
	}
	unquarantinedJSON, _ := json.Marshal(unquarantined)
	checkContent(ownerJWT, copyProof(), string(unquarantinedJSON), http.StatusConflict)
	// Database-only integrity is not physical content availability.
	// The real Local CAS writer now rejects mismatched digest bytes. Inject
	// physical corruption deliberately outside that cooperating writer to
	// prove the read-only preflight still detects an untrusted disk change.
	tamperOutOfBand := func(data string) {
		t.Helper()
		full := filepath.Join(casStore.FilesystemRoot(), filepath.FromSlash(key))
		if err := os.WriteFile(full, []byte(data), 0o600); err != nil {
			t.Fatalf("failed to inject physical CAS corruption: %v", err)
		}
	}
	tamperOutOfBand("xyz")
	checkContent(ownerJWT, copyProof(), string(contentJSON), http.StatusConflict)
	tamperOutOfBand(original)
	// L03-E1b1b1a: an owning-device, paused Source may use the private
	// same-transaction GC hash guard. It is DB-only, increments no references,
	// changes no SourceItem/alias, and grants no identity commit authority.
	guardContext, _ := gin.CreateTestContext(httptest.NewRecorder())
	guardContext.Request = httptest.NewRequest(http.MethodPost, contentURI, nil)
	for key, value := range proof {
		guardContext.Request.Header.Set(key, value)
	}
	guardContext.Set("userID", owner.ID)
	owningProof := localSourceExecutorProof{
		DeviceID: deviceA.ID, RootID: rootID, SourceRevision: source.Revision,
	}
	guardContext.Set(localSourceExecutorContextKey, owningProof)
	if err := db.Transaction(func(tx *gorm.DB) error {
		snapshot, guardErr := server.checkLocalQuarantinedCASRetentionTx(
			tx, guardContext, source.ID, source.Revision, owningProof, contentInput)
		if guardErr != nil {
			return guardErr
		}
		if snapshot.revision != source.Revision || len(snapshot.objects) != 1 ||
			snapshot.objects[0].SHA256 != sha || snapshot.objects[0].Key != key {
			return fmt.Errorf("CAS retention guard fabricated mismatched objects: %+v", snapshot)
		}
		return nil
	}); err != nil {
		t.Fatalf("owning CAS retention guard rejected current canonical evidence: %v", err)
	}
	var retained meta.ContentBlob
	if err := db.Where("sha256 = ?", sha).First(&retained).Error; err != nil ||
		retained.RefCount != 1 || retained.State != meta.ContentBlobStateReady {
		t.Fatalf("read-only retention guard modified canonical reference: %+v %v", retained, err)
	}
	guardContext.Set(localSourceExecutorContextKey, localSourceExecutorProof{
		DeviceID: deviceB.ID, RootID: rootID, SourceRevision: source.Revision,
	})
	if err := db.Transaction(func(tx *gorm.DB) error {
		_, guardErr := server.checkLocalQuarantinedCASRetentionTx(
			tx, guardContext, source.ID, source.Revision, owningProof, contentInput)
		return guardErr
	}); !errors.Is(err, errLocalSourceExecutorTransactionUnauthorized) {
		t.Fatalf("foreign device could lock owning CAS for commit: %v", err)
	}
	guardContext.Set(localSourceExecutorContextKey, owningProof)
	guardContext.Request.Header.Set("X-XDrive-Device-Token", otherSecret)
	if err := db.Transaction(func(tx *gorm.DB) error {
		_, guardErr := server.checkLocalQuarantinedCASRetentionTx(
			tx, guardContext, source.ID, source.Revision, owningProof, contentInput)
		return guardErr
	}); !errors.Is(err, errLocalSourceExecutorTransactionUnauthorized) {
		t.Fatalf("wrong credential could lock CAS for commit: %v", err)
	}
	guardContext.Request.Header.Set("X-XDrive-Device-Token", deviceSecret)
	// A changed quarantine is not a reusable success token.
	if err := db.Model(&meta.LocalSourceCommitIntent{}).
		Where("source_id = ? AND evidence_id = ?", source.ID, evidence.ID).
		Update("state", "expired").Error; err != nil {
		t.Fatal(err)
	}
	checkContent(ownerJWT, copyProof(), string(contentJSON), http.StatusConflict)
	if err := db.Model(&meta.LocalSourceCommitIntent{}).
		Where("source_id = ? AND evidence_id = ?", source.ID, evidence.ID).
		Update("state", meta.LocalSourceCommitIntentStateQuarantined).Error; err != nil {
		t.Fatal(err)
	}
	checkContent(ownerJWT, copyProof(), string(contentJSON), http.StatusOK)

	// Recovery readback must not accept the owner JWT without the exact
	// enrolled device credential, Root proof and Source revision.
	pageURI := uri + "/page"
	pageInput := localCommitIntentPageRequest{
		PreviousSnapshotSHA256: evidence.PreviousSnapshotSHA256,
		CurrentSnapshotSHA256:  evidence.CurrentSnapshotSHA256,
		Limit:                  1,
	}
	pageJSON, err := json.Marshal(pageInput)
	if err != nil {
		t.Fatal(err)
	}
	readPage := func(jwt string, headers map[string]string, body string, status int) localCommitIntentPageResponse {
		t.Helper()
		rec := requestWithHeaders(t, router, http.MethodPost, pageURI, jwt, strings.NewReader(body), status, headers)
		for _, forbidden := range []string{rootID, fingerprint, deviceSecret, "cloud-old.jpg"} {
			if strings.Contains(rec.Body.String(), forbidden) {
				t.Fatalf("quarantine read leaked private value %q", forbidden)
			}
		}
		var got localCommitIntentPageResponse
		if status != http.StatusOK {
			return got
		}
		if rec.Header().Get("Cache-Control") != "private, no-store" ||
			rec.Header().Get("ETag") != `"7"` {
			t.Fatalf("unfenced quarantine page: %v", rec.Header())
		}
		for _, forbidden := range []string{
			"root_id", "device_id", "device_token", "source_item_id",
			"previous_path_key", "native_identity_key", "sha256",
		} {
			if strings.Contains(rec.Body.String(), forbidden) {
				t.Fatalf("quarantine read leaked field %q", forbidden)
			}
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if got.SourceID != source.ID || got.Revision != source.Revision ||
			got.CommitSupported || got.Authoritative || got.MissingInferenceSafe {
			t.Fatalf("quarantine read promoted authority: %+v", got)
		}
		return got
	}
	readPage(ownerJWT, map[string]string{"If-Match": `"7"`}, string(pageJSON), http.StatusForbidden)
	readPage(otherJWT, copyProof(), string(pageJSON), http.StatusNotFound)
	readPage(ownerJWT, foreign, string(pageJSON), http.StatusForbidden)
	readPage(ownerJWT, badRoot, string(pageJSON), http.StatusForbidden)
	readPage(ownerJWT, stale, string(pageJSON), http.StatusConflict)
	readPage(ownerJWT, copyProof(), `{"limit":1,"unexpected":true}`, http.StatusBadRequest)
	readPage(ownerJWT, copyProof(), string(pageJSON)+"{}", http.StatusBadRequest)
	first := readPage(ownerJWT, copyProof(), string(pageJSON), http.StatusOK)
	if len(first.EvidenceIDs) != 1 || first.EvidenceIDs[0] != evidence.ID ||
		first.HasMore || first.NextAfterID != evidence.ID {
		t.Fatalf("quarantined evidence cannot be recovered: %+v", first)
	}
	pageInput.AfterEvidenceID = evidence.ID
	afterJSON, err := json.Marshal(pageInput)
	if err != nil {
		t.Fatal(err)
	}
	last := readPage(ownerJWT, copyProof(), string(afterJSON), http.StatusOK)
	if len(last.EvidenceIDs) != 0 || last.HasMore || last.NextAfterID != 0 {
		t.Fatalf("quarantine readback cursor did not terminate: %+v", last)
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
	readPage(ownerJWT, copyProof(), string(pageJSON), http.StatusForbidden)
	checkContent(ownerJWT, copyProof(), string(contentJSON), http.StatusForbidden)
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
