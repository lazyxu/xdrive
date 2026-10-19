package api

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
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

func TestLocalPushOperationBindRealHTTPExistingStagedByteScope(t *testing.T) {
	f, key, operation := makeLocalPushFencedFirstLeafFixture(t)
	if err := f.server.DB.AutoMigrate(&meta.LocalPushOperationStageBinding{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	authn := auth.New("private-local-operation-bind-test", time.Hour)
	server := &Server{DB: f.server.DB, Store: f.server.Store, Auth: authn}
	router := server.Router()
	var owner meta.User
	if err := f.server.DB.Where("id = ?", f.device.OwnerID).Take(&owner).Error; err != nil {
		t.Fatal(err)
	}
	jwt, err := authn.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	headers := map[string]string{
		"If-Match":                        strconv.Quote(strconv.FormatUint(f.source.Revision, 10)),
		"Content-Type":                    "application/json",
		"X-XDrive-Device-ID":              f.device.ID,
		"X-XDrive-Device-Token":           f.ctx.Request.Header.Get("X-XDrive-Device-Token"),
		"X-XDrive-Local-Root-ID":          f.proof.RootID,
		"X-XDrive-Local-Root-Fingerprint": f.ctx.Request.Header.Get("X-XDrive-Local-Root-Fingerprint"),
	}
	copyHeaders := func() map[string]string {
		cp := map[string]string{}
		for k, v := range headers {
			cp[k] = v
		}
		return cp
	}
	url := fmt.Sprintf("/api/v1/sources/%d/local-staging/%s/operation-bind", f.source.ID, f.stage.StageID)
	original := fmt.Sprintf(`{"request_key":%q,"operation_id":%q,"generation":%d}`,
		base64.RawURLEncoding.EncodeToString(key), operation.ID, operation.Generation)
	post := func(url, body string, proof map[string]string, want int) localPushOperationBindResponse {
		t.Helper()
		resp := requestWithHeaders(t, router, http.MethodPost, url, jwt,
			strings.NewReader(body), want, proof)
		if resp.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatal("operation bind response cacheable")
		}
		for _, secret := range []string{headers["X-XDrive-Device-Token"], f.proof.RootID, headers["X-XDrive-Local-Root-Fingerprint"], base64.RawURLEncoding.EncodeToString(key)} {
			if secret != "" && strings.Contains(resp.Body.String(), secret) {
				t.Fatal("operation bind leaked a private key or Root")
			}
		}
		if want != http.StatusOK {
			return localPushOperationBindResponse{}
		}
		if resp.Header().Get("ETag") != headers["If-Match"] {
			t.Fatal("missing revision ETag")
		}
		var got localPushOperationBindResponse
		if err := json.Unmarshal(resp.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if got.SourceID != f.source.ID || got.Revision != f.source.Revision ||
			got.StageID != f.stage.StageID || got.OperationID != operation.ID ||
			got.Generation != operation.Generation || got.State != "bound" ||
			got.CommitSupported || got.BackupComplete || got.Authoritative ||
			got.MissingInferenceSafe || got.RetirementSupported {
			t.Fatalf("unsafe private binding reply: %+v", got)
		}
		return got
	}
	var beforeNodes, beforeItems, beforeRuns int64
	if err := f.server.DB.Model(&meta.Node{}).Count(&beforeNodes).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Model(&meta.SourceItem{}).Count(&beforeItems).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).Count(&beforeRuns).Error; err != nil {
		t.Fatal(err)
	}

	missing := copyHeaders()
	delete(missing, "X-XDrive-Device-Token")
	post(url, original, missing, http.StatusForbidden)
	foreign := copyHeaders()
	foreign["X-XDrive-Device-ID"] = uuid.NewString()
	post(url, original, foreign, http.StatusForbidden)
	stale := copyHeaders()
	stale["If-Match"] = `"999"`
	post(url, original, stale, http.StatusConflict)
	noRevision := copyHeaders()
	delete(noRevision, "If-Match")
	post(url, original, noRevision, http.StatusPreconditionRequired)
	post(url+"?leak=1", original, copyHeaders(), http.StatusBadRequest)
	post(url, original, map[string]string{"Content-Type": "application/json"}, http.StatusForbidden)
	wrongMedia := copyHeaders()
	wrongMedia["Content-Type"] = "text/plain"
	post(url, original, wrongMedia, http.StatusBadRequest)
	for _, invalid := range []string{
		"{}", "null", original + "{}", strings.Repeat("x", localPushOperationBindMaxBody+10),
		strings.Replace(original, "}", `,"raw_os_path":"/private"}`, 1),
		strings.Replace(original, fmt.Sprintf(`"generation":%d`, operation.Generation), `"generation":0`, 1),
		strings.Replace(original, base64.RawURLEncoding.EncodeToString(key), "invalid", 1),
	} {
		post(url, invalid, copyHeaders(), http.StatusBadRequest)
	}

	post(url, strings.Replace(original, operation.ID, uuid.NewString(), 1), copyHeaders(), http.StatusConflict)
	// A syntactically valid but different original request key cannot bind.
	wrongKey := base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("z", 32)))
	post(url, strings.Replace(original, base64.RawURLEncoding.EncodeToString(key), wrongKey, 1), copyHeaders(), http.StatusConflict)
	post(url, strings.Replace(original, fmt.Sprintf(`"generation":%d`, operation.Generation), fmt.Sprintf(`"generation":%d`, operation.Generation+1), 1), copyHeaders(), http.StatusConflict)
	wrongRoot := copyHeaders()
	wrongRoot["X-XDrive-Local-Root-ID"] = uuid.NewString()
	post(url, original, wrongRoot, http.StatusForbidden)
	first := post(url, original, copyHeaders(), http.StatusOK)
	again := post(url, original, copyHeaders(), http.StatusOK)
	if first != again {
		t.Fatal("same-key binding replay changed response")
	}
	var bindings int64
	if err := f.server.DB.Model(&meta.LocalPushOperationStageBinding{}).Count(&bindings).Error; err != nil || bindings != 1 {
		t.Fatalf("stage/operation binding not immutable: %d %v", bindings, err)
	}
	var afterNodes, afterItems, afterRuns int64
	if err := f.server.DB.Model(&meta.Node{}).Count(&afterNodes).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Model(&meta.SourceItem{}).Count(&afterItems).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).Count(&afterRuns).Error; err != nil {
		t.Fatal(err)
	}
	if beforeNodes != afterNodes || beforeItems != afterItems || beforeRuns != afterRuns {
		t.Fatal("SQL-only operation binding published canonical files or SourceRun")
	}
	var stage meta.LocalPushStaging
	if err := f.server.DB.Where("stage_id = ?", f.stage.StageID).Take(&stage).Error; err != nil || stage.Status != localPushStageReady {
		t.Fatalf("operation binding activated stage: %+v %v", stage, err)
	}
}
