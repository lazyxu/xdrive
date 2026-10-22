package api

import (
	"encoding/json"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestPublicShareSevenCapabilitiesDefaultReadOnly(t *testing.T) {
	for _, tc := range []struct {
		name     string
		nodeType string
		wantZIP  bool
	}{
		{name: "file", nodeType: meta.NodeTypeFile, wantZIP: false},
		{name: "folder", nodeType: meta.NodeTypeDir, wantZIP: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := publicShareCapabilitiesForNode(tc.nodeType)
			if !got.List || !got.Preview || !got.Download ||
				got.DownloadZIP != tc.wantZIP || got.Search || got.Write || got.Delete {
				t.Fatalf("Share must remain default-read-only and only folder ZIP: %+v", got)
			}
			payload, err := json.Marshal(got)
			if err != nil {
				t.Fatal(err)
			}
			var fields map[string]bool
			if err = json.Unmarshal(payload, &fields); err != nil {
				t.Fatal(err)
			}
			if len(fields) != 7 {
				t.Fatalf("expected 7 service-issued grants, received %v", fields)
			}
			for _, field := range []string{"list", "preview", "download", "downloadZip", "search", "write", "delete"} {
				if _, ok := fields[field]; !ok {
					t.Fatalf("missing grant %q from server JSON: %s", field, payload)
				}
			}
		})
	}
}
