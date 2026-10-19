package api

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

// A real authenticated Gin route invokes the operation-fenced physical
// CAS/SQL writer against a genuine prepared first file. No successful Run is
// manufactured: SourceItem remains PENDING after its canonical SQL COMMIT.
func TestLocalPushOperationFirstLeafRealHTTPCommitAndReplay(t *testing.T) {
	f, key, operation := makeLocalPushBoundFirstLeafFixture(t)
	gin.SetMode(gin.TestMode)
	f.server.Auth = auth.New("local-first-leaf-transport-test", time.Hour)
	var owner meta.User
	if err := f.server.DB.Where("id = ?", f.device.OwnerID).Take(&owner).Error; err != nil {
		t.Fatal(err)
	}
	jwt, err := f.server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	router := f.server.Router()
	url := fmt.Sprintf("/api/v1/sources/%d/local-staging/%s/operation-first-leaf-commit",
		f.source.ID, f.stage.StageID)
	headers := map[string]string{
		"If-Match":                        strconv.Quote(strconv.FormatUint(f.source.Revision, 10)),
		"Content-Type":                    "application/json",
		"X-XDrive-Device-ID":              f.device.ID,
		"X-XDrive-Device-Token":           f.ctx.Request.Header.Get("X-XDrive-Device-Token"),
		"X-XDrive-Local-Root-ID":          f.proof.RootID,
		"X-XDrive-Local-Root-Fingerprint": f.ctx.Request.Header.Get("X-XDrive-Local-Root-Fingerprint"),
	}
	copyHeaders := func() map[string]string {
		out := make(map[string]string, len(headers))
		for k, v := range headers {
			out[k] = v
		}
		return out
	}
	keyValue := base64.RawURLEncoding.EncodeToString(key)
	payload := fmt.Sprintf("{\"relative_leaf\":%q,\"request_key\":%q,\"operation_id\":%q,\"generation\":%d}",
		localPushFirstLeafFixtureName, keyValue, operation.ID, operation.Generation)
	post := func(body string, header map[string]string, want int) localPushFirstLeafOperationCommitResponse {
		t.Helper()
		rec := requestWithHeaders(t, router, http.MethodPost, url, jwt,
			strings.NewReader(body), want, header)
		if rec.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatal("first leaf commit response is cacheable")
		}
		for _, secret := range []string{headers["X-XDrive-Device-Token"],
			headers["X-XDrive-Local-Root-ID"], headers["X-XDrive-Local-Root-Fingerprint"], keyValue} {
			if secret != "" && strings.Contains(rec.Body.String(), secret) {
				t.Fatal("private first leaf leaked credentials or original key")
			}
		}
		if want != http.StatusCreated && want != http.StatusOK {
			return localPushFirstLeafOperationCommitResponse{}
		}
		if rec.Header().Get("ETag") != headers["If-Match"] {
			t.Fatal("first leaf reply does not match Source revision")
		}
		var got localPushFirstLeafOperationCommitResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if got.SourceID != f.source.ID || got.Revision != f.source.Revision ||
			got.StageID != f.stage.StageID || got.OperationID != operation.ID ||
			got.Generation != operation.Generation || got.NodeID == 0 ||
			got.SourceItemID == 0 || got.State != localPushFirstLeafPendingNative ||
			!got.SQLCommitted || !got.CASObserved || got.NativeVerified ||
			got.BackupComplete || got.Authoritative || got.MissingInferenceSafe ||
			got.RetirementSupported || got.Replayed != (want == http.StatusOK) {
			t.Fatalf("unverified first leaf accepted as complete: %+v", got)
		}
		return got
	}
	var beforeNodes, beforeItems, beforeRuns int64
	for _, v := range []struct {
		model any
		out   *int64
	}{{&meta.Node{}, &beforeNodes}, {&meta.SourceItem{}, &beforeItems}, {&meta.SyncRun{}, &beforeRuns}} {
		if err := f.server.DB.Model(v.model).Count(v.out).Error; err != nil {
			t.Fatal(err)
		}
	}
	noToken := copyHeaders()
	delete(noToken, "X-XDrive-Device-Token")
	post(payload, noToken, http.StatusForbidden)
	foreign := copyHeaders()
	foreign["X-XDrive-Device-ID"] = uuid.NewString()
	post(payload, foreign, http.StatusForbidden)
	wrongRevision := copyHeaders()
	wrongRevision["If-Match"] = "\"999\""
	post(payload, wrongRevision, http.StatusConflict)
	wrongRoot := copyHeaders()
	wrongRoot["X-XDrive-Local-Root-ID"] = uuid.NewString()
	post(payload, wrongRoot, http.StatusForbidden)
	for _, invalid := range []string{
		"{}", "null", payload + "{}", strings.Repeat("x", localPushFirstLeafOperationCommitMaxBody+1),
		strings.Replace(payload, "}", ",\"raw_os_path\":\"/secret\"}", 1),
		strings.Replace(payload, keyValue, "not-a-key", 1),
		strings.Replace(payload, localPushFirstLeafFixtureName, "../escape", 1),
	} {
		post(invalid, copyHeaders(), http.StatusBadRequest)
	}
	wrongKey := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x61}, 32))
	post(strings.Replace(payload, keyValue, wrongKey, 1), copyHeaders(), http.StatusConflict)
	post(strings.Replace(payload, operation.ID, uuid.NewString(), 1), copyHeaders(), http.StatusConflict)
	post(strings.Replace(payload, fmt.Sprintf("\"generation\":%d", operation.Generation),
		fmt.Sprintf("\"generation\":%d", operation.Generation+1), 1), copyHeaders(), http.StatusConflict)
	var beforeValidCount int64
	if err := f.server.DB.Model(&meta.SourceItem{}).Count(&beforeValidCount).Error; err != nil ||
		beforeValidCount != beforeItems {
		t.Fatalf("unauthorized first leaf modified SourceItem: %d %v", beforeValidCount, err)
	}
	first := post(payload, copyHeaders(), http.StatusCreated)
	replay := post(payload, copyHeaders(), http.StatusOK)
	if first.NodeID != replay.NodeID || first.SourceItemID != replay.SourceItemID ||
		!replay.Replayed {
		t.Fatalf("repeat created a second canonical file: %+v %+v", first, replay)
	}
	var outcome meta.LocalPushFirstLeafOperationCommit
	if err := f.server.DB.Where("operation_id = ?", operation.ID).Take(&outcome).Error; err != nil ||
		outcome.NodeID != first.NodeID || outcome.SourceItemID != first.SourceItemID {
		t.Fatalf("missing immutable first-leaf SQL COMMIT outcome: %+v %v", outcome, err)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", first.SourceItemID).Take(&item).Error; err != nil ||
		item.State != meta.SourceItemStatePending || item.LastSyncedAt != nil ||
		item.LastSyncedRunID != "" {
		t.Fatalf("first leaf incorrectly considered a finished backup: %+v %v", item, err)
	}
	var afterNodes, afterItems, afterRuns int64
	for _, v := range []struct {
		model any
		out   *int64
	}{{&meta.Node{}, &afterNodes}, {&meta.SourceItem{}, &afterItems}, {&meta.SyncRun{}, &afterRuns}} {
		if err := f.server.DB.Model(v.model).Count(v.out).Error; err != nil {
			t.Fatal(err)
		}
	}
	if afterNodes != beforeNodes+1 || afterItems != beforeItems+1 || afterRuns != beforeRuns {
		t.Fatalf("first leaf counts wrong: nodes=%d items=%d runs=%d", afterNodes, afterItems, afterRuns)
	}
	var blob meta.ContentBlob
	if err := f.server.DB.Where("sha256 = ?", f.stage.ContentSHA256).Take(&blob).Error; err != nil ||
		blob.State != meta.ContentBlobStateReady || blob.Size != int64(len(f.body)) {
		t.Fatalf("canonical physical CAS missing: %+v %v", blob, err)
	}
	reader, err := f.server.Store.Open(f.ctx.Request.Context(), blob.StorageKey)
	if err != nil {
		t.Fatal(err)
	}
	got, readErr := io.ReadAll(reader)
	closeErr := reader.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(got, f.body) {
		t.Fatalf("wrong physical canonical bytes: %v %v", readErr, closeErr)
	}
}

