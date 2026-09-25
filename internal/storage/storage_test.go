package storage

import "testing"

func TestContentAddressedKeyRoundTrip(t *testing.T) {
	const hash = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
	key, err := ContentAddressedKey(hash)
	if err != nil {
		t.Fatal(err)
	}
	if key != ".xdrive-blobs/sha256/9f/"+hash {
		t.Fatalf("key=%q", key)
	}
	got, ok := ContentHashFromKey(key)
	if !ok || got != hash || !IsContentAddressedKey(key) {
		t.Fatalf("round trip key=%q got=%q ok=%v", key, got, ok)
	}
}

func TestContentAddressedKeyRejectsInvalidValues(t *testing.T) {
	for _, value := range []string{"", "abc", "zz86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"} {
		if _, err := ContentAddressedKey(value); err == nil {
			t.Fatalf("accepted invalid hash %q", value)
		}
	}
	if _, ok := ContentHashFromKey(".xdrive-blobs/sha256/00/not-a-hash"); ok {
		t.Fatal("accepted invalid CAS key")
	}
}
