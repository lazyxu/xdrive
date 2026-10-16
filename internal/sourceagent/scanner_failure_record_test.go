package sourceagent

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/lazyxu/xdrive/internal/client"
)

type recordingFailureAPI struct {
	API
	captured []client.SourceFailure
}

func (r *recordingFailureAPI) FailSourceItems(
	_ context.Context, _ uint64, _ string, failures []client.SourceFailure,
) error {
	r.captured = append(r.captured, failures...)
	return nil
}

func TestPushFailureSnapshotUsesTypedCategoryAndUTF8Bound(t *testing.T) {
	recorder := &recordingFailureAPI{}
	s := Scanner{API: recorder, SourceID: 42}
	if err := s.recordSourceItemFailure(context.Background(), "run-test", "item-A", os.ErrPermission); err != nil {
		t.Fatal(err)
	}
	if len(recorder.captured) != 1 || recorder.captured[0].ExternalID != "item-A" ||
		recorder.captured[0].Category != "permission" {
		t.Fatalf("typed permission failure not recorded: %+v", recorder.captured)
	}
	message := errors.New(strings.Repeat("故", 1500))
	if err := s.recordSourceItemFailure(context.Background(), "run-test", "item-B", message); err != nil {
		t.Fatal(err)
	}
	if len(recorder.captured[1].Error) > 4<<10 || !utf8.ValidString(recorder.captured[1].Error) {
		t.Fatalf("source item failure exceeds UTF-8 safe 4KiB bound")
	}
}
