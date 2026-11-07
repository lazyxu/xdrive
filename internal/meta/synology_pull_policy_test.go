package meta

import "testing"

func TestSynologyPullMVPPolicy(t *testing.T) {
	for _, tc := range []struct {
		kind, direction string
		disabled        bool
	}{
		{"synology_photos", SourceDirectionPull, true},
		{"synology_files", SourceDirectionPull, true},
		{"synology_photos", SourceDirectionPush, false},
		{SourceKindLocalFolder, SourceDirectionPush, false},
		{"yike_photos", SourceDirectionPull, false},
	} {
		if got := SynologyPullTemporarilyDisabled(tc.kind, tc.direction); got != tc.disabled {
			t.Fatalf("kind=%q direction=%q disabled=%t want=%t", tc.kind, tc.direction, got, tc.disabled)
		}
	}
}
