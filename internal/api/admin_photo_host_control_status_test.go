package api

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPhotoHostControlStatusRequiresFreshExactHostProof(t *testing.T) {
	dir := t.TempDir()
	s := &Server{HostControlDir: dir}
	now := time.Now().UTC()
	write := func(name string, payload []byte) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), payload, 0600); err != nil {
			t.Fatal(err)
		}
	}
	write("heartbeat", []byte("ok"))
	healthy := photoHostControlStatus{
		Supported: true, State: "success", Revision: 7,
		AppliedRevision: 7, Enabled: true, ProfileVerified: true,
		ObservedHostState: "healthy", RequestID: "0123456789abcdef01234567",
		UpdatedAt: now.Format(time.RFC3339),
	}
	set := func(status photoHostControlStatus) {
		t.Helper()
		data, err := json.Marshal(status)
		if err != nil {
			t.Fatal(err)
		}
		write(photoHostControlStatusName, data)
	}
	set(healthy)
	got, ok := s.readPhotoHostControlStatus()
	if !ok || got.AppliedRevision != 7 || !got.ProfileVerified {
		t.Fatalf("valid bounded fixed-host status lost: %+v %v", got, ok)
	}
	testFail := func(name string, mutate func(*photoHostControlStatus)) {
		t.Helper()
		copy := healthy
		mutate(&copy)
		set(copy)
		if actual, valid := s.readPhotoHostControlStatus(); valid {
			t.Fatalf("%s incorrectly trusted host proof: %+v", name, actual)
		}
	}
	testFail("unacknowledged revision", func(s *photoHostControlStatus) { s.AppliedRevision = 6 })
	testFail("host unhealthy", func(s *photoHostControlStatus) { s.ObservedHostState = "unhealthy" })
	testFail("profile mismatch", func(s *photoHostControlStatus) { s.ProfileVerified = false })
	testFail("unsupported legacy host", func(s *photoHostControlStatus) { s.Supported = false })
	testFail("bad request ID", func(s *photoHostControlStatus) { s.RequestID = "not-a-fixed-request" })
	testFail("missing fixed ID", func(s *photoHostControlStatus) { s.RequestID = "" })
	testFail("future revision", func(s *photoHostControlStatus) { s.Revision = 1 << 60 })
	testFail("clock too old", func(s *photoHostControlStatus) {
		s.UpdatedAt = now.Add(-time.Hour).Format(time.RFC3339)
	})
	testFail("clock future", func(s *photoHostControlStatus) {
		s.UpdatedAt = now.Add(time.Hour).Format(time.RFC3339)
	})
	set(healthy)
	if err := os.Chtimes(filepath.Join(dir, photoHostControlStatusName),
		now.Add(-time.Minute), now.Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, valid := s.readPhotoHostControlStatus(); valid {
		t.Fatal("stale status file verified")
	}
	set(healthy)
	if err := os.Remove(filepath.Join(dir, photoHostControlStatusName)); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "status.json")
	if err := os.WriteFile(outside, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, photoHostControlStatusName)); err != nil {
		t.Fatal(err)
	}
	if _, valid := s.readPhotoHostControlStatus(); valid {
		t.Fatal("symlink-backed host status verified")
	}
}

func TestPhotoHostControlStatusNoAvailableRunner(t *testing.T) {
	var s Server
	if status, ok := s.readPhotoHostControlStatus(); ok || status.Supported {
		t.Fatalf("missing Host Manager advertised control: %+v", status)
	}
}

