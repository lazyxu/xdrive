package api

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestSourceUsesStoredCredential(t *testing.T) {
	tests := []struct {
		name   string
		source meta.Source
		want   bool
	}{
		{name: "yike pull", source: meta.Source{Kind: yikeSourceKind, Direction: meta.SourceDirectionPull}, want: true},
		{name: "synology pull", source: meta.Source{Kind: synologySourceKind, Direction: meta.SourceDirectionPull}, want: true},
		{name: "synology files pull", source: meta.Source{Kind: synologyFilesSourceKind, Direction: meta.SourceDirectionPull}, want: true},
		{name: "synology push", source: meta.Source{Kind: synologySourceKind, Direction: meta.SourceDirectionPush}, want: false},
		{name: "synology files push", source: meta.Source{Kind: synologyFilesSourceKind, Direction: meta.SourceDirectionPush}, want: false},
		{name: "other pull", source: meta.Source{Kind: "other", Direction: meta.SourceDirectionPull}, want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := sourceUsesStoredCredential(tt.source); got != tt.want {
				t.Fatalf("sourceUsesStoredCredential(%+v)=%t want=%t", tt.source, got, tt.want)
			}
		})
	}
}
