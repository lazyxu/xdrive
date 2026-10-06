package meta

import "testing"

func TestFileOperationTypesAndTerminalStates(t *testing.T) {
	for _, value := range []string{
		FileOperationTypeCopy,
		FileOperationTypeMove,
		FileOperationTypeDelete,
		FileOperationTypeUndo,
		FileOperationTypeRedo,
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

func TestFileOperationConflictPolicies(t *testing.T) {
	for _, value := range []string{
		FileOperationConflictPolicyFail,
		FileOperationConflictPolicySkip,
		FileOperationConflictPolicyKeepBoth,
		FileOperationConflictPolicyReplace,
	} {
		if !ValidFileOperationConflictPolicy(value) {
			t.Fatalf("expected valid conflict policy %q", value)
		}
	}
	if ValidFileOperationConflictPolicy("") || ValidFileOperationConflictPolicy("overwrite") || ValidFileOperationConflictPolicy("merge") {
		t.Fatal("unexpected valid conflict policy")
	}
	if got := DefaultFileOperationConflictPolicy(FileOperationTypeCopy); got != FileOperationConflictPolicyFail {
		t.Fatalf("copy default policy=%q", got)
	}
	if got := DefaultFileOperationConflictPolicy(FileOperationTypeMove); got != FileOperationConflictPolicyFail {
		t.Fatalf("move default policy=%q", got)
	}
	if got, ok := NormalizeFileOperationConflictPolicy(FileOperationTypeMove, ""); !ok || got != FileOperationConflictPolicyFail {
		t.Fatalf("normalize move default=%q ok=%v", got, ok)
	}
	if _, ok := NormalizeFileOperationConflictPolicy(FileOperationTypeDelete, FileOperationConflictPolicySkip); ok {
		t.Fatal("delete must reject skip conflict policy")
	}
	if _, ok := NormalizeFileOperationConflictPolicy(FileOperationTypeRedo, FileOperationConflictPolicySkip); ok {
		t.Fatal("redo must reject skip conflict policy")
	}
}