func TestPhotoHostControlGenerationSealIsPrivateAndValidOnlyForSuccess(t *testing.T) {
	dir := t.TempDir()
	s := &Server{HostControlDir: dir}
	if err := os.WriteFile(filepath.Join(dir, "heartbeat"), []byte("trusted"), 0600); err != nil {
		t.Fatal(err)
	}
	control := photoHostControlStatus{
		Supported: true, State: "success", Revision: 7, AppliedRevision: 7,
		Enabled: true, ProfileVerified: true, ObservedHostState: "healthy",
		RequestID: "0123456789abcdef01234567",
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	base, err := json.Marshal(control)
	if err != nil {
		t.Fatal(err)
	}
	digest := strings.Repeat("a", 64)
	write := func(value string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, photoHostControlStatusName), []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write(string(base))
	old, ok := s.readPhotoHostControlStatus()
	if !ok || old.AppliedInstanceDigest != "" {
		t.Fatal("old Host Manager invented applied generation")
	}
	withDigest := strings.Replace(string(base),
		`"updated_at":`, `"applied_instance_digest":"`+digest+`","updated_at":`, 1)
	write(withDigest)
	current, ok := s.readPhotoHostControlStatus()
	if !ok || current.AppliedInstanceDigest != digest {
		t.Fatal("fresh exact host request generation was not retained")
	}
	serialized, err := json.Marshal(current)
	if err != nil || strings.Contains(string(serialized), digest) ||
		strings.Contains(string(serialized), "applied_instance_digest") {
		t.Fatal("private action-time model generation escaped through status JSON")
	}
	for _, tc := range []struct {
		name string
		body string
	}{
		{"malformed", strings.Replace(withDigest, digest, "bad", 1)},
		{"uppercase", strings.Replace(withDigest, digest, strings.ToUpper(digest), 1)},
		{"failed state", strings.Replace(withDigest, `"state":"success"`, `"state":"failed"`, 1)},
		{"wrong JSON type", strings.Replace(withDigest, `"applied_instance_digest":"`+digest+`"`, `"applied_instance_digest":true`, 1)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			write(tc.body)
			if _, valid := s.readPhotoHostControlStatus(); valid {
				t.Fatal("invalid or non-success generation receipt was trusted")
			}
		})
	}
}

func TestPhotoHostPrivateModelAckIsValidatedAndNeverSerialized(t *testing.T) {
	dir := t.TempDir()
	server := &Server{HostControlDir: dir}
	if err := os.WriteFile(filepath.Join(dir, "heartbeat"), []byte("alive"), 0600); err != nil {
		t.Fatal(err)
	}
	requestID := "0123456789abcdef01234567"
	digest := strings.Repeat("a", 64)
	base, err := json.Marshal(photoHostControlStatus{
		Supported: true, State: "success", Revision: 9, AppliedRevision: 9,
		Enabled: true, ProfileVerified: true, ObservedHostState: "healthy",
		RequestID: requestID, UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatal(err)
	}
	write := func(body string) (photoHostControlStatus, bool) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, photoHostControlStatusName), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		return server.readPhotoHostControlStatus()
	}
	withDigest := strings.Replace(string(base), `"updated_at":`,
		`"applied_instance_digest":"`+digest+`","updated_at":`, 1)
	legacy, ok := write(withDigest)
	if !ok || legacy.ModelAckAtApply {
		t.Fatal("old host invented model-side receipt")
	}
	ack := strings.Replace(withDigest, `"updated_at":`,
		`"model_ack_at_apply":true,"updated_at":`, 1)
	got, ok := write(ack)
	if !ok || !got.ModelAckAtApply || got.AppliedInstanceDigest != digest {
		t.Fatalf("fresh fixed host receipt lost: %+v valid=%v", got, ok)
	}
	public, err := json.Marshal(got)
	if err != nil || strings.Contains(string(public), digest) ||
		strings.Contains(string(public), "model_ack_at_apply") ||
		strings.Contains(string(public), "applied_instance_digest") {
		t.Fatal("private host model receipt leaked to public JSON")
	}
	for name, body := range map[string]string{
		"no sealed generation": strings.Replace(ack,
			`"applied_instance_digest":"`+digest+`",`, "", 1),
		"bad ack type": strings.Replace(ack, `"model_ack_at_apply":true`,
			`"model_ack_at_apply":"true"`, 1),
		"failed receipt": strings.Replace(ack,
			`"state":"success"`, `"state":"failed"`, 1),
		"unhealthy": strings.Replace(ack,
			`"observed_host_state":"healthy"`,
			`"observed_host_state":"unhealthy"`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			if _, valid := write(body); valid {
				t.Fatal("invalid private model acknowledgment was accepted")
			}
		})
	}
	without := strings.Replace(ack, `"model_ack_at_apply":true`,
		`"model_ack_at_apply":false`, 1)
	actual, valid := write(without)
	if !valid || actual.ModelAckAtApply {
		t.Fatal("negative model acknowledgment must remain negative")
	}
}
