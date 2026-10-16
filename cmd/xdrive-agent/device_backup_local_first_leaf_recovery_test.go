package main

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestHistoricalPhysicalReceiptMatchesDeniesAuthorityAndWrongScope(t *testing.T) {
	good := client.LocalPushFirstLeafPhysicalReceipt{
		StageID:  "11111111-1111-4111-8111-111111111111",
		SourceID: 42, Revision: 7, NodeID: 91, SourceItemID: 92,
		State: localPhysicalReceiptRecoveryState, CASObserved: true,
	}
	valid := func(v client.LocalPushFirstLeafPhysicalReceipt) bool {
		return historicalPhysicalReceiptMatches(v, 42, 7, good.StageID)
	}
	if !valid(good) {
		t.Fatal("neutral owner-scoped historical CAS observation rejected")
	}
	cases := []struct {
		name   string
		change func(*client.LocalPushFirstLeafPhysicalReceipt)
	}{
		{"wrong Source", func(v *client.LocalPushFirstLeafPhysicalReceipt) { v.SourceID = 43 }},
		{"wrong revision", func(v *client.LocalPushFirstLeafPhysicalReceipt) { v.Revision = 8 }},
		{"wrong Stage", func(v *client.LocalPushFirstLeafPhysicalReceipt) { v.StageID = "foreign" }},
		{"missing Node", func(v *client.LocalPushFirstLeafPhysicalReceipt) { v.NodeID = 0 }},
		{"missing SourceItem", func(v *client.LocalPushFirstLeafPhysicalReceipt) { v.SourceItemID = 0 }},
		{"wrong state", func(v *client.LocalPushFirstLeafPhysicalReceipt) { v.State = "backup_complete" }},
		{"no physical CAS", func(v *client.LocalPushFirstLeafPhysicalReceipt) { v.CASObserved = false }},
		{"native authority", func(v *client.LocalPushFirstLeafPhysicalReceipt) { v.NativeVerified = true }},
		{"backup success", func(v *client.LocalPushFirstLeafPhysicalReceipt) { v.BackupComplete = true }},
		{"commit authority", func(v *client.LocalPushFirstLeafPhysicalReceipt) { v.CommitSupported = true }},
		{"source authority", func(v *client.LocalPushFirstLeafPhysicalReceipt) { v.Authoritative = true }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			value := good
			tc.change(&value)
			if valid(value) {
				t.Fatalf("unsafe physical recovery state accepted: %s", tc.name)
			}
		})
	}
	for _, scope := range []struct {
		source, revision uint64
		stage            string
	}{{0, 7, good.StageID}, {42, 0, good.StageID}, {42, 7, ""}, {43, 7, good.StageID}, {42, 8, good.StageID}} {
		if historicalPhysicalReceiptMatches(good, scope.source, scope.revision, scope.stage) {
			t.Fatal("caller scope mismatch accepted")
		}
	}
	bytes, err := json.Marshal(good)
	if err != nil || string(bytes) != "{}" {
		t.Fatalf("Agent-private recovery result could escape JSON: %s %v", bytes, err)
	}
}

func TestPrivateLocalPhysicalReceiptErrorsAreRedacted(t *testing.T) {
	secret := errors.New("Root /home/alice/documents token=sensitive")
	out := privateLocalPhysicalReceiptError(secret)
	if out == nil || strings.Contains(out.Error(), "/home") ||
		strings.Contains(out.Error(), "sensitive") {
		t.Fatalf("private Root or device token leaked: %v", out)
	}
	for _, sentinel := range []error{context.Canceled, context.DeadlineExceeded} {
		if !errors.Is(privateLocalPhysicalReceiptError(sentinel), sentinel) {
			t.Fatalf("cancellation/deadline lost: %v", sentinel)
		}
	}
}
