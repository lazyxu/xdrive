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

func TestLocalPushOperationAbortObserveRealHTTPAndTwoPostgresPools(t *testing.T) {
	f := makeLocalOperationFixture(t)
	gin.SetMode(gin.TestMode)
	a := &Server{DB: f.primary, Auth: auth.New("private-operation-status-test", time.Hour)}
	b := &Server{DB: f.replica, Auth: a.Auth}
	routerA, routerB := a.Router(), b.Router()
	jwt, err := a.Auth.Issue(f.owner.ID, f.owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	foreign := meta.User{
		Username: "local-status-other-owner", PasswordHash: "test",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := f.primary.Create(&foreign).Error; err != nil {
		t.Fatal(err)
	}
	foreignJWT, err := a.Auth.Issue(foreign.ID, foreign.SessionVersion)
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
	copyHeaders := func() map[string]string {
		cp := make(map[string]string, len(headers))
		for k, v := range headers {
			cp[k] = v
		}
		return cp
	}
	otherToken := "second-valid-but-unbound-device-token"
	otherDevice := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: f.owner.ID, Name: "Same account, different desktop",
		Platform: "windows", CredentialHash: deviceCredentialDigest(otherToken),
		CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	if err := f.primary.Create(&otherDevice).Error; err != nil {
		t.Fatal(err)
	}
	var key [localPushOperationRequestKeySize]byte
	for i := range key {
		key[i] = 0x41
	}
	first, err := a.reserveBoundLocalPushOperationIntentWithKey(
		f.owningRequest(), f.source.ID, f.source.Revision, key[:])
	if err != nil {
		t.Fatal(err)
	}
	baseURL := fmt.Sprintf("/api/v1/sources/%d/local-operation/", f.source.ID)
	selector := func(id string, generation uint64) string {
		return fmt.Sprintf(`{"operation_id":%q,"generation":%d}`, id, generation)
	}
	post := func(router http.Handler, token, action, payload string, proof map[string]string, expected int) localPushOperationStatusResponse {
		t.Helper()
		resp := requestWithHeaders(t, router, http.MethodPost, baseURL+action,
			token, strings.NewReader(payload), expected, proof)
		body := resp.Body.String()
		for _, private := range []string{f.token, f.rootID, f.fingerprint, strings.Repeat("a", 64)} {
			if strings.Contains(body, private) {
				t.Fatal("private operation status exposed a device or Root secret")
			}
		}
		if resp.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatal("private operation response can be cached")
		}
		if expected != http.StatusOK {
			return localPushOperationStatusResponse{}
		}
		if resp.Header().Get("ETag") != headers["If-Match"] {
			t.Fatal("private status lacks the current Source revision ETag")
		}
		var got localPushOperationStatusResponse
		if err := json.Unmarshal(resp.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if got.SourceID != f.source.ID || got.Revision != f.source.Revision ||
			!validLocalPushPrepareOperationUUID(got.OperationID) ||
			got.Generation == 0 || got.CommitSupported || got.BackupComplete ||
			got.Authoritative || got.MissingInferenceSafe {
			t.Fatalf("unsafe private operation status: %+v", got)
		}
		return got
	}
	current := selector(first.ID, first.Generation)
	// Other owner, same-account foreign/forged device, missing Root and stale
	// revision must be denied by Router and the existing executor middleware.
	post(routerA, foreignJWT, "observe", current, copyHeaders(), http.StatusNotFound)
	otherProof := copyHeaders()
	otherProof["X-XDrive-Device-ID"] = otherDevice.ID
	otherProof["X-XDrive-Device-Token"] = otherToken
	post(routerA, jwt, "observe", current, otherProof, http.StatusForbidden)
	post(routerA, jwt, "observe", current, map[string]string{
		"If-Match": headers["If-Match"], "Content-Type": "application/json",
	}, http.StatusForbidden)
	for _, mutate := range []func(map[string]string){
		func(h map[string]string) { h["X-XDrive-Device-ID"] = uuid.NewString() },
		func(h map[string]string) { h["X-XDrive-Device-Token"] = "forged" },
		func(h map[string]string) { h["X-XDrive-Local-Root-ID"] = uuid.NewString() },
	} {
		bad := copyHeaders()
		mutate(bad)
		post(routerA, jwt, "abort", current, bad, http.StatusForbidden)
	}
	badRevision := copyHeaders()
	badRevision["If-Match"] = `"99"`
	post(routerA, jwt, "observe", current, badRevision, http.StatusConflict)
	noRevision := copyHeaders()
	delete(noRevision, "If-Match")
	post(routerA, jwt, "abort", current, noRevision, http.StatusPreconditionRequired)

	for _, malformed := range []string{
		"{}", "null", selector(uuid.NewString(), 0),
		selector("not-uuid", 1), current + "{}", strings.Repeat("z", localPushOperationStatusMaxBody+1),
		strings.Replace(current, "}", `,"unknown":true}`, 1),
	} {
		post(routerA, jwt, "abort", malformed, copyHeaders(), http.StatusBadRequest)
	}
	badContent := copyHeaders()
	badContent["Content-Type"] = "text/plain"
	post(routerA, jwt, "observe", current, badContent, http.StatusBadRequest)
	post(routerA, jwt, "observe?leaked=1", current, copyHeaders(), http.StatusBadRequest)

	observed := post(routerA, jwt, "observe", current, copyHeaders(), http.StatusOK)
	if observed.State != meta.LocalPushOperationIntentReserved ||
		observed.OperationID != first.ID || observed.Generation != first.Generation {
		t.Fatalf("current live operation was not observed: %+v", observed)
	}
	aborted := post(routerB, jwt, "abort", current, copyHeaders(), http.StatusOK)
	if aborted.State != meta.LocalPushOperationIntentAborted ||
		aborted.OperationID != first.ID {
		t.Fatalf("cross-pool abort did not save the exact generation: %+v", aborted)
	}
	replayedAbort := post(routerA, jwt, "abort", current, copyHeaders(), http.StatusOK)
	if replayedAbort != aborted {
		t.Fatalf("idempotent abort changed the reply: %+v %+v", aborted, replayedAbort)
	}
	afterAbort := post(routerB, jwt, "observe", current, copyHeaders(), http.StatusOK)
	if afterAbort.State != meta.LocalPushOperationIntentAborted {
		t.Fatalf("abort is not durably observable: %+v", afterAbort)
	}

	var key2 [localPushOperationRequestKeySize]byte
	for i := range key2 {
		key2[i] = 0x42
	}
	second, err := b.reserveBoundLocalPushOperationIntentWithKey(
		f.owningRequest(), f.source.ID, f.source.Revision, key2[:])
	if err != nil || second.Generation != first.Generation+1 {
		t.Fatalf("post-abort new generation unavailable: %+v %v", second, err)
	}
	post(routerA, jwt, "abort", current, copyHeaders(), http.StatusConflict)
	post(routerA, jwt, "observe", current, copyHeaders(), http.StatusConflict)
	next := selector(second.ID, second.Generation)
	if got := post(routerA, jwt, "observe", next, copyHeaders(), http.StatusOK); got.State != meta.LocalPushOperationIntentReserved {
		t.Fatalf("new generation not live: %+v", got)
	}

	// After device revocation even read-only status is forbidden.
	revokedAt := time.Now().UTC()
	if err := f.primary.Model(&meta.ClientDevice{}).Where("id = ?", f.device.ID).
		Update("revoked_at", revokedAt).Error; err != nil {
		t.Fatal(err)
	}
	post(routerA, jwt, "abort", next, copyHeaders(), http.StatusForbidden)
	post(routerB, jwt, "observe", next, copyHeaders(), http.StatusForbidden)
	if err := f.primary.Model(&meta.ClientDevice{}).Where("id = ?", f.device.ID).
		Update("revoked_at", nil).Error; err != nil {
		t.Fatal(err)
	}
	// PostgreSQL time, not the Client clock, determines expiry.
	expired := f.primary.Exec(
		"UPDATE xd_local_push_operation_intents SET issued_at = CURRENT_TIMESTAMP - INTERVAL '31 seconds', expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = ?",
		second.ID)
	if expired.Error != nil || expired.RowsAffected != 1 {
		t.Fatalf("could not expire correct operation: %+v", expired)
	}
	observed = post(routerB, jwt, "observe", next, copyHeaders(), http.StatusOK)
	if observed.State != localPushOperationIntentObservedExpired {
		t.Fatalf("expired latest operation not observable: %+v", observed)
	}
	post(routerB, jwt, "abort", next, copyHeaders(), http.StatusConflict)

	var count, nodes, items, runs int64
	if err := f.primary.Model(&meta.LocalPushOperationIntent{}).Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("operation status duplicated or lost admission: %d err=%v", count, err)
	}
	if err := f.primary.Model(&meta.Node{}).Count(&nodes).Error; err != nil || nodes != 1 {
		t.Fatalf("operation status wrote cloud Node: %d err=%v", nodes, err)
	}
	if err := f.primary.Model(&meta.SourceItem{}).Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("operation status wrote SourceItem: %d err=%v", items, err)
	}
	if err := f.primary.Model(&meta.SyncRun{}).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("operation status started SourceRun: %d err=%v", runs, err)
	}
}
