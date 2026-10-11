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
