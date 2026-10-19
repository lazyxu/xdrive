package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestCaddyHostAdoptStdinStrictBoundedPrivateFields(t *testing.T) {
	valid := []byte("photos.example.com\x00192.168.2.4\x00ExampleKeyID\x00ExampleKeySecret\x00")
	got, err := parseCaddyHostAdoptStdin(valid)
	if err != nil {
		t.Fatal(err)
	}
	if got.Domain != "photos.example.com" || got.LANIP != "192.168.2.4" ||
		got.AliDNSAccessKeyID != "ExampleKeyID" ||
		got.AliDNSAccessSecret != "ExampleKeySecret" {
		t.Fatal("host import envelope changed its fields")
	}
	for _, malformed := range [][]byte{
		nil, []byte("photos.example.com"),
		[]byte("domain\x00ip\x00key\x00secret"),
		[]byte("domain\x00ip\x00key\x00secret\x00extra"),
		[]byte("domain\x00ip\x00key\x00secret\x00\x00"),
		bytes.Repeat([]byte("x"), caddyHostAdoptMaxBytes+1),
	} {
		_, err := parseCaddyHostAdoptStdin(malformed)
		if err == nil {
			t.Fatal("accepted truncated, surplus or oversized private fields")
		}
		if strings.Contains(err.Error(), "ExampleKeySecret") {
			t.Fatal("parser error leaked a private host value")
		}
	}
}
