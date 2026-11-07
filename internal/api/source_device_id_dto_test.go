package api

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

// Source.DeviceID is the only canonical Push identity exposed to clients.
// Historical enrollment aliases cannot silently supply or override it.
func TestSourceDTOUsesOnlyVerifiedCanonicalDeviceID(t *testing.T) {
	canonical := "c6925cc7-c11c-447e-91c9-209e14e2d9d0"
	legacy := "d112316c-52cd-4b72-8031-1c75fcf2ea9d"
	blank := " "
	for _, tc := range []struct {
		name   string
		source meta.Source
		want   string
	}{
		{
			name: "canonical",
			source: meta.Source{
				Kind: meta.SourceKindIOSPhotos, Direction: meta.SourceDirectionPush,
				DeviceID: &canonical,
			},
			want: canonical,
		},
		{
			name: "matching legacy metadata",
			source: meta.Source{
				Kind: meta.SourceKindLocalFolder, Direction: meta.SourceDirectionPush,
				DeviceID: &canonical, LocalCreatorDeviceID: &canonical,
			},
			want: canonical,
		},
		{
			name: "legacy metadata alone is not authorization",
			source: meta.Source{
				Kind: meta.SourceKindLocalFolder, Direction: meta.SourceDirectionPush,
				LocalCreatorDeviceID: &legacy,
			},
		},
		{
			name: "conflicting legacy identity must not be exposed",
			source: meta.Source{
				Kind: meta.SourceKindLocalFolder, Direction: meta.SourceDirectionPush,
				DeviceID: &canonical, LocalCreatorDeviceID: &legacy,
			},
		},
		{
			name: "blank canonical identity",
			source: meta.Source{
				Kind: meta.SourceKindIOSPhotos, Direction: meta.SourceDirectionPush,
				DeviceID: &blank,
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := toSourceDTO(tc.source).DeviceID; got != tc.want {
				t.Fatalf("Source DTO DeviceID = %q, want %q", got, tc.want)
			}
		})
	}
}
