package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
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
)

func TestLocalEvidenceCloudMetadataMatchesOnlyCurrentReadyCASRecords(t *testing.T) {
	db, srv, owner, other, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{},
		&meta.SourceItemAlias{}, &meta.SyncRun{}, &meta.LocalSourceItemEvidence{},
		&meta.FileVersion{}, &meta.ContentBlob{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	srv.Auth = auth.New("local-private-cloud-metadata", time.Hour)
	srv.RefreshTTL = 24 * time.Hour
	router := srv.Router()
	casStore, storeErr := storage.NewLocal(t.TempDir())
	if storeErr != nil {
		t.Fatal(storeErr)
	}
	srv.Store = casStore
	ownerJWT, err := srv.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	otherJWT, err := srv.Auth.Issue(other.ID, other.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	tokenA, tokenB := "cloud-metadata-owner-device-secret-A-12345678", "cloud-metadata-other-device-secret-B-12345678"
	devA := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "Owning A", Platform: "windows",
		CredentialHash: deviceCredentialDigest(tokenA), CreatedAt: now, UpdatedAt: now,
	}
	devB := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "Foreign B", Platform: "linux",
		CredentialHash: deviceCredentialDigest(tokenB), CreatedAt: now, UpdatedAt: now,
	}
	for _, dev := range []meta.ClientDevice{devA, devB} {
		if err := db.Create(&dev).Error; err != nil {
			t.Fatal(err)
		}
	}
	rootID, fingerprint := uuid.NewString(), strings.Repeat("a", 64)
	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "Cloud")
	source := meta.Source{
		OwnerID: owner.ID, Name: "Own local files",
		Kind: meta.SourceKindLocalFolder, Direction: meta.SourceDirectionPush,
		Status: meta.SourceStatusPaused, Revision: 7,
		SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeSync,
		TargetNodeID: &target.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.LocalSourceBinding{
		SourceID: source.ID, OwnerID: owner.ID, DeviceID: devA.ID,
		RootID: rootID, RootFingerprint: fingerprint,
		CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	pathKey := func(path string) string {
		digest := sha256.Sum256([]byte("xdrive-local-path-v1\x00" + rootID + "\x00file\x00" + path))
		return hex.EncodeToString(digest[:])
	}
	previous, current := strings.Repeat("1", 64), strings.Repeat("2", 64)
	var claims []localEvidenceCloudMetadataItem
	var nodes []meta.Node
	var versions []meta.FileVersion
	var items []meta.SourceItem
	var keys []string
	for i := 0; i < 2; i++ {
		payload := fmt.Sprintf("stored-original-%d-%s", i, rootID)
		sum := sha256.Sum256([]byte(payload))
		sha := hex.EncodeToString(sum[:])
		key, err := storage.ContentAddressedKey(sha)
		if err != nil {
			t.Fatal(err)
		}
		if written, putErr := casStore.Put(context.Background(), key, strings.NewReader(payload)); putErr != nil || written != int64(len(payload)) {
			t.Fatalf("failed to stage genuine CAS object: %d %v", written, putErr)
		}
		node := createFilePropertiesFile(t, db, owner.ID, target.ID,
			fmt.Sprintf("cloud-%d.bin", i), int64(len(payload)))
		if err := db.Model(&meta.File{}).Where("node_id = ?", node.ID).
			Updates(map[string]any{"sha256": sha, "storage_key": key}).Error; err != nil {
			t.Fatal(err)
		}
		version := meta.FileVersion{
			NodeID: node.ID, Revision: node.Revision, Size: int64(len(payload)),
			SHA256: sha, StorageKey: key, CreatedAt: now,
		}
		if err := db.Create(&version).Error; err != nil {
			t.Fatal(err)
		}
		blob := meta.ContentBlob{
			SHA256: sha, Size: int64(len(payload)), StorageKey: key,
			State: meta.ContentBlobStateReady, RefCount: 1, CreatedAt: now, UpdatedAt: now,
		}
		if err := db.Create(&blob).Error; err != nil {
			t.Fatal(err)
		}
		oldPath, newPath := fmt.Sprintf("old/%d.bin", i), fmt.Sprintf("new/%d.bin", i)
		item := meta.SourceItem{
			SourceID: source.ID, ExternalID: pathKey(oldPath), Path: oldPath,
			Kind: meta.SourceItemKindFile, State: meta.SourceItemStateSynced,
			Size: int64(len(payload)), SHA256: sha,
			NodeID: &node.ID, NodeRevision: node.Revision, LastSeenAt: now,
		}
		if err := db.Create(&item).Error; err != nil {
			t.Fatal(err)
		}
		evidence := meta.LocalSourceItemEvidence{
			SourceID: source.ID, SourceRevision: 7, SourceItemID: item.ID,
			DeviceID: devA.ID, RootID: rootID, RootFingerprint: fingerprint,
			PreviousSnapshotSHA256: previous, CurrentSnapshotSHA256: current,
			PreviousPathKey: pathKey(oldPath), CurrentPathKey: pathKey(newPath),
			NativeIdentityKey: fmt.Sprintf("%064x", i+500),
			CreatedAt:         now, UpdatedAt: now,
		}
		if err := db.Create(&evidence).Error; err != nil {
			t.Fatal(err)
		}
		claims = append(claims, localEvidenceCloudMetadataItem{
			EvidenceID: evidence.ID, SHA256: sha, Size: int64(len(payload)),
		})
		nodes = append(nodes, node)
		versions = append(versions, version)
		items = append(items, item)
		keys = append(keys, key)
	}
	uri := fmt.Sprintf("/api/v1/sources/%d/local-identity/evidence-cloud-metadata", source.ID)
	proof := map[string]string{
		"If-Match": "\"7\"", "X-XDrive-Device-ID": devA.ID,
		"X-XDrive-Device-Token":           tokenA,
		"X-XDrive-Local-Root-ID":          rootID,
		"X-XDrive-Local-Root-Fingerprint": fingerprint,
	}
	clone := func() map[string]string {
		h := make(map[string]string, len(proof))
		for k, v := range proof {
			h[k] = v
		}
		return h
	}
	body := func(before, after string, rows []localEvidenceCloudMetadataItem) string {
		t.Helper()
		b, err := json.Marshal(localEvidenceCloudMetadataRequest{
			PreviousSnapshotSHA256: before, CurrentSnapshotSHA256: after, Items: rows,
		})
		if err != nil {
			t.Fatal(err)
		}
		return string(b)
	}
	original := body(previous, current, claims)
	send := func(jwt string, headers map[string]string, input string, want int) {
		t.Helper()
		resp := requestWithHeaders(t, router, http.MethodPost, uri,
			jwt, strings.NewReader(input), want, headers)
		for _, secret := range []string{tokenA, rootID, keys[0], claims[0].SHA256, "source_item_id", "storage_key"} {
			if strings.Contains(resp.Body.String(), secret) {
				t.Fatalf("cloud metadata response leaked sensitive data: %s", secret)
			}
		}
		if want != http.StatusOK {
			return
		}
		if resp.Header().Get("Cache-Control") != "private, no-store" ||
			resp.Header().Get("ETag") != "\"7\"" {
			t.Fatalf("cloud metadata response cacheable or missing revision: %v", resp.Header())
		}
		var got localEvidenceCloudMetadataResponse
		if err := json.Unmarshal(resp.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		var query localEvidenceCloudMetadataRequest
		if err := json.Unmarshal([]byte(input), &query); err != nil {
			t.Fatal(err)
		}
		if got.SourceID != source.ID || got.Revision != 7 ||
			got.Checked != len(query.Items) || !got.CloudMetadataMatched ||
			got.CloudBytesVerified || got.ContentVerified || got.CommitSupported ||
			got.Authoritative || got.MissingInferenceSafe {
			t.Fatalf("cloud metadata elevated authority or incorrect: %+v", got)
		}
	}
	send(ownerJWT, clone(), original, http.StatusOK)
	send(ownerJWT, clone(), body(previous, current, claims[:1]), http.StatusOK)

	// The new bounded read must open the actual CAS object, without
	// accepting a path, Node ID or cloud key from the requesting device.
	physicalURI := fmt.Sprintf("/api/v1/sources/%d/local-identity/evidence-cloud-bytes", source.ID)
	sample := body(previous, current, claims[:1])
	sendPhysical := func(jwt string, headers map[string]string, payload string, want int) {
		t.Helper()
		resp := requestWithHeaders(t, router, http.MethodPost, physicalURI,
			jwt, strings.NewReader(payload), want, headers)
		for _, secret := range []string{tokenA, rootID, keys[0], claims[0].SHA256, "source_item_id", "storage_key"} {
			if strings.Contains(resp.Body.String(), secret) {
				t.Fatalf("physical CAS reply leaked private key/path/identity: %s", secret)
			}
		}
		if want != http.StatusOK {
			return
		}
		if resp.Header().Get("Cache-Control") != "private, no-store" ||
			resp.Header().Get("ETag") != "\"7\"" {
			t.Fatalf("physical CAS reply missing private no-store and revision: %v", resp.Header())
		}
		var got localEvidencePhysicalCASResponse
		if err := json.Unmarshal(resp.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		var submitted localEvidenceCloudMetadataRequest
		if err := json.Unmarshal([]byte(payload), &submitted); err != nil {
			t.Fatal(err)
		}
		if got.SourceID != source.ID || got.Revision != 7 || got.Checked != len(submitted.Items) ||
			!got.CloudMetadataMatched || !got.PhysicalCASMatched ||
			got.CloudBytesVerified || got.ContentVerified || got.CommitSupported ||
			got.Authoritative || got.MissingInferenceSafe {
			t.Fatalf("physical sample elevated commit authority: %+v", got)
		}
	}
	sendPhysical(ownerJWT, clone(), sample, http.StatusOK)
	sendPhysical(ownerJWT, clone(), original, http.StatusOK) // two actual CAS objects, atomic batch
	// Total-read-size and per-request item count are validated before any DB
	// or Store work, including on otherwise valid ordered native evidence.
	overBudget := append([]localEvidenceCloudMetadataItem(nil), claims...)
	overBudget[0].Size = 64 << 20
	sendPhysical(ownerJWT, clone(), body(previous, current, overBudget), http.StatusBadRequest)
	tooMany := make([]localEvidenceCloudMetadataItem, 5)
	for i := range tooMany {
		tooMany[i] = localEvidenceCloudMetadataItem{
			EvidenceID: claims[0].EvidenceID + uint64(i),
			SHA256:     claims[0].SHA256, Size: 0,
		}
	}
	sendPhysical(ownerJWT, clone(), body(previous, current, tooMany), http.StatusBadRequest)
	// A corrupt second object rejects the WHOLE request, not a 1-of-2 success.
	// This fixture models an external disk writer, since the normal Local CAS
	// writer must now reject bytes that do not match the canonical hash key.
	putOutOfBand := func(key, data string) {
		t.Helper()
		full := filepath.Join(casStore.FilesystemRoot(), filepath.FromSlash(key))
		if err := os.WriteFile(full, []byte(data), 0o600); err != nil {
			t.Fatalf("failed to simulate out-of-band physical CAS corruption: %v", err)
		}
	}
	originalSecond := fmt.Sprintf("stored-original-%d-%s", 1, rootID)
	badSecond := strings.Repeat("x", len(originalSecond))
	putOutOfBand(keys[1], badSecond)
	sendPhysical(ownerJWT, clone(), original, http.StatusConflict)
	sendPhysical(ownerJWT, clone(), sample, http.StatusOK)
	putOutOfBand(keys[1], originalSecond)
	sendPhysical(ownerJWT, clone(), original, http.StatusOK)
	sendPhysical(otherJWT, clone(), sample, http.StatusNotFound)
	sendPhysical(ownerJWT, map[string]string{"If-Match": "\"7\""}, sample, http.StatusForbidden)
	wrongRevision := clone()
	wrongRevision["If-Match"] = "\"6\""
	sendPhysical(ownerJWT, wrongRevision, sample, http.StatusConflict)
	foreignProof := clone()
	foreignProof["X-XDrive-Device-ID"], foreignProof["X-XDrive-Device-Token"] = devB.ID, tokenB
	sendPhysical(ownerJWT, foreignProof, sample, http.StatusForbidden)
	// A perfectly valid ready CAS DATABASE row is insufficient when its
	// backing object is truncated, corrupt at identical length or missing.
	originalPhysical := fmt.Sprintf("stored-original-%d-%s", 0, rootID)
	putPhysical := func(data string) { putOutOfBand(keys[0], data) }
	putPhysical(strings.Repeat("x", int(claims[0].Size)))
	sendPhysical(ownerJWT, clone(), sample, http.StatusConflict)
	putPhysical(originalPhysical[:len(originalPhysical)-1])
	sendPhysical(ownerJWT, clone(), sample, http.StatusConflict)
	putPhysical(originalPhysical)
	sendPhysical(ownerJWT, clone(), sample, http.StatusOK)
	if err := casStore.Delete(context.Background(), keys[0]); err != nil {
		t.Fatal(err)
	}
	sendPhysical(ownerJWT, clone(), sample, http.StatusConflict)
	putPhysical(originalPhysical)
	sendPhysical(ownerJWT, clone(), sample, http.StatusOK)
	send(otherJWT, clone(), original, http.StatusNotFound)
	send(ownerJWT, map[string]string{"If-Match": "\"7\""}, original, http.StatusForbidden)
	foreign := clone()
	foreign["X-XDrive-Device-ID"], foreign["X-XDrive-Device-Token"] = devB.ID, tokenB
	send(ownerJWT, foreign, original, http.StatusForbidden)
	badRoot := clone()
	badRoot["X-XDrive-Local-Root-ID"] = uuid.NewString()
	send(ownerJWT, badRoot, original, http.StatusForbidden)
	stale := clone()
	stale["If-Match"] = "\"6\""
	send(ownerJWT, stale, original, http.StatusConflict)
	wrongHash := append([]localEvidenceCloudMetadataItem(nil), claims...)
	wrongHash[0].SHA256 = strings.Repeat("f", 64)
	send(ownerJWT, clone(), body(previous, current, wrongHash), http.StatusConflict)
	wrongSize := append([]localEvidenceCloudMetadataItem(nil), claims...)
	wrongSize[0].Size++
	send(ownerJWT, clone(), body(previous, current, wrongSize), http.StatusConflict)
	send(ownerJWT, clone(), body(previous, strings.Repeat("3", 64), claims), http.StatusConflict)
	missing := append([]localEvidenceCloudMetadataItem(nil), claims...)
	missing[1].EvidenceID += 100
	send(ownerJWT, clone(), body(previous, current, missing), http.StatusConflict)
	for _, malformed := range []string{
		body(previous, current, nil), body(previous, previous, claims),
		body(previous, current, []localEvidenceCloudMetadataItem{claims[1], claims[0]}),
		body(previous, current, []localEvidenceCloudMetadataItem{claims[0], claims[0]}),
		body(previous, current, []localEvidenceCloudMetadataItem{{EvidenceID: claims[0].EvidenceID, SHA256: strings.Repeat("A", 64), Size: 1}}),
		original + "{}", strings.Repeat(" ", 17<<10),
	} {
		send(ownerJWT, clone(), malformed, http.StatusBadRequest)
	}
	if err := db.Delete(&versions[0]).Error; err != nil {
		t.Fatal(err)
	}
	send(ownerJWT, clone(), original, http.StatusConflict)
	if err := db.Create(&versions[0]).Error; err != nil {
		t.Fatal(err)
	}
	mutate := func(table any, condition string, id any, field string, changed, normal any) {
		t.Helper()
		apply := func(value any) {
			t.Helper()
			if err := db.Model(table).Where(condition, id).Update(field, value).Error; err != nil {
				t.Fatal(err)
			}
		}
		apply(changed)
		send(ownerJWT, clone(), original, http.StatusConflict)
		apply(normal)
		send(ownerJWT, clone(), original, http.StatusOK)
	}
	mutate(&meta.Node{}, "id = ?", nodes[0].ID, "revision", nodes[0].Revision+1, nodes[0].Revision)
	mutate(&meta.SourceItem{}, "id = ?", items[0].ID, "sha256", strings.Repeat("f", 64), claims[0].SHA256)
	mutate(&meta.File{}, "node_id = ?", nodes[0].ID, "sha256", strings.Repeat("f", 64), claims[0].SHA256)
	mutate(&meta.FileVersion{}, "id = ?", versions[0].ID, "sha256", strings.Repeat("f", 64), claims[0].SHA256)
	mutate(&meta.FileVersion{}, "id = ?", versions[0].ID, "storage_key", "legacy/unverified", keys[0])
	mutate(&meta.ContentBlob{}, "sha256 = ?", claims[0].SHA256, "state", meta.ContentBlobStateDeleting, meta.ContentBlobStateReady)
	mutate(&meta.ContentBlob{}, "sha256 = ?", claims[0].SHA256, "ref_count", int64(0), int64(1))
	mutate(&meta.ContentBlob{}, "sha256 = ?", claims[0].SHA256, "storage_key", "legacy/unverified", keys[0])
	mutate(&meta.SourceItem{}, "id = ?", items[0].ID, "path", "untrusted/changed.bin", items[0].Path)
	mutate(&meta.Node{}, "id = ?", nodes[0].ID, "deleted_at", now, nil)
	// A destination already owned by another SourceItem cannot become a
	// false content match, even if both file bodies happen to be identical.
	alias := meta.SourceItemAlias{
		SourceID: source.ID, SourceItemID: items[1].ID,
		AliasExternalID: pathKey("new/0.bin"),
		AliasKind:       meta.SourceItemAliasKindExternalID,
		CreatedAt:       now, UpdatedAt: now,
	}
	if err := db.Create(&alias).Error; err != nil {
		t.Fatal(err)
	}
	send(ownerJWT, clone(), original, http.StatusConflict)
	if err := db.Delete(&alias).Error; err != nil {
		t.Fatal(err)
	}
	send(ownerJWT, clone(), original, http.StatusOK)
	var runs, aliases int64
	if err := db.Model(&meta.SyncRun{}).Where("source_id = ?", source.ID).Count(&runs).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.SourceItemAlias{}).Where("source_id = ?", source.ID).Count(&aliases).Error; err != nil {
		t.Fatal(err)
	}
	if runs != 0 || aliases != 0 {
		t.Fatalf("cloud metadata check created SourceRun or alias: runs=%d aliases=%d", runs, aliases)
	}
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", devA.ID).
		Update("revoked_at", now).Error; err != nil {
		t.Fatal(err)
	}
	send(ownerJWT, clone(), original, http.StatusForbidden)
	sendPhysical(ownerJWT, clone(), sample, http.StatusForbidden)
}
