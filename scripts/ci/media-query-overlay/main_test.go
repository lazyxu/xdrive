package main

import (
	"bytes"
	"testing"
)

func TestOverlayPreservesCurrentContractsAndExactBaselineQueries(t *testing.T) {
	current := []byte("package api\ntype mediaItemDTO struct { ContentKey string }\nfunc unrelated() string { return `current {}` }\n")
	baseline := []byte("package api\ntype mediaItemDTO struct { Node int }\nfunc unrelated() string { return `old` }\n")
	for _, name := range queryFunctions {
		current = append(current, []byte("func "+name+"() string { return `after {}` }\n")...)
		baseline = append(baseline, []byte("func "+name+"() string { return `before } {` }\n")...)
	}
	result, err := overlay(current, baseline, queryFunctions)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(result, []byte("ContentKey string")) || !bytes.Contains(result, []byte("return `current {}`")) {
		t.Fatal("current DTO/unrelated code was replaced")
	}
	a, _ := declarations(result)
	b, _ := declarations(baseline)
	for _, name := range queryFunctions {
		if !bytes.Contains(a[name].text, []byte("return `before } {`")) || len(b[name].text) == 0 {
			t.Fatal("baseline query not retained")
		}
	}
	if _, err := overlay(current, []byte("package api\n"), queryFunctions); err == nil {
		t.Fatal("missing baseline query accepted")
	}
	if _, err := overlay([]byte("invalid"), baseline, queryFunctions); err == nil {
		t.Fatal("invalid current source accepted")
	}
	// Shared query owners can evolve alongside media.go. Freeze only their
	// original entry point while retaining new helpers/current test contracts.
	shared, err := overlay(current, baseline, []string{"unrelated"})
	if err != nil || !bytes.Contains(shared, []byte("return `old`")) || !bytes.Contains(shared, []byte("return `after {}`")) {
		t.Fatal("explicit shared query function selection failed")
	}
}
