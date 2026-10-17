package api

import "testing"

func TestCaddyHTTPSDomainValidation(t *testing.T) {
	for _, s := range []string{"photos.example.com", "nas.example.org", "x-drive.example.net", "my-photos.xdrive.example.com", "PHOTOS.EXAMPLE.COM"} {
		if !validCaddyHTTPSDomain(s) {
			t.Errorf("rejected valid HTTPS hostname %q", s)
		}
	}
	for _, s := range []string{"", "localhost", "foo", "x.c", "127.0.0.1", "photos.example.123", "-x.example.com", "x-.example.com", "*.example.com", "photos.example.com:8443", "https://example.com", "photos.example.com/path", "a b.example.com", "a_example.com", "example.com.", " example.com", "example.com ", "中文.example.com", "a" + "a" /* invalid single label */, stringsRepeatA(64) + ".example.com"} {
		if validCaddyHTTPSDomain(s) {
			t.Errorf("accepted invalid HTTPS hostname %q", s)
		}
	}
}

func stringsRepeatA(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = 'a'
	}
	return string(b)
}

func TestCaddyPrivateLANIPAndDualEntryIntent(t *testing.T) {
	for _, valid := range []string{"192.168.2.4", "10.0.0.1", "172.16.0.1", "172.31.255.254"} {
		if !validCaddyLANIP(valid) {
			t.Fatalf("rejected valid private IPv4 %s", valid)
		}
	}
	for _, bad := range []string{"", "8.8.8.8", "127.0.0.1", "169.254.1.1",
		"172.15.0.1", "172.32.1.1", "192.168.02.4", "192.168.2.256",
		"192.168.2.4:8443", "::ffff:192.168.2.4", "192.168.2.4/24"} {
		if validCaddyLANIP(bad) {
			t.Fatalf("accepted unsafe LAN IP %s", bad)
		}
	}
	if validCaddyIngressSelection(false, "", false, "") {
		t.Fatal("accepted both HTTPS entries disabled")
	}
	if !validCaddyIngressSelection(false, "", true, "192.168.2.4") {
		t.Fatal("rejected LAN-only HTTPS")
	}
	if !validCaddyIngressSelection(true, "drive.example.com", false, "") {
		t.Fatal("rejected domain-only HTTPS")
	}
	if !validCaddyIngressSelection(true, "drive.example.com", true, "192.168.2.4") {
		t.Fatal("rejected dual-entry HTTPS")
	}
	if validCaddyIngressSelection(false, "", true, "127.0.0.1") {
		t.Fatal("accepted loopback pretending to be LAN")
	}
}
