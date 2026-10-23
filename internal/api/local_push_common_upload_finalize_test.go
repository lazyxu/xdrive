package api

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestLocalPushCommonUploadHookIsInertForOrdinaryUploads(t *testing.T) {
	// Existing Owner uploads never read the new private operation table and
	// cannot be blocked by absence of that table during staged upgrades.
	err := persistLocalPushCommonUploadFinalizedTx(nil, meta.UploadSession{
		ID: "ordinary", ResumeKey: strings.Repeat("f", 64),
	}, 0, "", 0, time.Time{})
	if err != nil {
		t.Fatalf("ordinary upload unexpectedly requires local Push: %v", err)
	}
}

func TestLocalPushCommonUploadRejectsUnboundPrivateSession(t *testing.T) {
	// Until the owning Device/Root/Source binding endpoint is available, a
	// caller's lp2_ resume key is NOT a Push authorization or terminal.
	err := persistLocalPushCommonUploadFinalizedTx(nil, meta.UploadSession{
		ResumeKey: "lp2_" + strings.Repeat("a", 64),
	}, 0, strings.Repeat("b", 64), 1, time.Now())
	if !errors.Is(err, errLocalPushCommonUploadUnavailable) {
		t.Fatalf("unbound private session admitted: %v", err)
	}
}
