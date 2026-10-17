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

func TestLocalPushOperationPrepareRealHTTPPostgresTwoPoolReplayAndRevocation(t *testing.T) {
	f := makeLocalOperationFixture(t)
	gin.SetMode(gin.TestMode)
	a := &Server{DB: f.primary, Auth: auth.New("private-local-prepare-fixture", time.Hour)}
	b := &Server{DB: f.replica, Auth: a.Auth}
	routerA, routerB := a.Router(), b.Router()
	jwt, err := a.Auth.Issue(f.owner.ID, f.owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	foreign := meta.User{Username: "local-operation-foreign", PasswordHash: "test-only", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := f.primary.Create(&foreign).Error; err != nil {
		t.Fatal(err)
	}
	foreignJWT, err := a.Auth.Issue(foreign.ID, foreign.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	path := fmt.Sprintf("/api/v1/sources/%d/local-operation/prepare", f.source.ID)
	proof := map[string]string{
		"If-Match":                        strconv.Quote(strconv.FormatUint(f.source.Revision, 10)),
		"Content-Type":                    "application/json",
		"X-XDrive-Device-ID":              f.device.ID,
		"X-XDrive-Device-Token":           f.token,
		"X-XDrive-Local-Root-ID":          f.rootID,
		"X-XDrive-Local-Root-Fingerprint": f.fingerprint,
	}
	clone := func() map[string]string {
		h := make(map[string]string, len(proof))
		for k, v := range proof {
			h[k] = v
		}
		return h
	}
	key := bytes.Repeat([]byte{0x41}, localPushOperationRequestKeySize)
	nextKey := bytes.Repeat([]byte{0x42}, localPushOperationRequestKeySize)
	input := func(k []byte) string {
		return fmt.Sprintf("{\"request_key\":%q}", base64.RawURLEncoding.EncodeToString(k))
	}
	post := func(router http.Handler, jwt, route, body string, headers map[string]string, status int) localPushOperationPrepareResponse {
		t.Helper()
		rec := requestWithHeaders(t, router, http.MethodPost, route, jwt, strings.NewReader(body), status, headers)
		raw := rec.Body.String()
		for _, secret := range []string{f.token, f.rootID, f.fingerprint, base64.RawURLEncoding.EncodeToString(key)} {
			if strings.Contains(raw, secret) {
				t.Fatal("private operation response disclosed credential, Root or raw key")
			}
		}
		if status != http.StatusOK {
			return localPushOperationPrepareResponse{}
		}
		if rec.Header().Get("ETag") != proof["If-Match"] || rec.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatalf("private prepare returned cacheable or unversioned receipt: %v", rec.Header())
		}
		var got localPushOperationPrepareResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if got.SourceID != f.source.ID || got.Revision != f.source.Revision ||
			got.Generation == 0 || got.State != meta.LocalPushOperationIntentReserved ||
			got.OperationID == "" || got.CommitSupported || got.BackupComplete || got.Authoritative || got.MissingInferenceSafe {
			t.Fatalf("private prepare fabricated backup authority: %+v", got)
		}
		return got
	}
	// Authentication, ownership and strict JSON bounds must all deny BEFORE
	// recording even one private operation generation.
	post(routerA, jwt, path, input(key), map[string]string{"If-Match": proof["If-Match"], "Content-Type": "application/json"}, http.StatusForbidden)
	post(routerA, foreignJWT, path, input(key), clone(), http.StatusNotFound)
	wrong := clone()
	wrong["X-XDrive-Device-Token"] = "forged"
	post(routerA, jwt, path, input(key), wrong, http.StatusForbidden)
	wrong = clone()
	wrong["X-XDrive-Local-Root-ID"] = uuid.NewString()
	post(routerA, jwt, path, input(key), wrong, http.StatusForbidden)
	wrong = clone()
	delete(wrong, "If-Match")
	post(routerA, jwt, path, input(key), wrong, http.StatusPreconditionRequired)
	wrong = clone()
	wrong["If-Match"] = "\"6\""
	post(routerA, jwt, path, input(key), wrong, http.StatusConflict)
	wrong = clone()
	wrong["Content-Type"] = "text/plain"
	post(routerA, jwt, path, input(key), wrong, http.StatusBadRequest)
	for _, bad := range []string{
		"{}", "null", "{\"request_key\":\"\"}", "{\"request_key\":\"not-base64\"}",
		"{\"request_key\":\"" + base64.RawURLEncoding.EncodeToString(make([]byte, 32)) + "\"}",
		input(key) + "{}", strings.Replace(input(key), "}", ",\"unexpected\":true}", 1),
		strings.Repeat("x", localPushOperationPrepareMaxBody+5),
	} {
		post(routerA, jwt, path, bad, clone(), http.StatusBadRequest)
	}
	post(routerA, jwt, path+"?request_key=forbidden", input(key), clone(), http.StatusBadRequest)
	var initial int64
	if err := f.primary.Model(&meta.LocalPushOperationIntent{}).Count(&initial).Error; err != nil || initial != 0 {
		t.Fatalf("unauthorized input wrote reservation: %d err=%v", initial, err)
	}
	first := post(routerA, jwt, path, input(key), clone(), http.StatusOK)
	replay := post(routerB, jwt, path, input(key), clone(), http.StatusOK)
	if replay.OperationID != first.OperationID || replay.Generation != first.Generation {
		t.Fatalf("lost-response retry minted another reservation: %+v %+v", first, replay)
	}
	post(routerB, jwt, path, input(nextKey), clone(), http.StatusConflict)
	var row meta.LocalPushOperationIntent
	if err := f.replica.Where("id = ?", first.OperationID).Take(&row).Error; err != nil || row.RequestKeyDigest == nil ||
		row.State != meta.LocalPushOperationIntentReserved || row.Generation != 1 {
		t.Fatalf("private reservation missing current binding: %+v err=%v", row, err)
	}
	// A revoked owning device cannot even replay the already-issued UUID.
	revoked := time.Now().UTC()
	if err := f.primary.Model(&meta.ClientDevice{}).Where("id = ?", f.device.ID).
		Update("revoked_at", revoked).Error; err != nil {
		t.Fatal(err)
	}
	post(routerB, jwt, path, input(key), clone(), http.StatusForbidden)
	if err := f.primary.Model(&meta.ClientDevice{}).Where("id = ?", f.device.ID).
		Update("revoked_at", nil).Error; err != nil {
		t.Fatal(err)
	}
	// SQL clock, not request clock, expires an actual 30-second reservation.
	advanced := f.primary.Exec("UPDATE xd_local_push_operation_intents SET issued_at = CURRENT_TIMESTAMP - INTERVAL '31 seconds', expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = ?", first.OperationID)
	if advanced.Error != nil || advanced.RowsAffected != 1 {
		t.Fatalf("expire fixture failed: %+v", advanced)
	}
	post(routerA, jwt, path, input(key), clone(), http.StatusConflict)
	second := post(routerB, jwt, path, input(nextKey), clone(), http.StatusOK)
	if second.Generation != 2 || second.OperationID == first.OperationID {
		t.Fatalf("new key did not advance after expiry: %+v", second)
	}
	var opCount, nodeCount, itemCount, runCount int64
	if err := f.primary.Model(&meta.LocalPushOperationIntent{}).Count(&opCount).Error; err != nil || opCount != 2 {
		t.Fatalf("wrong generation count: %d %v", opCount, err)
	}
	if err := f.primary.Model(&meta.Node{}).Count(&nodeCount).Error; err != nil || nodeCount != 1 {
		t.Fatalf("prepare changed Nodes: %d %v", nodeCount, err)
	}
	if err := f.primary.Model(&meta.SourceItem{}).Count(&itemCount).Error; err != nil || itemCount != 0 {
		t.Fatalf("prepare wrote SourceItems: %d %v", itemCount, err)
	}
	if err := f.primary.Model(&meta.SyncRun{}).Count(&runCount).Error; err != nil || runCount != 0 {
		t.Fatalf("prepare invented a run: %d %v", runCount, err)
	}
}

func TestLocalPushOperationPrepareStrictCanonicalBase64Key(t *testing.T) {
	good := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x41}, 32))
	if got, ok := validLocalPushOperationPrepareKey(good); !ok || len(got) != 32 {
		t.Fatal("32 byte request key rejected")
	}
	for _, bad := range []string{"", good + "=", good + "-", strings.Repeat("A", 43), "not-a-key"} {
		if _, ok := validLocalPushOperationPrepareKey(bad); ok {
			t.Fatalf("malformed key accepted %q", bad)
		}
	}
}
