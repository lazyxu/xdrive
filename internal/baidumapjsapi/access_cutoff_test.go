package baidumapjsapi

import (
	"testing"
	"time"
)

func TestAccessAfterRevocationRejectsOldJWTAndSameSecond(t *testing.T) {
	logout := time.Date(2026, 10, 13, 12, 28, 10, 300000000, time.UTC)
	before := logout.Add(-time.Minute)
	future := logout.Add(time.Second)
	if AccessAfterRevocation(before, logout.Add(2*time.Second), &logout) {
		t.Fatal("old, still-valid access JWT re-minted a map session")
	}
	if AccessAfterRevocation(logout.Truncate(time.Second), logout.Add(2*time.Second), &logout) {
		t.Fatal("same-second access JWT passed revocation cutoff")
	}
	if !AccessAfterRevocation(future, future.Add(time.Second), &logout) {
		t.Fatal("new authenticated JWT blocked after revocation cutoff")
	}
	if AccessAfterRevocation(future.Add(time.Second), future, &logout) {
		t.Fatal("future JWT accepted")
	}
	if AccessAfterRevocation(time.Time{}, future, nil) || AccessAfterRevocation(before, time.Time{}, nil) {
		t.Fatal("missing verified issuance time accepted")
	}
	if !AccessAfterRevocation(before, future, nil) {
		t.Fatal("first-login token without prior revocation incorrectly rejected")
	}
}
