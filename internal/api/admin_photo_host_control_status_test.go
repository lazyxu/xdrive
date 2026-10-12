package api

import (
	"encoding/json"
	"os"
	"path/filepath"
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
