package main

import "testing"

func TestValidateXDHTTPSLoginOrigin(t *testing.T) {
	for _, tc := range []struct {
		in, want string
		valid    bool
	}{
		{"https://drive.example.com:8443", "https://drive.example.com:8443", true},
		{"https://192.168.2.4:8443/", "https://192.168.2.4:8443", true},
		{"https://drive.example.com", "https://drive.example.com", true},
		{"", "", false},
		{"http://localhost:8080", "", false},
		{"http://192.168.2.4:8443", "", false},
		{"https://alice:secret@drive.example.com", "", false},
		{"https://drive.example.com/api/v1", "", false},
		{"https://drive.example.com?token=xyz", "", false},
		{"https://drive.example.com/#fragment", "", false},
		{" https://drive.example.com ", "", false},
		{"file:///etc/passwd", "", false},
	} {
		got, err := validateXDHTTPSLoginOrigin(tc.in)
		if tc.valid {
			if err != nil || got != tc.want {
				t.Errorf("%q got %q, %v, want %q", tc.in, got, err, tc.want)
			}
		} else if err == nil {
			t.Errorf("%q unexpectedly accepted: %q", tc.in, got)
		}
	}
}
