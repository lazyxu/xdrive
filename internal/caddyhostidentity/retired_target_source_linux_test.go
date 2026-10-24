//go:build linux

package caddyhostidentity

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func privateRetiredTestFixture(t *testing.T) (string, string, privateHostAuthoritySnapshot, string) {
	t.Helper()
	home := t.TempDir()
	control := filepath.Join(home, "control")
	if err := os.Mkdir(control, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(control, os.ModeSetgid|0770); err != nil {
		t.Fatal(err)
	}
	receiptDir := filepath.Join(control, "caddy-deploy-results")
	privateDir := filepath.Join(control, "caddy-retired-targets")
	for _, item := range []struct {
		path string
		perm os.FileMode
	}{{receiptDir, os.ModeSetgid | 0750}, {privateDir, 0700}} {
		if err := os.Mkdir(item.path, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(item.path, item.perm); err != nil {
			t.Fatal(err)
		}
	}
	requestID := strings.Repeat("1", 24)
	current := privateHostAuthoritySnapshot{domain: "new.example.test", lanIPv4: "192.168.2.4", envSHA: strings.Repeat("a", 64)}
	live := strings.Repeat("b", 64)
	proof := privateHostRetiredRecord{PreviousSHA: strings.Repeat("d", 64), Protocol: privateRetiredProofScope, RequestID: requestID, Domain: "former.example.test", LANIP: "192.168.2.5", TargetSHA: current.envSHA}
	serialize := func(dir, name string, value any, perm os.FileMode) []byte {
		t.Helper()
		body, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		body = append(body, '\n')
		if err := os.WriteFile(filepath.Join(dir, name), body, perm); err != nil {
			t.Fatal(err)
		}
		return body
	}
	raw := serialize(privateDir, requestID+".json", proof, 0600)
	h := sha256.Sum256(raw)
	receipt := privateHostAppliedTerminal{GenerationSHA: strings.Repeat("c", 64), ConfigSHA: live, Protocol: privateDeployProofScope, RequestID: requestID, RetiredSHA: hex.EncodeToString(h[:]), TargetSHA: current.envSHA, State: "deployed"}
	serialize(receiptDir, requestID+".json", receipt, 0640)
	return control, requestID, current, live
}

func TestPrivateHostRetiredSourceRequiresExactImmutableDeployedTerminal(t *testing.T) {
	dir, id, current, live := privateRetiredTestFixture(t)
	got, err := privateReadHostRetiredTargets(dir, id, current, strings.Repeat("c", 64), live, time.Now().UTC())
	if err != nil || got.domain != "former.example.test" || got.lanIPv4 != "192.168.2.5" {
		t.Fatalf("valid Host proof rejected %+v %v", got, err)
	}
	if got, err := privateReadHostRetiredTargets(dir, id, current, strings.Repeat("f", 64), live, time.Now().UTC()); err == nil || got.domain != "" {
		t.Fatal("same Caddy JSON from a different Docker generation admitted retired entry")
	}
	raw, _ := json.Marshal(got)
	if string(raw) != "{}" {
		t.Fatal("private proof leaked")
	}
	for _, tc := range []struct {
		name, request string
		cfg           privateHostAuthoritySnapshot
		live          string
	}{{"wrong request", strings.Repeat("2", 24), current, live}, {"uppercase request", strings.Repeat("A", 24), current, live}, {"wrong CAS", id, privateHostAuthoritySnapshot{envSHA: strings.Repeat("f", 64)}, live}, {"wrong live", id, current, strings.Repeat("f", 64)}} {
		t.Run(tc.name, func(t *testing.T) {
			proof, e := privateReadHostRetiredTargets(dir, tc.request, tc.cfg, strings.Repeat("c", 64), tc.live, time.Now())
			if e == nil || proof.domain != "" {
				t.Fatal("untrusted proof accepted")
			}
		})
	}
	if got, e := privateReadHostRetiredTargets(dir, id, current, strings.Repeat("c", 64), live, time.Now().Add(8*24*time.Hour)); e == nil || got.domain != "" {
		t.Fatal("stale terminal accepted")
	}
}

func TestPrivateHostRetiredSourceRejectsTamperedFilesAndSymlinks(t *testing.T) {
	dir, id, current, live := privateRetiredTestFixture(t)
	record := filepath.Join(dir, "caddy-retired-targets", id+".json")
	old, err := os.ReadFile(record)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(record, []byte(strings.Replace(string(old), "former.example.test", "attacker.example.test", 1)), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := privateReadHostRetiredTargets(dir, id, current, strings.Repeat("c", 64), live, time.Now()); err == nil {
		t.Fatal("tampered source accepted")
	}
	if err := os.WriteFile(record, old, 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "caddy-retired-targets", "alias")
	if err := os.Link(record, link); err != nil {
		t.Fatal(err)
	}
	if _, err := privateReadHostRetiredTargets(dir, id, current, strings.Repeat("c", 64), live, time.Now()); err == nil {
		t.Fatal("hardlink accepted")
	}
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(record, 0640); err != nil {
		t.Fatal(err)
	}
	if _, err := privateReadHostRetiredTargets(dir, id, current, strings.Repeat("c", 64), live, time.Now()); err == nil {
		t.Fatal("group-readable private source accepted")
	}
	if err := os.Chmod(record, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(record); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(dir, "caddy-deploy-results", id+".json"), record); err != nil {
		t.Fatal(err)
	}
	if _, err := privateReadHostRetiredTargets(dir, id, current, strings.Repeat("c", 64), live, time.Now()); err == nil {
		t.Fatal("symlink accepted")
	}
}

func TestPrivateHostRetiredSourceRejectsForgedReceiptAndDirectory(t *testing.T) {
	dir, id, current, live := privateRetiredTestFixture(t)
	path := filepath.Join(dir, "caddy-deploy-results", id+".json")
	orig, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	bad := strings.Replace(string(orig), `"deployed"`, `"failed"`, 1)
	if err := os.WriteFile(path, []byte(bad), 0640); err != nil {
		t.Fatal(err)
	}
	if _, err := privateReadHostRetiredTargets(dir, id, current, strings.Repeat("c", 64), live, time.Now()); err == nil {
		t.Fatal("failed terminal admitted")
	}
	if err := os.WriteFile(path, orig, 0640); err != nil {
		t.Fatal(err)
	}
	privateDir := filepath.Join(dir, "caddy-retired-targets")
	if err := os.Chmod(privateDir, 0770); err != nil {
		t.Fatal(err)
	}
	if _, err := privateReadHostRetiredTargets(dir, id, current, strings.Repeat("c", 64), live, time.Now()); err == nil {
		t.Fatal("writable directory accepted")
	}
}
