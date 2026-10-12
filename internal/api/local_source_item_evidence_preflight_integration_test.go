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

func TestLocalEvidencePreflightRechecksCurrentSourceItemNodeAndAliases(t *testing.T) {
	db, server, owner, other, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{},
		&meta.SourceItemAlias{}, &meta.SyncRun{}, &meta.LocalSourceItemEvidence{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("owning-evidence-server-preflight", time.Hour)
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
	secretA := "native-owning-agent-A-preflight-private-secret-0001"
	secretB := "native-other-agent-B-preflight-private-secret-0002"
	deviceA := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "Owning A", Platform: "windows",
		CredentialHash: deviceCredentialDigest(secretA), CreatedAt: now, UpdatedAt: now,
	}
	deviceB := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "Other B", Platform: "linux",
		CredentialHash: deviceCredentialDigest(secretB), CreatedAt: now, UpdatedAt: now,
	}
	for _, device := range []meta.ClientDevice{deviceA, deviceB} {
		if err := db.Create(&device).Error; err != nil {
			t.Fatal(err)
		}
	}
	rootID, fingerprint := uuid.NewString(), strings.Repeat("a", 64)
	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "Cloud")
	source := meta.Source{
		OwnerID: owner.ID, Name: "Private backup", Kind: meta.SourceKindLocalFolder,
		Direction: meta.SourceDirectionPush, Status: meta.SourceStatusPaused,
		Revision: 7, SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeSync,
		TargetNodeID: &target.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.LocalSourceBinding{
		SourceID: source.ID, OwnerID: owner.ID, DeviceID: deviceA.ID,
		RootID: rootID, RootFingerprint: fingerprint, CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	pathKey := func(name string) string {
		sum := sha256.Sum256([]byte("xdrive-local-path-v1\x00" +
			rootID + "\x00file\x00" + name))
		return hex.EncodeToString(sum[:])
	}
	prev, current := strings.Repeat("1", 64), strings.Repeat("2", 64)
	var ids []uint64
	var items []meta.SourceItem
	var nodes []meta.Node
	var currentKeys []string
	for i := 0; i < 2; i++ {
		name := fmt.Sprintf("old/%d.jpg", i)
		newName := fmt.Sprintf("new/%d.jpg", i)
		node := createFilePropertiesFile(t, db, owner.ID, target.ID, fmt.Sprintf("cloud%d.jpg", i), 3)
		item := meta.SourceItem{
			SourceID: source.ID, ExternalID: pathKey(name), Path: name,
			Kind: meta.SourceItemKindFile, State: meta.SourceItemStateSynced,
			NodeID: &node.ID, NodeRevision: node.Revision, Size: 3, LastSeenAt: now,
		}
		if err := db.Create(&item).Error; err != nil {
			t.Fatal(err)
		}
		row := meta.LocalSourceItemEvidence{
			SourceID: source.ID, SourceRevision: 7, SourceItemID: item.ID,
			DeviceID: deviceA.ID, RootID: rootID, RootFingerprint: fingerprint,
			PreviousSnapshotSHA256: prev, CurrentSnapshotSHA256: current,
			PreviousPathKey: pathKey(name), CurrentPathKey: pathKey(newName),
			NativeIdentityKey: fmt.Sprintf("%064x", 300+i),
			CreatedAt:         now, UpdatedAt: now,
		}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
		ids = append(ids, row.ID)
		items = append(items, item)
		nodes = append(nodes, node)
		currentKeys = append(currentKeys, row.CurrentPathKey)
	}
	uri := fmt.Sprintf("/api/v1/sources/%d/local-identity/evidence-preflight", source.ID)
	proof := map[string]string{
		"If-Match":                        "\"7\"",
		"X-XDrive-Device-ID":              deviceA.ID,
		"X-XDrive-Device-Token":           secretA,
		"X-XDrive-Local-Root-ID":          rootID,
		"X-XDrive-Local-Root-Fingerprint": fingerprint,
	}
	clone := func() map[string]string {
		out := make(map[string]string, len(proof))
		for key, value := range proof {
			out[key] = value
		}
		return out
	}
	encode := func(before, after string, selected []uint64) string {
		t.Helper()
		bytes, err := json.Marshal(localEvidencePreflightRequest{
			PreviousSnapshotSHA256: before, CurrentSnapshotSHA256: after,
			EvidenceIDs: selected,
		})
		if err != nil {
			t.Fatal(err)
		}
		return string(bytes)
	}
	requestBody := encode(prev, current, ids)
	check := func(jwt string, headers map[string]string, body string, status int) {
		t.Helper()
		resp := requestWithHeaders(t, router, http.MethodPost, uri, jwt,
			strings.NewReader(body), status, headers)
		if status != http.StatusOK {
			if strings.Contains(resp.Body.String(), rootID) ||
				strings.Contains(resp.Body.String(), fingerprint) ||
				strings.Contains(resp.Body.String(), secretA) {
				t.Fatal("private evidence error leaked Root or credential")
			}
			return
		}
		if resp.Header().Get("Cache-Control") != "private, no-store" ||
			resp.Header().Get("ETag") != "\"7\"" {
			t.Fatalf("preflight missing revision or privacy fence: %v", resp.Header())
		}
		var got localEvidencePreflightResponse
		if err := json.Unmarshal(resp.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		var request localEvidencePreflightRequest
		if err := json.Unmarshal([]byte(body), &request); err != nil {
			t.Fatal(err)
		}
		if got.SourceID != source.ID || got.Revision != 7 ||
			got.Checked != len(request.EvidenceIDs) || !got.ServerConsistent ||
			got.ContentVerified || got.CommitSupported || got.Authoritative ||
			got.MissingInferenceSafe {
			t.Fatalf("preflight granted unsafe execution: %+v", got)
		}
	}
	check(ownerJWT, clone(), requestBody, http.StatusOK)
	check(otherJWT, clone(), requestBody, http.StatusNotFound)
	check(ownerJWT, map[string]string{"If-Match": "\"7\""}, requestBody, http.StatusForbidden)
	foreign := clone()
	foreign["X-XDrive-Device-ID"], foreign["X-XDrive-Device-Token"] = deviceB.ID, secretB
	check(ownerJWT, foreign, requestBody, http.StatusForbidden)
	invalidToken := clone()
	invalidToken["X-XDrive-Device-Token"] = secretB
	check(ownerJWT, invalidToken, requestBody, http.StatusForbidden)
	invalidRoot := clone()
	invalidRoot["X-XDrive-Local-Root-ID"] = uuid.NewString()
	check(ownerJWT, invalidRoot, requestBody, http.StatusForbidden)
	staleRevision := clone()
	staleRevision["If-Match"] = "\"6\""
	check(ownerJWT, staleRevision, requestBody, http.StatusConflict)
	for _, malformed := range []string{
		encode(prev, current, nil),
		encode(prev, prev, ids),
		encode(strings.Repeat("0", 64), current, ids),
		encode(prev, current, []uint64{ids[1], ids[0]}),
		encode(prev, current, []uint64{ids[0], ids[0]}),
		encode(prev, current, []uint64{ids[1] + 100}),
		requestBody + "{}",
		strings.Repeat(" ", 3<<10),
	} {
		want := http.StatusBadRequest
		if malformed == encode(prev, current, []uint64{ids[1] + 100}) {
			want = http.StatusConflict
		}
		check(ownerJWT, clone(), malformed, want)
	}
	check(ownerJWT, clone(), encode(prev, strings.Repeat("3", 64), ids), http.StatusConflict)
	check(ownerJWT, clone(), encode(prev, current, ids[:1]), http.StatusOK)

	// A changed Node revision must invalidate the old persisted evidence.
	if err := db.Model(&meta.Node{}).Where("id = ?", nodes[0].ID).
		Update("revision", nodes[0].Revision+1).Error; err != nil {
		t.Fatal(err)
	}
	check(ownerJWT, clone(), requestBody, http.StatusConflict)
	if err := db.Model(&meta.Node{}).Where("id = ?", nodes[0].ID).
		Update("revision", nodes[0].Revision).Error; err != nil {
		t.Fatal(err)
	}
	// A different SourceItem owning the proposed new key must fail closed.
	alias := meta.SourceItemAlias{
		SourceID: source.ID, SourceItemID: items[1].ID,
		AliasKind:       meta.SourceItemAliasKindExternalID,
		AliasExternalID: currentKeys[0], CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&alias).Error; err != nil {
		t.Fatal(err)
	}
	check(ownerJWT, clone(), requestBody, http.StatusConflict)
	if err := db.Delete(&alias).Error; err != nil {
		t.Fatal(err)
	}
	// A changed original path is not accepted as the original identity.
	if err := db.Model(&meta.SourceItem{}).Where("id = ?", items[0].ID).
		Update("path", "other/path.jpg").Error; err != nil {
		t.Fatal(err)
	}
	check(ownerJWT, clone(), requestBody, http.StatusConflict)
	if err := db.Model(&meta.SourceItem{}).Where("id = ?", items[0].ID).
		Update("path", items[0].Path).Error; err != nil {
		t.Fatal(err)
	}
	check(ownerJWT, clone(), requestBody, http.StatusOK)
	var runs, aliases int64
	if err := db.Model(&meta.SyncRun{}).Where("source_id = ?", source.ID).
		Count(&runs).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.SourceItemAlias{}).Where("source_id = ?", source.ID).
		Count(&aliases).Error; err != nil {
		t.Fatal(err)
	}
	if runs != 0 || aliases != 0 {
		t.Fatalf("read-only preflight mutated run or aliases: runs=%d aliases=%d", runs, aliases)
	}
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", deviceA.ID).
		Update("revoked_at", now).Error; err != nil {
		t.Fatal(err)
	}
	check(ownerJWT, clone(), requestBody, http.StatusForbidden)
}
