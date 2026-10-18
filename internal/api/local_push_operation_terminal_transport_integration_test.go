package api

import (
	"bytes"
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

func TestLocalPushTerminalProofRealHTTPPostgresAndOwningDevice(t *testing.T) {
	f := makeLocalOperationFixture(t)
	gin.SetMode(gin.TestMode)
	a := &Server{DB: f.primary, Auth: auth.New("terminal-proof-owner-test", time.Hour)}
	b := &Server{DB: f.replica, Auth: a.Auth}
	routerA, routerB := a.Router(), b.Router()
	jwt, err := a.Auth.Issue(f.owner.ID, f.owner.SessionVersion)
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
	clone := func() map[string]string {
		other := make(map[string]string, len(headers))
		for k, v := range headers {
			other[k] = v
		}
		return other
	}
	key := bytes.Repeat([]byte{0x41}, localPushOperationRequestKeySize)
	operation, err := a.reserveBoundLocalPushOperationIntentWithKey(
		f.owningRequest(), f.source.ID, f.source.Revision, key)
	if err != nil {
		t.Fatal(err)
	}
	path := fmt.Sprintf("/api/v1/sources/%d/local-operation/terminal-proof", f.source.ID)
	body := func(k []byte, id string, generation uint64) string {
		return fmt.Sprintf(
			`{"request_key":%q,"operation_id":%q,"generation":%d}`,
			base64.RawURLEncoding.EncodeToString(k), id, generation)
	}
	selector := body(key, operation.ID, operation.Generation)
	post := func(router http.Handler, token, route, input string,
		proof map[string]string, status int,
	) localPushTerminalProofResponse {
		t.Helper()
		resp := requestWithHeaders(t, router, http.MethodPost, route, token,
			strings.NewReader(input), status, proof)
		if resp.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatal("terminal proof could be cached")
		}
		for _, secret := range []string{f.token, f.rootID, f.fingerprint, base64.RawURLEncoding.EncodeToString(key)} {
			if strings.Contains(resp.Body.String(), secret) {
				t.Fatal("private native key or device/Root leaked in response")
			}
		}
		if status != http.StatusOK {
			return localPushTerminalProofResponse{}
		}
		if resp.Header().Get("ETag") != headers["If-Match"] {
			t.Fatal("terminal proof missing Source revision")
		}
		var got localPushTerminalProofResponse
		if err := json.Unmarshal(resp.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if got.SourceID != f.source.ID || got.Revision != f.source.Revision ||
			got.OperationID != operation.ID || got.Generation != operation.Generation ||
			got.RecordedAt.IsZero() || got.RecordedAt.Location() != time.UTC ||
			got.CommitSupported || got.BackupComplete || got.Authoritative ||
			got.MissingInferenceSafe || got.RetirementSupported {
			t.Fatalf("terminal proof invented physical authority: %+v", got)
		}
		return got
	}
	// Neither owner JWT alone nor unbound same-account device can reach this
	// endpoint. Wrong revision and forged request key are not substitutes.
	post(routerA, jwt, path, selector, map[string]string{
		"If-Match": headers["If-Match"], "Content-Type": "application/json",
	}, http.StatusForbidden)
	otherToken := "other-native-device-token"
	otherDevice := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: f.owner.ID,
		Name: "Same account, foreign Desktop", Platform: "windows",
		CredentialHash: deviceCredentialDigest(otherToken),
		CreatedAt:      time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	if err := f.primary.Create(&otherDevice).Error; err != nil {
		t.Fatal(err)
	}
	foreignProof := clone()
	foreignProof["X-XDrive-Device-ID"] = otherDevice.ID
	foreignProof["X-XDrive-Device-Token"] = otherToken
	post(routerA, jwt, path, selector, foreignProof, http.StatusForbidden)
	post(routerA, jwt, path, selector, clone(), http.StatusConflict) // live lease
	if err := a.abortBoundLocalPushOperationIntent(
		f.owningRequest(), f.source.ID, f.source.Revision, operation.ID, operation.Generation); err != nil {
		t.Fatal(err)
	}
	for _, malformed := range []string{
		"{}", selector + "{}", "null",
		body(make([]byte, 32), operation.ID, operation.Generation),
		body(key, "not-uuid", operation.Generation),
		body(key, operation.ID, 0),
		strings.Replace(selector, "}", `,"extra":true}`, 1),
		strings.Repeat("z", localPushTerminalProofMaxBody+1),
	} {
		post(routerA, jwt, path, malformed, clone(), http.StatusBadRequest)
	}
	post(routerA, jwt, path+"?key=not-allowed", selector, clone(), http.StatusBadRequest)
	badRevision := clone()
	badRevision["If-Match"] = `"99"`
	post(routerA, jwt, path, selector, badRevision, http.StatusConflict)
	post(routerA, jwt, path, body(bytes.Repeat([]byte{0x42}, 32),
		operation.ID, operation.Generation), clone(), http.StatusConflict)
	got := post(routerA, jwt, path, selector, clone(), http.StatusOK)
	if got.State != meta.LocalPushTerminalReservationAborted {
		t.Fatalf("wrong reservation terminal state: %+v", got)
	}
	if replay := post(routerB, jwt, path, selector, clone(), http.StatusOK); replay != got {
		t.Fatalf("cross-Server replay changed immutable terminal proof: %+v %+v", got, replay)
	}
	var count, runs, items int64
	if err := f.primary.Model(&meta.LocalPushOperationTerminalReceipt{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("no exact one durable terminal receipt: %d %v", count, err)
	}
	if err := f.primary.Model(&meta.SyncRun{}).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("terminal route started SourceRun: %d %v", runs, err)
	}
	if err := f.primary.Model(&meta.SourceItem{}).Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("terminal route wrote SourceItem: %d %v", items, err)
	}
	revoked := time.Now().UTC()
	if err := f.primary.Model(&meta.ClientDevice{}).Where("id = ?", f.device.ID).
		Update("revoked_at", &revoked).Error; err != nil {
		t.Fatal(err)
	}
	post(routerA, jwt, path, selector, clone(), http.StatusForbidden)
}
