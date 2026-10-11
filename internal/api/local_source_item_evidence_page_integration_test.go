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

func TestOwningLocalEvidencePageKeysetAndPermissionIsolation(t *testing.T) {
	db, s, owner, other, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{},
		&meta.SourceItemAlias{}, &meta.SyncRun{}, &meta.LocalSourceItemEvidence{}); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasIndex(&meta.LocalSourceItemEvidence{}, "idx_xd_local_ev_page") {
		t.Fatal("private advisory keyset index missing")
	}
	gin.SetMode(gin.TestMode)
	s.Auth = auth.New("private-advisory-page-test", time.Hour)
	s.RefreshTTL = 24 * time.Hour
	router := s.Router()
	ownerJWT, _ := s.Auth.Issue(owner.ID, owner.SessionVersion)
	otherJWT, _ := s.Auth.Issue(other.ID, other.SessionVersion)
	now := time.Now().UTC()
	tokenA := "private-owning-agent-credential-A-123456789"
	tokenB := "private-foreign-agent-credential-B-123456789"
	deviceA := meta.ClientDevice{ID: uuid.NewString(), OwnerID: owner.ID, Name: "Own A",
		Platform: "windows", CredentialHash: deviceCredentialDigest(tokenA),
		CreatedAt: now, UpdatedAt: now}
	deviceB := meta.ClientDevice{ID: uuid.NewString(), OwnerID: owner.ID, Name: "Other B",
		Platform: "linux", CredentialHash: deviceCredentialDigest(tokenB),
		CreatedAt: now, UpdatedAt: now}
	for _, d := range []meta.ClientDevice{deviceA, deviceB} {
		if err := db.Create(&d).Error; err != nil {
			t.Fatal(err)
		}
	}
	rootID, fingerprint := uuid.NewString(), strings.Repeat("f", 64)
	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "Private backups")
	source := meta.Source{OwnerID: owner.ID, Name: "Advisory only",
		Kind: meta.SourceKindLocalFolder, Direction: meta.SourceDirectionPush,
		Status: meta.SourceStatusPaused, Revision: 7,
		SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeSync,
		TargetNodeID: &target.ID}
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
	prev, current := strings.Repeat("1", 64), strings.Repeat("2", 64)
	var evidenceIDs []uint64
	for i := 0; i < 3; i++ {
		node := createFilePropertiesFile(t, db, owner.ID, target.ID, fmt.Sprintf("image%d.jpg", i), 3)
		item := meta.SourceItem{SourceID: source.ID,
			ExternalID: fmt.Sprintf("%064x", i+100), Path: fmt.Sprintf("image%d.jpg", i),
			Kind: meta.SourceItemKindFile, State: meta.SourceItemStateSynced,
			NodeID: &node.ID, NodeRevision: node.Revision, LastSeenAt: now}
		if err := db.Create(&item).Error; err != nil {
			t.Fatal(err)
		}
		row := meta.LocalSourceItemEvidence{
			SourceID: source.ID, SourceRevision: source.Revision, SourceItemID: item.ID,
			DeviceID: deviceA.ID, RootID: rootID, RootFingerprint: fingerprint,
			PreviousSnapshotSHA256: prev, CurrentSnapshotSHA256: current,
			PreviousPathKey:   fmt.Sprintf("%064x", i+200),
			CurrentPathKey:    fmt.Sprintf("%064x", i+300),
			NativeIdentityKey: fmt.Sprintf("%064x", i+400)}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
		evidenceIDs = append(evidenceIDs, row.ID)
	}
	uri := fmt.Sprintf("/api/v1/sources/%d/local-identity/evidence-page", source.ID)
	own := map[string]string{
		"If-Match": "\"7\"", "X-XDrive-Device-ID": deviceA.ID,
		"X-XDrive-Device-Token":           tokenA,
		"X-XDrive-Local-Root-ID":          rootID,
		"X-XDrive-Local-Root-Fingerprint": fingerprint,
	}
	clone := func() map[string]string {
		out := make(map[string]string, len(own))
		for k, v := range own {
			out[k] = v
		}
		return out
	}
	body := func(before, after string, limit int, id uint64) string {
		t.Helper()
		data, err := json.Marshal(localEvidencePageRequest{
			PreviousSnapshotSHA256: before, CurrentSnapshotSHA256: after,
			Limit: limit, AfterEvidenceID: id})
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	read := func(jwt string, headers map[string]string, input string, want int) localEvidencePageResponse {
		t.Helper()
		resp := requestWithHeaders(t, router, http.MethodPost, uri, jwt,
			strings.NewReader(input), want, headers)
		var out localEvidencePageResponse
		if want != http.StatusOK {
			return out
		}
		if resp.Header().Get("Cache-Control") != "private, no-store" ||
			resp.Header().Get("ETag") != "\"7\"" {
			t.Fatalf("advisory read missing cache or revision fence: %v", resp.Header())
		}
		for _, forbidden := range []string{"root_id", "fingerprint", "device_id",
			"device_token", "snapshot_sha256", "private backups", "image0.jpg"} {
			if strings.Contains(strings.ToLower(resp.Body.String()), forbidden) {
				t.Fatalf("read leaked private data %s", forbidden)
			}
		}
		if err := json.Unmarshal(resp.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		if out.SourceID != source.ID || out.Revision != 7 ||
			out.Authoritative || out.MissingInferenceSafe {
			t.Fatalf("unsafe advisory page: %+v", out)
		}
		return out
	}
	read(ownerJWT, map[string]string{"If-Match": "\"7\""},
		body(prev, current, 2, 0), http.StatusForbidden)
	read(otherJWT, clone(), body(prev, current, 2, 0), http.StatusNotFound)
	foreign := clone()
	foreign["X-XDrive-Device-ID"] = deviceB.ID
	foreign["X-XDrive-Device-Token"] = tokenB
	read(ownerJWT, foreign, body(prev, current, 2, 0), http.StatusForbidden)
	badRoot := clone()
	badRoot["X-XDrive-Local-Root-ID"] = uuid.NewString()
	read(ownerJWT, badRoot, body(prev, current, 2, 0), http.StatusForbidden)
	badToken := clone()
	badToken["X-XDrive-Device-Token"] = tokenB
	read(ownerJWT, badToken, body(prev, current, 2, 0), http.StatusForbidden)
	stale := clone()
	stale["If-Match"] = "\"6\""
	read(ownerJWT, stale, body(prev, current, 2, 0), http.StatusConflict)
	for _, bad := range []string{
		body(prev, current, 0, 0), body(prev, current, 65, 0),
		body(prev, prev, 1, 0), body(strings.Repeat("0", 64), current, 1, 0),
		body(prev, current, -1, 0), body(prev, current, 2, 0) + "{}",
		strings.TrimSuffix(body(prev, current, 2, 0), "}") + ",\"unknown\":true}",
		strings.Repeat(" ", 600),
	} {
		read(ownerJWT, clone(), bad, http.StatusBadRequest)
	}
	unrelated := read(ownerJWT, clone(), body(prev, strings.Repeat("3", 64), 2, 0), http.StatusOK)
	if unrelated.HasMore || unrelated.NextAfterID != 0 || len(unrelated.Items) != 0 {
		t.Fatalf("foreign generation returned advisory rows: %+v", unrelated)
	}
	first := read(ownerJWT, clone(), body(prev, current, 2, 0), http.StatusOK)
	if len(first.Items) != 2 || !first.HasMore || first.NextAfterID != evidenceIDs[1] ||
		first.Items[0].EvidenceID != evidenceIDs[0] ||
		first.Items[1].EvidenceID != evidenceIDs[1] {
		t.Fatalf("first keyset page invalid: %+v", first)
	}
	last := read(ownerJWT, clone(),
		body(prev, current, 2, first.NextAfterID), http.StatusOK)
	if len(last.Items) != 1 || last.HasMore ||
		last.NextAfterID != evidenceIDs[2] ||
		last.Items[0].EvidenceID != evidenceIDs[2] {
		t.Fatalf("second keyset page invalid: %+v", last)
	}
	end := read(ownerJWT, clone(),
		body(prev, current, 2, last.NextAfterID), http.StatusOK)
	if end.HasMore || end.NextAfterID != 0 || len(end.Items) != 0 {
		t.Fatalf("exhausted keyset returned evidence: %+v", end)
	}
	var count int64
	if err := db.Model(&meta.LocalSourceItemEvidence{}).Where("source_id = ?", source.ID).
		Count(&count).Error; err != nil || count != 3 {
		t.Fatalf("page changed evidence: count=%d err=%v", count, err)
	}
	var runs int64
	if err := db.Model(&meta.SyncRun{}).Where("source_id = ?", source.ID).
		Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("page started a run: count=%d err=%v", runs, err)
	}
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", deviceA.ID).
		Update("revoked_at", now).Error; err != nil {
		t.Fatal(err)
	}
	read(ownerJWT, clone(), body(prev, current, 2, 0), http.StatusForbidden)
}
