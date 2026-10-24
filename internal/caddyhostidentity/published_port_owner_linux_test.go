//go:build linux

package caddyhostidentity

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func publishedFixture(ip string) string {
	return strings.Repeat("a", 64) + `|123|true|healthy|{"80/tcp":[{"HostIp":"127.0.0.1","HostPort":"3000"}],"443/tcp":[{"HostIp":"` + ip + `","HostPort":"8443"}]}` + "\n"
}
func TestPublishedCaddyPortOnlyMaps8443To443(t *testing.T) {
	for _, tc := range []struct {
		name, raw string
		current   privateHostEnabledTargets
		ok        bool
	}{
		{"domain and LAN all IPv4", publishedFixture("0.0.0.0"), privateHostEnabledTargets{domain: "x.example.com", lanIPv4: "192.168.2.4"}, true},
		{"Caddy EXPOSE-only admin and QUIC", strings.Replace(publishedFixture("0.0.0.0"), `"443/tcp"`, `"2019/tcp":null,"443/udp":null,"443/tcp"`, 1), privateHostEnabledTargets{domain: "x.example.com"}, true},
		{"published Caddy admin must fail", strings.Replace(publishedFixture("0.0.0.0"), `"443/tcp"`, `"2019/tcp":[{"HostIp":"0.0.0.0","HostPort":"2019"}],"443/tcp"`, 1), privateHostEnabledTargets{domain: "x.example.com"}, false},
		{"published HTTPS UDP must fail", strings.Replace(publishedFixture("0.0.0.0"), `"443/tcp"`, `"443/udp":[{"HostIp":"0.0.0.0","HostPort":"8443"}],"443/tcp"`, 1), privateHostEnabledTargets{domain: "x.example.com"}, false},
		{"unknown exposed port must fail", strings.Replace(publishedFixture("0.0.0.0"), `"443/tcp"`, `"1234/tcp":null,"443/tcp"`, 1), privateHostEnabledTargets{domain: "x.example.com"}, false},
		{"optional dual stack Docker mapping", strings.Replace(publishedFixture("0.0.0.0"), `"HostPort":"8443"}]`, `"HostPort":"8443"},{"HostIp":"::","HostPort":"8443"}]`, 1), privateHostEnabledTargets{domain: "x.example.com", lanIPv4: "192.168.2.4"}, true},
		{"routed IPv6 does not replace v4", strings.Replace(publishedFixture("0.0.0.0"), `"HostPort":"8443"}]`, `"HostPort":"8443"},{"HostIp":"::","HostPort":""}]`, 1), privateHostEnabledTargets{domain: "x.example.com"}, true},
		{"IPv6 only no trusted v4 probe", strings.Replace(publishedFixture("0.0.0.0"), `{"HostIp":"0.0.0.0","HostPort":"8443"}`, `{"HostIp":"::","HostPort":"8443"}`, 1), privateHostEnabledTargets{domain: "x.example.com"}, false},
		{"private domain loopback", publishedFixture("127.0.0.1"), privateHostEnabledTargets{domain: "x.example.com"}, true},
		{"host current LAN address", publishedFixture("192.168.2.4"), privateHostEnabledTargets{lanIPv4: "192.168.2.4"}, true},
		{"host wrong LAN interface", publishedFixture("192.168.2.5"), privateHostEnabledTargets{lanIPv4: "192.168.2.4"}, false},
		{"loopback not reachable by LAN", publishedFixture("127.0.0.1"), privateHostEnabledTargets{lanIPv4: "192.168.2.4"}, false},
		{"mapped only to current LAN despite domain loopback probe", publishedFixture("192.168.2.4"), privateHostEnabledTargets{domain: "x.example.com", lanIPv4: "192.168.2.4"}, false},
		{"HTTPS wrong host port", strings.Replace(publishedFixture("0.0.0.0"), `"HostPort":"8443"`, `"HostPort":"8444"`, 1), privateHostEnabledTargets{domain: "x.example.com"}, false},
		{"HTTPS missing", strings.Replace(publishedFixture("0.0.0.0"), `"443/tcp"`, `"8443/tcp"`, 1), privateHostEnabledTargets{domain: "x.example.com"}, false},
		{"another externally published port", strings.Replace(publishedFixture("0.0.0.0"), `"443/tcp"`, `"9999/tcp"`, 1), privateHostEnabledTargets{domain: "x.example.com"}, false},
		{"no current enabled origin", publishedFixture("0.0.0.0"), privateHostEnabledTargets{}, false},
		{"failing docker health", strings.Replace(publishedFixture("0.0.0.0"), "|healthy|", "|unhealthy|", 1), privateHostEnabledTargets{domain: "x.example.com"}, false},
		{"not running", strings.Replace(publishedFixture("0.0.0.0"), "|true|", "|false|", 1), privateHostEnabledTargets{domain: "x.example.com"}, false},
		{"missing actual pid", strings.Replace(publishedFixture("0.0.0.0"), "|123|", "|0|", 1), privateHostEnabledTargets{domain: "x.example.com"}, false},
		{"uncanonical pid", strings.Replace(publishedFixture("0.0.0.0"), "|123|", "|0123|", 1), privateHostEnabledTargets{domain: "x.example.com"}, false},
		{"invalid Docker id", strings.Replace(publishedFixture("0.0.0.0"), strings.Repeat("a", 64), "not-sha", 1), privateHostEnabledTargets{domain: "x.example.com"}, false},
		{"duplicate 443 binding", strings.Replace(publishedFixture("0.0.0.0"), `"HostPort":"8443"}`, `"HostPort":"8443"},{"HostIp":"0.0.0.0","HostPort":"8443"}`, 1), privateHostEnabledTargets{domain: "x.example.com"}, false},
		{"extra 443 metadata", strings.Replace(publishedFixture("0.0.0.0"), `"HostPort":"8443"}`, `"HostPort":"8443","unexpected":"yes"}`, 1), privateHostEnabledTargets{domain: "x.example.com"}, false},
		{"null mapping", strings.Replace(publishedFixture("0.0.0.0"), `[{"HostIp":"0.0.0.0","HostPort":"8443"}]`, `null`, 1), privateHostEnabledTargets{domain: "x.example.com"}, false},
		{"newline injection", publishedFixture("0.0.0.0") + "fake\n", privateHostEnabledTargets{domain: "x.example.com"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := privateParseCaddyPublishedPorts([]byte(tc.raw), tc.current)
			if (err == nil) != tc.ok {
				t.Fatalf("wrong accept/reject: %v", err)
			}
		})
	}
}

