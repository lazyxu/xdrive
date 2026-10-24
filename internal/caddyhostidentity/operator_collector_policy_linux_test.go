//go:build linux

package caddyhostidentity

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
)

func testOperatorPolicyRaw(collectorUID, serverUID string, pin string) []byte {
	return []byte(privateOperatorPolicyDomain + "\ncollector_uid=" + collectorUID +
		"\nserver_uid=" + serverUID + "\npublic_spki_sha256=" + pin + "\n")
}

func TestOperatorPolicyCanonicalParsing(t *testing.T) {
	pin := strings.Repeat("a", 64)
	raw := testOperatorPolicyRaw("1002", "1001", pin)
	ok, err := privateParseOperatorCollectorPolicy(raw)
	if err != nil || ok.collectorUID != 1002 || ok.serverUID != 1001 || ok.publicDERPin != pin {
		t.Fatal("valid immutable operator policy refused")
	}
	j, err := json.Marshal(ok)
	if err != nil || string(j) != "{}" {
		t.Fatal("operator policy fields leaked into a public JSON representation")
	}
	for _, tc := range []struct {
		name string
		raw  []byte
	}{
		{"missing terminal newline", raw[:len(raw)-1]},
		{"missing domain", []byte(strings.Replace(string(raw), privateOperatorPolicyDomain, "host.env", 1))},
		{"duplicate key", append(append([]byte{}, raw...), []byte("collector_uid=1002\n")...)},
		{"uppercase pin", testOperatorPolicyRaw("1002", "1001", strings.Repeat("A", 64))},
		{"zero pin", testOperatorPolicyRaw("1002", "1001", strings.Repeat("0", 64))},
		{"missing pin", testOperatorPolicyRaw("1002", "1001", "")},
		{"root collector", testOperatorPolicyRaw("0", "1001", pin)},
		{"shared uid", testOperatorPolicyRaw("1001", "1001", pin)},
		{"noncanonical uid", testOperatorPolicyRaw("01002", "1001", pin)},
		{"signed uid", testOperatorPolicyRaw("+1002", "1001", pin)},
		{"invalid uid", testOperatorPolicyRaw("abc", "1001", pin)},
		{"overlong uid", testOperatorPolicyRaw("4294967296", "1001", pin)},
		{"CRLF", []byte(strings.ReplaceAll(string(raw), "\n", "\r\n"))},
		{"leading space", append([]byte(" "), raw...)},
		{"oversize", []byte(strings.Repeat("a", privateOperatorPolicyMaxBytes+1))},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if p, err := privateParseOperatorCollectorPolicy(tc.raw); err == nil || p != (privateOperatorCollectorPolicy{}) {
				t.Fatal("untrusted operator policy admitted")
			}
		})
	}
}

func operatorPolicyFixture(t *testing.T) (string, []string, string, uint32) {
	t.Helper()
	anchor := t.TempDir()
	directory := filepath.Join(anchor, "collector")
	if err := os.Mkdir(directory, 0700); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(directory, privateOperatorPolicyFile)
	uid := uint32(os.Geteuid())
	collector := strconv.FormatUint(uint64(uid)+1, 10)
	server := strconv.FormatUint(uint64(uid)+2, 10)
	if err := os.WriteFile(target, testOperatorPolicyRaw(collector, server, strings.Repeat("b", 64)), 0644); err != nil {
		t.Fatal(err)
	}
	return anchor, []string{"collector", privateOperatorPolicyFile}, target, uid
}

func TestOperatorPolicyFixedOwnerAndNoFollow(t *testing.T) {
	anchor, parts, _, uid := operatorPolicyFixture(t)
	raw, err := privateReadOperatorPolicyFrom(anchor, parts, uid)
	if err != nil {
		t.Fatalf("trusted operator fixture refused: %v", err)
	}
	if _, err := privateParseOperatorCollectorPolicy(raw); err != nil {
		t.Fatal("read policy rejected")
	}
	cases := []struct {
		name   string
		mutate func(t *testing.T, anchor, target string)
	}{
		{"group-writable policy", func(t *testing.T, _, f string) {
			if e := os.Chmod(f, 0664); e != nil {
				t.Fatal(e)
			}
		}},
		{"private-unreadable policy", func(t *testing.T, _, f string) {
			if e := os.Chmod(f, 0600); e != nil {
				t.Fatal(e)
			}
		}},
		{"group-writable parent", func(t *testing.T, a, _ string) {
			if e := os.Chmod(filepath.Join(a, "collector"), 0770); e != nil {
				t.Fatal(e)
			}
		}},
		{"symlink policy", func(t *testing.T, _, f string) {
			if e := os.Rename(f, f+".old"); e != nil {
				t.Fatal(e)
			}
			if e := os.Symlink(f+".old", f); e != nil {
				t.Fatal(e)
			}
		}},
		{"hardlinked policy", func(t *testing.T, _, f string) {
			if e := os.Link(f, f+".link"); e != nil {
				t.Fatal(e)
			}
		}},
		{"fifo policy", func(t *testing.T, _, f string) {
			if e := os.Remove(f); e != nil {
				t.Fatal(e)
			}
			if e := syscall.Mkfifo(f, 0644); e != nil {
				t.Fatal(e)
			}
		}},
		{"swapped ancestor symlink", func(t *testing.T, a, _ string) {
			dir := filepath.Join(a, "collector")
			if e := os.Rename(dir, dir+".old"); e != nil {
				t.Fatal(e)
			}
			if e := os.Symlink(dir+".old", dir); e != nil {
				t.Fatal(e)
			}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			anchor, parts, target, uid := operatorPolicyFixture(t)
			tc.mutate(t, anchor, target)
			if raw, err := privateReadOperatorPolicyFrom(anchor, parts, uid); err == nil || raw != nil {
				t.Fatal("untrusted policy filesystem admitted")
			}
		})
	}
}

func TestOperatorPolicyRejectsUntrustedSelectors(t *testing.T) {
	anchor, _, _, uid := operatorPolicyFixture(t)
	for _, components := range [][]string{
		nil, {""}, {"."}, {".."}, {"collector/other"}, {"collector\\other"},
		{"collector", "..", privateOperatorPolicyFile},
		{"collector", "missing"},
	} {
		if raw, err := privateReadOperatorPolicyFrom(anchor, components, uid); err == nil || raw != nil {
			t.Fatal("invalid path component admitted")
		}
	}
	if raw, err := privateReadOperatorPolicyFrom("relative", []string{"collector"}, uid); err == nil || raw != nil {
		t.Fatal("relative policy anchor admitted")
	}
	if raw, err := privateReadOperatorPolicyFrom(anchor, []string{"collector", privateOperatorPolicyFile}, uid+1); err == nil || raw != nil {
		t.Fatal("foreign-owned policy admitted")
	}
	if privateOperatorKeyDirectory != "/var/lib/xdrive-caddy-collector" ||
		len(privateOperatorPolicyComponents) != 4 ||
		privateOperatorPolicyComponents[0] != "etc" {
		t.Fatal("production bootstrap paths must remain pinned in the source")
	}
}
