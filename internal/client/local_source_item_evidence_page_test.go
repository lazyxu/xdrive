package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestPrivateEvidencePageTransportAndFailClosedValidation(t *testing.T) {
	before, after := strings.Repeat("1", 64), strings.Repeat("2", 64)
	row := LocalSourceItemEvidencePageItem{
		EvidenceID: 9, SourceItemID: 51,
		PreviousPathKey:   strings.Repeat("3", 64),
		CurrentPathKey:    strings.Repeat("4", 64),
		NativeIdentityKey: strings.Repeat("5", 64),
	}
	good := LocalSourceItemEvidencePage{
		SourceID: 42, Revision: 7,
		Items:   []LocalSourceItemEvidencePageItem{row},
		HasMore: false, NextAfterID: 9,
		Authoritative: false, MissingInferenceSafe: false,
	}
	var response atomic.Value
	encoded, err := json.Marshal(good)
	if err != nil {
		t.Fatal(err)
	}
	response.Store(string(encoded))
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodPost ||
			r.URL.Path != "/api/v1/sources/42/local-identity/evidence-page" ||
			r.URL.RawQuery != "" ||
			r.Header.Get("Authorization") != "Bearer owner" ||
			r.Header.Get("X-XDrive-Device-ID") != "device-A" ||
			r.Header.Get("X-XDrive-Device-Token") != "OS-secret" ||
			r.Header.Get("X-XDrive-Local-Root-ID") != "root-A" ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != "root-fingerprint" ||
			r.Header.Get("If-Match") != "\"7\"" {
			t.Errorf("private evidence request lacks exact scoped proof: %s %s", r.Method, r.URL)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil ||
			body["previous_snapshot_sha256"] != before ||
			body["current_snapshot_sha256"] != after ||
			body["limit"] != float64(2) || body["after_evidence_id"] != float64(5) {
			t.Errorf("invalid advisory pagination body: %+v err=%v", body, err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(response.Load().(string)))
	}))
	defer server.Close()

	cli := New(server.URL, "owner")
	proof := LocalBoundSourceProof{
		DeviceID: "device-A", DeviceToken: "OS-secret",
		RootID: "root-A", RootFingerprint: "root-fingerprint",
	}
	call := func() (LocalSourceItemEvidencePage, error) {
		return cli.ReadLocalSourceItemEvidencePage(
			context.Background(), 42, 7, proof, before, after, 2, 5)
	}
	for _, invalid := range []struct {
		source, revision uint64
		proof            LocalBoundSourceProof
		before, after    string
		limit            int
	}{
		{0, 7, proof, before, after, 2},
		{42, 0, proof, before, after, 2},
		{42, 7, LocalBoundSourceProof{}, before, after, 2},
		{42, 7, proof, before, before, 2},
		{42, 7, proof, strings.Repeat("0", 64), after, 2},
		{42, 7, proof, before, strings.Repeat("A", 64), 2},
		{42, 7, proof, before, after, 0},
		{42, 7, proof, before, after, 65},
	} {
		_, err := cli.ReadLocalSourceItemEvidencePage(
			context.Background(), invalid.source, invalid.revision,
			invalid.proof, invalid.before, invalid.after, invalid.limit, 5)
		if err == nil {
			t.Fatalf("unsafe request accepted: %+v", invalid)
		}
	}
	if calls.Load() != 0 {
		t.Fatalf("invalid inputs reached Server: %d", calls.Load())
	}
	got, err := call()
	if err != nil || got.SourceID != 42 || got.NextAfterID != 9 ||
		len(got.Items) != 1 || got.Items[0].SourceItemID != 51 ||
		got.Authoritative || got.MissingInferenceSafe || calls.Load() != 1 {
		t.Fatalf("valid bounded page rejected: %+v %v", got, err)
	}
	invalidPages := []LocalSourceItemEvidencePage{
		func() LocalSourceItemEvidencePage { x := good; x.SourceID = 41; return x }(),
		func() LocalSourceItemEvidencePage { x := good; x.Revision = 8; return x }(),
		func() LocalSourceItemEvidencePage { x := good; x.Authoritative = true; return x }(),
		func() LocalSourceItemEvidencePage { x := good; x.MissingInferenceSafe = true; return x }(),
		func() LocalSourceItemEvidencePage { x := good; x.HasMore = true; return x }(),
		func() LocalSourceItemEvidencePage { x := good; x.NextAfterID = 8; return x }(),
		func() LocalSourceItemEvidencePage { x := good; x.NextAfterID = 0; return x }(),
		func() LocalSourceItemEvidencePage { x := good; x.Items = []LocalSourceItemEvidencePageItem{}; return x }(),
		func() LocalSourceItemEvidencePage {
			x := good
			x.Items = []LocalSourceItemEvidencePageItem{row, row}
			return x
		}(),
		func() LocalSourceItemEvidencePage {
			x := good
			invalid := row
			invalid.CurrentPathKey = invalid.PreviousPathKey
			x.Items = []LocalSourceItemEvidencePageItem{invalid}
			return x
		}(),
		func() LocalSourceItemEvidencePage {
			x := good
			invalid := row
			invalid.NativeIdentityKey = "private-local-path"
			x.Items = []LocalSourceItemEvidencePageItem{invalid}
			return x
		}(),
	}
	for _, page := range invalidPages {
		data, err := json.Marshal(page)
		if err != nil {
			t.Fatal(err)
		}
		response.Store(string(data))
		if _, err := call(); err == nil {
			t.Fatalf("unsafe Server advisory page accepted: %+v", page)
		}
	}
	for _, raw := range []string{
		string(encoded) + "{}",
		strings.TrimSuffix(string(encoded), "}") + ",\"root_id\":\"secret\"}",
		strings.Repeat("x", (64<<10)+10),
		"{}",
		"null",
	} {
		response.Store(raw)
		if _, err := call(); err == nil {
			t.Fatalf("malformed or oversized advisory payload accepted: %s", raw[:min(len(raw), 64)])
		}
	}
	response.Store("{\"source_id\":42,\"revision\":7,\"items\":[],\"has_more\":false,\"next_after_id\":0,\"authoritative\":false,\"missing_inference_safe\":false}")
	got, err = call()
	if err != nil || len(got.Items) != 0 || got.HasMore {
		t.Fatalf("empty advisory page should be safe: %+v %v", got, err)
	}
}
