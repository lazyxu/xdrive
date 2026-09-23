//go:build windows

package main

import (
	"encoding/base64"
	"encoding/binary"
	"testing"
	"unicode/utf16"
)

func TestEncodePowerShellCommand(t *testing.T) {
	got := encodePowerShellCommand("Write-Output 'xDrive ✓'")
	raw, err := base64.StdEncoding.DecodeString(got)
	if err != nil {
		t.Fatal(err)
	}
	if len(raw)%2 != 0 {
		t.Fatalf("encoded command byte length = %d, want even", len(raw))
	}
	units := make([]uint16, len(raw)/2)
	for i := range units {
		units[i] = binary.LittleEndian.Uint16(raw[i*2:])
	}
	if decoded := string(utf16.Decode(units)); decoded != "Write-Output 'xDrive ✓'" {
		t.Fatalf("decoded command = %q", decoded)
	}
}