// Revocation after staging and operation binding must fence the physical
// writer. An owner session alone is never native/Root write authorization.
func TestLocalPushOperationFirstLeafHTTPRevocationCannotCommit(t *testing.T) {
	f, key, operation := makeLocalPushBoundFirstLeafFixture(t)
	f.server.Auth = auth.New("local-revoked-first-leaf-transport", time.Hour)
	var owner meta.User
	if err := f.server.DB.Where("id = ?", f.device.OwnerID).Take(&owner).Error; err != nil {
		t.Fatal(err)
	}
	jwt, err := f.server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := f.server.DB.Model(&meta.ClientDevice{}).Where("id = ?", f.device.ID).
		Update("revoked_at", &now).Error; err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf("{\"relative_leaf\":%q,\"request_key\":%q,\"operation_id\":%q,\"generation\":%d}",
		localPushFirstLeafFixtureName, base64.RawURLEncoding.EncodeToString(key),
		operation.ID, operation.Generation)
	headers := map[string]string{
		"If-Match":                        strconv.Quote(strconv.FormatUint(f.source.Revision, 10)),
		"Content-Type":                    "application/json",
		"X-XDrive-Device-ID":              f.device.ID,
		"X-XDrive-Device-Token":           f.ctx.Request.Header.Get("X-XDrive-Device-Token"),
		"X-XDrive-Local-Root-ID":          f.proof.RootID,
		"X-XDrive-Local-Root-Fingerprint": f.ctx.Request.Header.Get("X-XDrive-Local-Root-Fingerprint"),
	}
	url := fmt.Sprintf("/api/v1/sources/%d/local-staging/%s/operation-first-leaf-commit",
		f.source.ID, f.stage.StageID)
	requestWithHeaders(t, f.server.Router(), http.MethodPost, url, jwt,
		strings.NewReader(body), http.StatusForbidden, headers)
	var items, runs, outcomes int64
	for _, v := range []struct {
		model any
		out   *int64
	}{{&meta.SourceItem{}, &items}, {&meta.SyncRun{}, &runs},
		{&meta.LocalPushFirstLeafOperationCommit{}, &outcomes}} {
		if err := f.server.DB.Model(v.model).Count(v.out).Error; err != nil || *v.out != 0 {
			t.Fatalf("revoked device committed canonical SourceItem/Run: %d %v", *v.out, err)
		}
	}
}
