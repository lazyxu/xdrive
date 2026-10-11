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

func TestOwningLocalIdentityLookupIsBoundedReadOnlyAndRevocationFenced(t *testing.T) {
	db, srv, owner, other, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.LocalSourceBinding{}, &meta.SourceItemAlias{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	srv.Auth = auth.New("own-local-identity-lookup-test", time.Hour)
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
	secretA := "long-private-device-A-identity-lookup-token-0001"
	secretB := "long-private-device-B-identity-lookup-token-0002"
	deviceA := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "Laptop A", Platform: "windows",
		CredentialHash: deviceCredentialDigest(secretA), CreatedAt: now, UpdatedAt: now,
	}
	deviceB := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "Laptop B", Platform: "linux",
		CredentialHash: deviceCredentialDigest(secretB), CreatedAt: now, UpdatedAt: now,
	}
	for _, device := range []meta.ClientDevice{deviceA, deviceB} {
		if err := db.Create(&device).Error; err != nil {
			t.Fatal(err)
		}
	}
	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "Safe target")
	source := meta.Source{
		OwnerID: owner.ID, Name: "Own local source", Kind: meta.SourceKindLocalFolder,
		Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusPaused,
		Revision: 7, TargetNodeID: &target.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	rootID := uuid.NewString()
	fingerprint := strings.Repeat("a", 64)
	if err := db.Create(&meta.LocalSourceBinding{
		SourceID: source.ID, OwnerID: owner.ID, DeviceID: deviceA.ID,
		RootID: rootID, RootFingerprint: fingerprint, CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	otherSource := meta.Source{
		OwnerID: owner.ID, Name: "Other own source", Kind: meta.SourceKindLocalFolder,
		Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
		Status: meta.SourceStatusPaused, Revision: 1,
	}
	if err := db.Create(&otherSource).Error; err != nil {
		t.Fatal(err)
	}
	makeItem := func(src uint64, identity, path string) meta.SourceItem {
		t.Helper()
		item := meta.SourceItem{
			SourceID: src, ExternalID: identity, Kind: meta.SourceItemKindFile,
			Path: path, State: meta.SourceItemStateSynced, LastSeenAt: now,
		}
		if err := db.Create(&item).Error; err != nil {
			t.Fatal(err)
		}
		return item
	}
	itemOne := makeItem(source.ID, "native-key-A", "private/windows/Camera Roll.jpg")
	itemTwo := makeItem(source.ID, "native-key-B", "private/windows/Docs.txt")
	_ = makeItem(otherSource.ID, "other-source-key", "private/other/source.txt")
	if err := db.Create(&meta.SourceItemAlias{
		SourceID: source.ID, SourceItemID: itemOne.ID, AliasExternalID: "previous-A",
		AliasKind: meta.SourceItemAliasKindExternalID, CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	uri := fmt.Sprintf("/api/v1/sources/%d/local-identity/lookup", source.ID)
	proof := map[string]string{
		"If-Match":                        "\"7\"",
		"X-XDrive-Device-ID":              deviceA.ID,
		"X-XDrive-Device-Token":           secretA,
		"X-XDrive-Local-Root-ID":          rootID,
		"X-XDrive-Local-Root-Fingerprint": fingerprint,
	}
	copyProof := func() map[string]string {
		copy := make(map[string]string, len(proof))
		for k, v := range proof {
			copy[k] = v
		}
		return copy
	}
	payload := `{"identities":["native-key-A","previous-A","not-yet-known","native-key-B","other-source-key"]}`
	bad := func(label string, jwt string, headers map[string]string, body string, status int) {
		t.Helper()
		t.Run(label, func(t *testing.T) {
			requestWithHeaders(t, router, http.MethodPost, uri, jwt, strings.NewReader(body), status, headers)
		})
	}
	bad("missing device proof", ownerJWT, map[string]string{"If-Match": "\"7\""}, payload, http.StatusForbidden)
	bad("other owner", otherJWT, copyProof(), payload, http.StatusNotFound)
	bHeaders := copyProof()
	bHeaders["X-XDrive-Device-ID"] = deviceB.ID
	bHeaders["X-XDrive-Device-Token"] = secretB
	bad("same owner foreign Desktop", ownerJWT, bHeaders, payload, http.StatusForbidden)
	for _, change := range []struct {
		label  string
		header string
		value  string
	}{
		{"forged device token", "X-XDrive-Device-Token", secretB},
		{"forged device ID", "X-XDrive-Device-ID", deviceB.ID},
		{"wrong Root ID", "X-XDrive-Local-Root-ID", uuid.NewString()},
		{"wrong Root fingerprint", "X-XDrive-Local-Root-Fingerprint", strings.Repeat("b", 64)},
	} {
		headers := copyProof()
		headers[change.header] = change.value
		bad(change.label, ownerJWT, headers, payload, http.StatusForbidden)
	}
	bad("stale expected revision", ownerJWT, func() map[string]string {
		h := copyProof()
		h["If-Match"] = "\"6\""
		return h
	}(), payload, http.StatusConflict)
	bad("no If-Match", ownerJWT, func() map[string]string {
		h := copyProof()
		delete(h, "If-Match")
		return h
	}(), payload, http.StatusPreconditionRequired)
	for _, value := range []string{
		`{"identities":[]}`,
		`{"identities":["native-key-A","native-key-A"]}`,
		`{"identities":[" leading"]}`,
		`{"identities":["x\nbad"]}`,
		`{"identities":["native-key-A"],"unknown":true}`,
		`{"identities":["native-key-A"]}{"identities":["native-key-B"]}`,
		`{"identities":` + func() string {
			list := make([]string, 129)
			for i := range list {
				list[i] = fmt.Sprintf("unique-%d", i)
			}
			body, _ := json.Marshal(list)
			return string(body)
		}() + `}`,
		`{"identities":["` + strings.Repeat("x", 513) + `"]}`,
	} {
		bad("invalid identity request "+fmt.Sprintf("%d", len(value)), ownerJWT, copyProof(), value, http.StatusBadRequest)
	}
	valid := requestWithHeaders(t, router, http.MethodPost, uri, ownerJWT,
		strings.NewReader(payload), http.StatusOK, copyProof())
	if valid.Header().Get("Cache-Control") != "private, no-store" ||
		valid.Header().Get("ETag") != "\"7\"" {
		t.Fatalf("read-only identity response is cacheable or revisionless: %+v", valid.Header())
	}
	var got localIdentityLookupResponse
	if err := json.Unmarshal(valid.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.SourceID != source.ID || got.Revision != 7 || got.InputCount != 5 ||
		got.Authoritative || got.MissingInferenceSafe || len(got.Matches) != 3 ||
		got.Matches[0] != (localIdentityLookupMatch{Index: 0, SourceItemID: itemOne.ID}) ||
		got.Matches[1] != (localIdentityLookupMatch{Index: 1, SourceItemID: itemOne.ID}) ||
		got.Matches[2] != (localIdentityLookupMatch{Index: 3, SourceItemID: itemTwo.ID}) {
		t.Fatalf("incorrect scoped SourceItem/alias lookup: %+v", got)
	}
	for _, text := range []string{"private/", "root_id", "fingerprint", "device_token", "last_error",
		"node_id", "external_id", "native-key-A", "previous-A", "mirror_missing"} {
		if strings.Contains(valid.Body.String(), text) {
			t.Fatalf("identity lookup leaked private metadata %q", text)
		}
	}
	// Repeated reads cannot create aliases, SourceRuns, or advance a Source revision.
	requestWithHeaders(t, router, http.MethodPost, uri, ownerJWT,
		strings.NewReader(payload), http.StatusOK, copyProof())
	var reread meta.Source
	if err := db.First(&reread, source.ID).Error; err != nil || reread.Revision != 7 ||
		reread.Status != meta.SourceStatusPaused {
		t.Fatalf("lookup mutated Source: %+v err=%v", reread, err)
	}
	var runs, aliases int64
	if err := db.Model(&meta.SyncRun{}).Where("source_id = ?", source.ID).Count(&runs).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.SourceItemAlias{}).Where("source_id = ?", source.ID).Count(&aliases).Error; err != nil {
		t.Fatal(err)
	}
	if runs != 0 || aliases != 1 {
		t.Fatalf("read-only lookup created runs or aliases: runs=%d aliases=%d", runs, aliases)
	}
	// Collisions between canonical identity and an alias of a DIFFERENT
	// SourceItem must be denied without picking one arbitrarily.
	conflict := makeItem(source.ID, "collision", "private/collision.bin")
	_ = conflict
	if err := db.Create(&meta.SourceItemAlias{
		SourceID: source.ID, SourceItemID: itemTwo.ID, AliasExternalID: "collision",
		AliasKind: meta.SourceItemAliasKindExternalID, CreatedAt: now, UpdatedAt: now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	bad("canonical versus other-item alias conflict", ownerJWT, copyProof(),
		`{"identities":["collision"]}`, http.StatusConflict)
	// Revocation invalidates the credential used by previous successful reads.
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", deviceA.ID).
		Update("revoked_at", now).Error; err != nil {
		t.Fatal(err)
	}
	bad("revoked device", ownerJWT, copyProof(), payload, http.StatusForbidden)
}
