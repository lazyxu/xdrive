package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
)

func TestLocalPushFirstLeafHistoricalPhysicalClientRejectsUntrustedWire(t *testing.T) {
	stageID := uuid.NewString()
	proof := LocalBoundSourceProof{
		DeviceID: uuid.NewString(), DeviceToken: "private-owning-device-token",
		RootID: uuid.NewString(), RootFingerprint: strings.Repeat("a", 64),
	}
	var mode atomic.Value
	mode.Store("ok")
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodPost ||
			r.URL.Path != "/api/v1/sources/17/local-staging/"+stageID+"/physical-receipt" ||
			r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("If-Match") != "\"7\"" ||
			r.Header.Get("Content-Type") != "application/json" ||
			r.Header.Get("X-XDrive-Device-ID") != proof.DeviceID ||
			r.Header.Get("X-XDrive-Device-Token") != proof.DeviceToken ||
			r.Header.Get("X-XDrive-Local-Root-ID") != proof.RootID ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != proof.RootFingerprint ||
			strings.Contains(r.URL.String(), "photo.jpg") {
			t.Error("private physical recovery call lost device, Root or leaf-body privacy")
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		var body struct {
			RelativeLeaf string `json:"relative_leaf"`
		}
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&body); err != nil || body.RelativeLeaf != "photo.jpg" {
			t.Errorf("wrong private canonical recovery name: %+v %v", body, err)
		}
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("ETag", "\"7\"")
		w.Header().Set("Content-Type", "application/json")
		fields := map[string]any{
			"stage_id": stageID, "source_id": 17, "revision": 7,
			"node_id": 41, "source_item_id": 93,
			"state":        localPushPhysicalReceiptOnly,
			"cas_observed": true, "native_verified": false,
			"backup_complete": false, "commit_supported": false,
			"authoritative": false, "missing_inference_safe": false,
		}
		switch mode.Load().(string) {
		case "bad-cache":
			w.Header().Set("Cache-Control", "public")
		case "wrong-etag":
			w.Header().Set("ETag", "\"8\"")
		case "wrong-stage":
			fields["stage_id"] = uuid.NewString()
		case "wrong-source":
			fields["source_id"] = 19
		case "wrong-revision":
			fields["revision"] = 8
		case "wrong-state":
			fields["state"] = "backup_successful"
		case "missing-cas":
			delete(fields, "cas_observed")
		case "no-cas":
			fields["cas_observed"] = false
		case "native":
			fields["native_verified"] = true
		case "finished":
			fields["backup_complete"] = true
		case "commit":
			fields["commit_supported"] = true
		case "authority":
			fields["authoritative"] = true
		case "missing-inference":
			fields["missing_inference_safe"] = true
		case "unset-authority":
			delete(fields, "authoritative")
		case "zero-node":
			fields["node_id"] = 0
		case "wrong-item":
			fields["source_item_id"] = 0
		case "extra":
			fields["local_root"] = "/private/device/secret"
		}
		_ = json.NewEncoder(w).Encode(fields)
	}))
	defer server.Close()
	cli := New(server.URL, "owner")
	read := func() (LocalPushFirstLeafPhysicalReceipt, error) {
		return cli.ReadLocalPushFirstLeafPhysicalReceipt(
			context.Background(), 17, 7, proof, stageID, "photo.jpg",
		)
	}
	receipt, err := read()
	if err != nil || receipt.SourceID != 17 || receipt.Revision != 7 ||
		receipt.StageID != stageID || receipt.NodeID != 41 ||
		receipt.SourceItemID != 93 || !receipt.CASObserved ||
		receipt.NativeVerified || receipt.BackupComplete ||
		receipt.CommitSupported || receipt.Authoritative {
		t.Fatalf("strict owning-Agent physical receipt rejected: %+v %v", receipt, err)
	}
	raw, err := json.Marshal(receipt)
	if err != nil || string(raw) != "{}" {
		t.Fatalf("private recovery information escaped IPC JSON: %q %v", raw, err)
	}
	for _, bad := range []string{
		"bad-cache", "wrong-etag", "wrong-stage", "wrong-source",
		"wrong-revision", "wrong-state", "missing-cas", "no-cas",
		"native", "finished", "commit", "authority", "missing-inference",
		"unset-authority", "zero-node", "wrong-item", "extra",
	} {
		mode.Store(bad)
		if result, err := read(); err == nil || result.CASObserved {
			t.Fatalf("unsafe physical recovery %s accepted: %+v %v", bad, result, err)
		}
	}
	before := calls.Load()
	for _, candidate := range []struct {
		proof LocalBoundSourceProof
		stage string
		leaf  string
	}{
		{LocalBoundSourceProof{}, stageID, "photo.jpg"},
		{proof, "../../secret", "photo.jpg"},
		{proof, stageID, "../private.txt"},
		{proof, stageID, ""},
	} {
		if result, err := cli.ReadLocalPushFirstLeafPhysicalReceipt(
			context.Background(), 17, 7, candidate.proof, candidate.stage, candidate.leaf,
		); err == nil || result.CASObserved {
			t.Fatalf("invalid local preflight request accepted: %+v %v", result, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if result, err := cli.ReadLocalPushFirstLeafPhysicalReceipt(
		ctx, 17, 7, proof, stageID, "photo.jpg",
	); err == nil || result.CASObserved {
		t.Fatalf("canceled original request accepted: %+v %v", result, err)
	}
	if calls.Load() != before {
		t.Fatalf("invalid proof contacted Server: before=%d after=%d", before, calls.Load())
	}
}
