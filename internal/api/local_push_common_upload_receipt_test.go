package api

import (
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestLocalPushCommonReceiptSelectorRequiresOriginalIdentity(t *testing.T) {
	base := localPushCommonReceiptSelector{
		OperationID: uuid.NewString(),
		ResumeKey:   "lp2_" + strings.Repeat("a", 64),
	}
	if !validLocalPushCommonReceiptSelector(base) {
		t.Fatal("valid original file identity rejected")
	}
	invalid := []localPushCommonReceiptSelector{
		{OperationID: "", ResumeKey: base.ResumeKey},
		{OperationID: strings.ToUpper(base.OperationID), ResumeKey: base.ResumeKey},
		{OperationID: base.OperationID, ResumeKey: ""},
		{OperationID: base.OperationID, ResumeKey: strings.Repeat("a", 68)},
		{OperationID: base.OperationID, ResumeKey: "lp2_" + strings.Repeat("A", 64)},
		{OperationID: base.OperationID, ResumeKey: "lp2_" + strings.Repeat("a", 63)},
		{OperationID: base.OperationID, ResumeKey: "lp2_" + strings.Repeat("0", 63) + "/"},
	}
	for _, selector := range invalid {
		if validLocalPushCommonReceiptSelector(selector) {
			t.Fatalf("invalid original file selector accepted: %+v", selector)
		}
	}
}