func fakeProc(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	p := filepath.Join(root, "123")
	if err := os.MkdirAll(filepath.Join(p, "net"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(p, "fd"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(p, "comm"), []byte("caddy\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("/usr/bin/caddy", filepath.Join(p, "exe")); err != nil {
		t.Fatal(err)
	}
	line := "sl local_address remote_address st tx_queue tr tm->when retrnsmt uid timeout inode\n 0: 00000000:01BB 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 87654 1\n"
	if err := os.WriteFile(filepath.Join(p, "net", "tcp"), []byte(line), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(p, "net", "tcp6"), []byte("sl local_address remote_address st tx_queue tr tm->when retrnsmt uid timeout inode\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("socket:[87654]", filepath.Join(p, "fd", "5")); err != nil {
		t.Fatal(err)
	}
	return root
}
func TestHostCaddyProcessActuallyOwnsPort443Socket(t *testing.T) {
	root := fakeProc(t)
	inode, err := privateReadCaddyListenerInode(root, 123)
	if err != nil || inode != 87654 {
		t.Fatalf("genuine current Caddy socket rejected: %v inode=%d", err, inode)
	}
}
func TestHostCaddyProcessRejectsSpoofedOrUnownedListener(t *testing.T) {
	for _, tc := range []struct {
		name  string
		patch func(t *testing.T, root string)
	}{
		{"different executable", func(t *testing.T, root string) {
			p := filepath.Join(root, "123", "exe")
			os.Remove(p)
			os.Symlink("/usr/bin/other", p)
		}},
		{"different comm", func(t *testing.T, root string) {
			os.WriteFile(filepath.Join(root, "123", "comm"), []byte("docker-proxy\n"), 0600)
		}},
		{"listening socket not owned by Caddy", func(t *testing.T, root string) {
			p := filepath.Join(root, "123", "fd", "5")
			os.Remove(p)
			os.Symlink("socket:[10000]", p)
		}},
		{"wrong container port", func(t *testing.T, root string) {
			p := filepath.Join(root, "123", "net", "tcp")
			b, _ := os.ReadFile(p)
			os.WriteFile(p, []byte(strings.Replace(string(b), ":01BB", ":01BC", 1)), 0600)
		}},
		{"closed socket", func(t *testing.T, root string) {
			p := filepath.Join(root, "123", "net", "tcp")
			b, _ := os.ReadFile(p)
			os.WriteFile(p, []byte(strings.Replace(string(b), " 0A ", " 01 ", 1)), 0600)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := fakeProc(t)
			tc.patch(t, root)
			inode, err := privateReadCaddyListenerInode(root, 123)
			if err == nil || inode != 0 {
				t.Fatal("untrusted listener accepted")
			}
		})
	}
}
func TestPublishedOwnerWindowRejectsRaceOrMissingWitness(t *testing.T) {
	current := privateHostEnabledTargets{domain: "x.example.com"}
	good := privateIngressTransportCandidates{routeDigest: strings.Repeat("b", 64), runtime: boundPrivateCaddyRuntime{instanceSHA: strings.Repeat("c", 64)}}
	for _, tc := range []struct {
		name          string
		second        string
		observeErr    bool
		wrongInstance bool
		valid         bool
	}{
		{"unchanged Docker port + process socket", strings.Repeat("a", 64), false, false, true},
		{"Docker port or socket swapped after request", strings.Repeat("c", 64), false, false, false},
		{"missing second witness", "", false, false, false},
		{"underlying route observation failed", strings.Repeat("a", 64), true, false, false},
		{"different current Caddy instance", strings.Repeat("a", 64), false, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			read := func(context.Context, privateHostEnabledTargets) (privateCaddyPortOwnership, error) {
				calls++
				if calls == 1 {
					return privateCaddyPortOwnership{digest: strings.Repeat("a", 64), instanceSHA: strings.Repeat("c", 64)}, nil
				}
				return privateCaddyPortOwnership{digest: tc.second, instanceSHA: strings.Repeat("c", 64)}, nil
			}
			obs := func(context.Context) (privateIngressTransportCandidates, error) {
				if tc.observeErr {
					return privateIngressTransportCandidates{}, errors.New("probe failed")
				}
				if tc.wrongInstance {
					wrong := good
					wrong.runtime.instanceSHA = strings.Repeat("d", 64)
					return wrong, nil
				}
				return good, nil
			}
			got, err := privateObservePublishedOwnerWith(context.Background(), current, read, obs)
			if tc.valid {
				if err != nil || got.publishedOwnerDigest != strings.Repeat("a", 64) {
					t.Fatalf("valid witness rejected %v", err)
				}
			} else if err == nil || got != (privateIngressTransportCandidates{}) {
				t.Fatalf("unsafe witness admitted %v", err)
			}
		})
	}
}

// Docker's host-port publication enters the container's external interface.
// A 127.0.0.1-only socket in the container is not a witness for that path.
func TestCaddyListenerRequiresWildcardSocketForPublishedHTTPS(t *testing.T) {
	cases := []struct {
		name, v4, v6 string
		valid        bool
	}{
		{"IPv4 wildcard", "00000000", "", true},
		{"IPv4 loopback alone", "0100007F", "", false},
		{"IPv4 unicast alone", "0402A8C0", "", false},
		{"IPv6 wildcard", "", "00000000000000000000000000000000", true},
		{"IPv6 loopback alone", "", "00000000000000000000000001000000", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := fakeProc(t)
			name := filepath.Join(root, "123", "net", "tcp")
			data, err := os.ReadFile(name)
			if err != nil {
				t.Fatal(err)
			}
			if tc.v4 == "" {
				data = []byte("sl local_address remote_address st tx_queue tr tm->when retrnsmt uid timeout inode\n")
			} else {
				data = []byte(strings.Replace(string(data), "00000000:01BB", tc.v4+":01BB", 1))
			}
			if err := os.WriteFile(name, data, 0600); err != nil {
				t.Fatal(err)
			}
			name6 := filepath.Join(root, "123", "net", "tcp6")
			if tc.v6 != "" {
				v6data := "sl local_address remote_address st tx_queue tr tm->when retrnsmt uid timeout inode\n 0: " + tc.v6 + ":01BB 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 87654 1\n"
				if err := os.WriteFile(name6, []byte(v6data), 0600); err != nil {
					t.Fatal(err)
				}
			}
			inode, err := privateReadCaddyListenerInode(root, 123)
			if tc.valid {
				if err != nil || inode != 87654 {
					t.Fatalf("expected published wildcard Caddy ownership, got %d %v", inode, err)
				}
			} else if err == nil || inode != 0 {
				t.Fatalf("loopback/unicast listener was improperly accepted: %d %v", inode, err)
			}
		})
	}
}
