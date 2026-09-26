package connectorsecret

import (
	"bytes"
	"strings"
	"testing"
)

func TestKeyringSealOpenAndAADBinding(t *testing.T) {
	ring, err := NewKeyring(2, map[uint32]string{
		1: strings.Repeat("11", 32),
		2: strings.Repeat("22", 32),
	})
	if err != nil {
		t.Fatal(err)
	}
	version, ciphertext, err := ring.Seal(7, "yike_photos", []byte("BDUSS=secret-cookie"))
	if err != nil {
		t.Fatal(err)
	}
	if version != 2 {
		t.Fatalf("version=%d want=2", version)
	}
	if bytes.Contains(ciphertext, []byte("secret-cookie")) {
		t.Fatal("ciphertext contains plaintext")
	}
	plain, err := ring.Open(7, "yike_photos", version, ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if string(plain) != "BDUSS=secret-cookie" {
		t.Fatalf("plaintext=%q", plain)
	}
	if _, err := ring.Open(8, "yike_photos", version, ciphertext); err == nil {
		t.Fatal("ciphertext was not bound to source id")
	}
	if _, err := ring.Open(7, "other", version, ciphertext); err == nil {
		t.Fatal("ciphertext was not bound to source kind")
	}
}

func TestKeyringReadsHistoricalVersion(t *testing.T) {
	oldRing, err := NewKeyring(1, map[uint32]string{
		1: strings.Repeat("11", 32),
	})
	if err != nil {
		t.Fatal(err)
	}
	version, ciphertext, err := oldRing.Seal(9, "yike_photos", []byte("cookie=v1"))
	if err != nil {
		t.Fatal(err)
	}

	rotated, err := NewKeyring(2, map[uint32]string{
		1: strings.Repeat("11", 32),
		2: strings.Repeat("22", 32),
	})
	if err != nil {
		t.Fatal(err)
	}
	plain, err := rotated.Open(9, "yike_photos", version, ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if string(plain) != "cookie=v1" {
		t.Fatalf("plaintext=%q", plain)
	}
}

func TestParseKeyring(t *testing.T) {
	ring, err := ParseKeyring("2",
		"1:"+strings.Repeat("11", 32)+",2:"+strings.Repeat("22", 32),
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	if ring.ActiveVersion() != 2 {
		t.Fatalf("active=%d", ring.ActiveVersion())
	}
	versions := ring.Versions()
	if len(versions) != 2 || versions[0] != 1 || versions[1] != 2 {
		t.Fatalf("versions=%v", versions)
	}

	legacy, err := ParseKeyring("", "", strings.Repeat("33", 32))
	if err != nil {
		t.Fatal(err)
	}
	if legacy.ActiveVersion() != 1 {
		t.Fatalf("legacy active=%d", legacy.ActiveVersion())
	}
}

func TestParseKeyringRejectsInvalidConfig(t *testing.T) {
	valid := strings.Repeat("11", 32)
	tests := []struct {
		active, keys, legacy string
	}{
		{"", "", ""},
	}
	if ring, err := ParseKeyring(tests[0].active, tests[0].keys, tests[0].legacy); err != nil || ring != nil {
		t.Fatalf("empty config ring=%v err=%v", ring, err)
	}
	for _, tt := range []struct {
		active, keys, legacy string
	}{
		{"2", "1:" + valid, ""},
		{"", "1:" + valid + ",2:" + valid, ""},
		{"1", "bad", ""},
		{"1", "1:zz", ""},
		{"2", "", valid},
		{"1", "", ""},
		{"2", "2:" + valid, strings.Repeat("11", 32)},
		{"1", "1:" + valid, strings.Repeat("22", 32)},
	} {
		if _, err := ParseKeyring(tt.active, tt.keys, tt.legacy); err == nil {
			t.Fatalf("invalid config accepted: active=%q keys=%q legacy=%q", tt.active, tt.keys, tt.legacy)
		}
	}
}
