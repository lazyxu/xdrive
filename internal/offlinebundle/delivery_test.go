package offlinebundle

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSignedDeliveryBindsManifestELFAndPublisher(t *testing.T) {
	dir := t.TempDir()
	manifestRaw := []byte("test signed manifest bytes\n")
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), manifestRaw, 0o600); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(manifestRaw)
	manifestSHA := hex.EncodeToString(sum[:])
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	self, statErr := os.Stat(exe)
	selfSHA, hashErr := HashFile(exe)
	if statErr != nil || hashErr != nil {
		t.Fatalf("test executable: stat=%v hash=%v", statErr, hashErr)
	}
	commit := strings.Repeat("a", 40)
	desc := signedDelivery{
		Schema:       1,
		RepositoryID: 1382670236,
		Channel:      "master",
		Platform:     "linux/amd64",
		SourceCommit: commit,
		Sequence:     42,
		Manifest:     signedDeliveryFile{Name: "manifest.json", Size: int64(len(manifestRaw)), SHA256: manifestSHA},
		Installer:    signedDeliveryFile{Name: "xdrive-offline.py", Size: 7, SHA256: strings.Repeat("b", 64)},
		GoInstaller:  signedDeliveryFile{Name: "xdrive-offline-linux-amd64", Size: self.Size(), SHA256: selfSHA},
	}
	m := &Manifest{Schema: 2, Source: "github", Channel: "master", SourceCommit: commit}
	trustedDeliverySHA := ""
	write := func(v signedDelivery) {
		t.Helper()
		raw, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "delivery.json"), raw, 0o600); err != nil {
			t.Fatal(err)
		}
		h := sha256.Sum256(raw)
		trustedDeliverySHA = hex.EncodeToString(h[:])
	}
	assertRejected := func(label string) {
		t.Helper()
		if err := VerifySignedDelivery(dir, m, manifestSHA, selfSHA, trustedDeliverySHA); err == nil {
			t.Fatalf("accepted unsafe signed delivery: %s", label)
		}
	}
	write(desc)
	if err := VerifySignedDelivery(dir, m, manifestSHA, selfSHA, trustedDeliverySHA); err != nil {
		t.Fatal(err)
	}
	trustedGoodDeliverySHA := trustedDeliverySHA
	changed := desc
	changed.Sequence++
	write(changed)
	if err := VerifySignedDelivery(dir, m, manifestSHA, selfSHA, trustedGoodDeliverySHA); err == nil {
		t.Fatal("accepted a delivery changed after Host signed snapshot")
	}
	changed = desc
	changed.GoInstaller.SHA256 = strings.Repeat("0", 64)
	write(changed)
	assertRejected("Go ELF SHA")
	changed = desc
	changed.Manifest.Size++
	write(changed)
	assertRejected("Manifest size")
	changed = desc
	changed.RepositoryID = 999999
	write(changed)
	assertRejected("repo ID")
	changed = desc
	changed.SourceCommit = strings.Repeat("f", 40)
	write(changed)
	assertRejected("source commit")
	changed = desc
	changed.GoInstaller.Name = "unsafe-program"
	write(changed)
	assertRejected("alternate executable")
	write(desc)
	invalidJSON := []byte(`{"schema":1,"schema":1}`)
	if err := os.WriteFile(filepath.Join(dir, "delivery.json"), invalidJSON, 0o600); err != nil {
		t.Fatal(err)
	}
	badDigest := sha256.Sum256(invalidJSON)
	trustedDeliverySHA = hex.EncodeToString(badDigest[:])
	assertRejected("duplicate JSON attribute")
}
