package api

import (
	"encoding/json"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestPublicShareEightCapabilitiesDefaultReadOnly(t *testing.T) {
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
				got.DownloadZIP != tc.wantZIP || got.Search || got.Write || got.Delete || got.Upload {
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
			if len(fields) != 8 {
				t.Fatalf("expected 8 service-issued grants, received %v", fields)
			}
			for _, field := range []string{"list", "preview", "download", "downloadZip", "search", "write", "delete", "upload"} {
				if _, ok := fields[field]; !ok {
					t.Fatalf("missing grant %q from server JSON: %s", field, payload)
				}
			}
		})
	}
	upload := publicShareCapabilitiesForShare(
		meta.Share{Access: shareAccessViewUpload}, meta.NodeTypeDir)
	if !upload.Upload || upload.Write || upload.Delete || !upload.List || !upload.Download {
		t.Fatalf("upload grant must be independent from generic write/delete: %+v", upload)
	}
	file := publicShareCapabilitiesForShare(
		meta.Share{Access: shareAccessViewUpload}, meta.NodeTypeFile)
	if file.Upload {
		t.Fatalf("file shares must never grant upload: %+v", file)
	}
}
