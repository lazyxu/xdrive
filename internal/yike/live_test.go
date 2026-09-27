//go:build xdrive_yike_live

package yike

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

// TestLiveYikeReadOnly is deliberately excluded from normal CI. It validates
// the current private Yike Web API with a maintainer-supplied Cookie without
// mutating the account or printing the credential.
func TestLiveYikeReadOnly(t *testing.T) {
	cookie := strings.TrimSpace(os.Getenv("XD_YIKE_TEST_COOKIE"))
	if cookie == "" {
		t.Skip("XD_YIKE_TEST_COOKIE is not set")
	}

	client, err := New(cookie)
	cookie = ""
	if err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	info, err := client.UserInfo(ctx)
	if err != nil {
		t.Fatalf("read user info: %v", err)
	}
	if strings.TrimSpace(info.YouaID) == "" {
		t.Fatal("user info returned an empty youa_id")
	}

	root, err := client.ListFilesPage(ctx, "")
	if err != nil {
		t.Fatalf("list root library: %v", err)
	}
	if len(root.List) > 0 {
		link, err := client.DownloadFileLink(ctx, root.List[0].FSID)
		if err != nil {
			t.Fatalf("resolve root download link: %v", err)
		}
		if strings.TrimSpace(link.URL) == "" {
			t.Fatal("root download link is empty")
		}
	}

	albums, err := client.ListAlbumsPage(ctx, "")
	if err != nil {
		t.Fatalf("list albums: %v", err)
	}
	if len(albums.List) > 0 {
		if _, err := client.ListAlbumFilesPage(ctx, albums.List[0].AlbumID, ""); err != nil {
			t.Fatalf("list first album: %v", err)
		}
	}
}
