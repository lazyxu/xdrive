package meta

import "testing"

func TestFileOperationTypesAndTerminalStates(t *testing.T) {
	for _, value := range []string{
		FileOperationTypeCopy,
		FileOperationTypeMove,
		FileOperationTypeDelete,
	} {
		if !ValidFileOperationType(value) {
			t.Fatalf("expected valid file operation type %q", value)
		}
	}
	for _, value := range []string{"", "rename", "upload"} {
		if ValidFileOperationType(value) {
			t.Fatalf("unexpected valid file operation type %q", value)
		}
	}
	for _, value := range []string{
		FileOperationStatusCancelled,
		FileOperationStatusCompleted,
		FileOperationStatusFailed,
	} {
		if !FileOperationTerminal(value) {
			t.Fatalf("expected terminal status %q", value)
		}
	}
	for _, value := range []string{
		FileOperationStatusQueued,
		FileOperationStatusRunning,
		FileOperationStatusCancelRequested,
	} {
		if FileOperationTerminal(value) {
			t.Fatalf("unexpected terminal status %q", value)
		}
	}
}
