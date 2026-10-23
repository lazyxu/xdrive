package api

import (
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

// Exercise the real owning-Device middleware and exact route, not just a
// synthetic Gin context with localSourceExecutorContextKey set in tests.
func TestLocalPushCommonUploadHTTPRequiresOwningDeviceAndExactSource(t *testing.T) {
	f := makeLocalOperationFixture(t)
	if err := f.primary.AutoMigrate(
		&meta.LocalPushStaging{}, &meta.UploadSession{},
		&meta.LocalPushOperationTerminalReceipt{},
		&meta.LocalPushOperationStageBinding{},
		&meta.LocalPushFirstLeafOperationCommit{},
		&meta.LocalPushNativeTerminalChallenge{},
		&meta.LocalPushCASPrepareIntent{},
		&meta.LocalPushQuotaHold{},
		&meta.LocalPushCommonUploadOperation{},
	); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	srv := &Server{DB: f.primary, Auth: auth.New("lp-common-owner-http-test", time.Hour), MaxUploadBytes: 64 << 20}
	replica := &Server{DB: f.replica, Auth: srv.Auth, MaxUploadBytes: 64 << 20}
	routerA, routerB := srv.Router(), replica.Router()
	jwt, err := srv.Auth.Issue(f.owner.ID, f.owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	headers := map[string]string{
		"If-Match":                        strconv.Quote(strconv.FormatUint(f.source.Revision, 10)),
		"Content-Type":                    "application/json",
		"X-XDrive-Device-ID":              f.device.ID,
		"X-XDrive-Device-Token":           f.token,
		"X-XDrive-Local-Root-ID":          f.rootID,
		"X-XDrive-Local-Root-Fingerprint": f.fingerprint,
	}
	post := func(router http.Handler, route, input string, proof map[string]string, status int) string {
		t.Helper()
		resp := requestWithHeaders(t, router, http.MethodPost, route, jwt,
			strings.NewReader(input), status, proof)
		if resp.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatalf("private common file Operation was cacheable: %s", route)
		}
		if status == http.StatusOK && resp.Header().Get("ETag") != headers["If-Match"] {
			t.Fatal("common original Operation reply lacks Source revision ETag")
		}
		for _, secret := range []string{f.token, f.rootID, f.fingerprint} {
			if strings.Contains(resp.Body.String(), secret) {
				t.Fatal("private device/Root secret escaped the common Operation DTO")
			}
		}
		return resp.Body.String()
	}
	base := fmt.Sprintf("/api/v1/sources/%d/local-common-upload", f.source.ID)
	req := localPushCommonAdmitRequest{
		OperationID:   uuid.NewString(),
		ResumeKey:     "lp2_" + strings.Repeat("a", 64),
		ContentSHA256: strings.Repeat("b", 64),
		Size:          6,
		ParentID:      f.source.TargetNodeID,
		Name:          "new-first.txt",
	}
	body, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	withoutDevice := map[string]string{
		"If-Match": headers["If-Match"], "Content-Type": "application/json",
	}
	post(routerA, base+"/admit", string(body), withoutDevice, http.StatusForbidden)
	post(routerA, base+"/admit?untrusted=1", string(body), headers, http.StatusBadRequest)
	post(routerA, base+"/admit", string(body)+"{}", headers, http.StatusBadRequest)
	post(routerA, base+"/admit", `{"operation_id":"fake","resume_key":"lp2_"}`,
		headers, http.StatusConflict)
	for _, router := range []http.Handler{routerA, routerB} {
		res := post(router, base+"/admit", string(body), headers, http.StatusOK)
		var out localPushCommonOperationDTO
		if err := json.Unmarshal([]byte(res), &out); err != nil {
			t.Fatal(err)
		}
		if out.OperationID != req.OperationID || out.SourceID != f.source.ID ||
			out.Revision != f.source.Revision || out.State != meta.LocalPushCommonUploadReserved ||
			out.BackupComplete || out.RetirementSafe {
			t.Fatalf("duplicate request minted new file Operation: %+v", out)
		}
	}
	changed := req
	changed.ContentSHA256 = strings.Repeat("c", 64)
	modified, _ := json.Marshal(changed)
	post(routerA, base+"/admit", string(modified), headers, http.StatusConflict)

	sid := uuid.NewString()
	session := meta.UploadSession{
		ID: sid, OwnerID: f.owner.ID, ParentID: req.ParentID, Name: req.Name,
		ConflictPolicy: meta.UploadConflictPolicyFail,
		TotalSize:      req.Size, ChunkSize: 8 << 20, ChunkCount: 1,
		SHA256: req.ContentSHA256, ResumeKey: req.ResumeKey,
		Status: meta.UploadStatusActive, ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := f.primary.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	bind, err := json.Marshal(localPushCommonBindRequest{
		OperationID: req.OperationID, ResumeKey: req.ResumeKey, UploadSessionID: sid,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, router := range []http.Handler{routerA, routerB} {
		post(router, base+"/bind", string(bind), headers, http.StatusOK)
	}
	selector, _ := json.Marshal(localPushCommonReceiptSelector{
		OperationID: req.OperationID, ResumeKey: req.ResumeKey,
	})
	for _, router := range []http.Handler{routerA, routerB} {
		data := post(router, base+"/receipt", string(selector), headers, http.StatusOK)
		var got localPushCommonReceiptDTO
		if err := json.Unmarshal([]byte(data), &got); err != nil {
			t.Fatal(err)
		}
		if got.State != meta.LocalPushCommonUploadBound ||
			got.Committed || got.BackupComplete || got.RetirementSafe ||
			got.CurrentCASVerified || got.NodeID != 0 {
			t.Fatalf("unfinalized upload acknowledged as backup: %+v", got)
		}
	}
	// A revoked device is rejected by actual middleware even with a still
	// valid Owner JWT and the exact original Operation/Session identity.
	now := time.Now().UTC()
	if err := f.primary.Model(&meta.ClientDevice{}).Where("id = ?", f.device.ID).
		Update("revoked_at", &now).Error; err != nil {
		t.Fatal(err)
	}
	post(routerA, base+"/receipt", string(selector), headers, http.StatusForbidden)
	post(routerB, base+"/bind", string(bind), headers, http.StatusForbidden)
}
