package client

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMediaContentTransportKeepsOwnerHashAndRevision(t *testing.T) {
	key := "sha256:" + strings.Repeat("a", 64)
	favorite := true
	description := "saved by content"
	for _, tc := range []struct {
		input              MediaContentRequest
		method, path, body string
	}{
		{MediaContentRequest{Operation: "get", ContentKey: key}, "GET", "/api/v1/media/content/" + key, ""},
		{MediaContentRequest{Operation: "sources", ContentKey: key, Cursor: 50}, "GET", "/api/v1/media/content/" + key + "/sources?cursor=50", ""},
		{MediaContentRequest{Operation: "favorite", ContentKey: key, Favorite: &favorite}, "PATCH", "/api/v1/media/content/" + key + "/favorite", `{"favorite":true}`},
		{MediaContentRequest{Operation: "tags", ContentKey: key, Tags: []string{}}, "PATCH", "/api/v1/media/content/" + key + "/tags", `{"tags":[]}`},
		{MediaContentRequest{Operation: "people", ContentKey: key, People: []string{"Person"}}, "PATCH", "/api/v1/media/content/" + key + "/people", `{"people":["Person"]}`},
		{MediaContentRequest{Operation: "description", ContentKey: key, Description: &description}, "PATCH", "/api/v1/media/content/" + key + "/description", `{"description":"saved by content"}`},
		{MediaContentRequest{Operation: "favorite_batch", ContentKeys: []string{key}, Favorite: &favorite}, "PATCH", "/api/v1/media/batch/favorite", `"content_keys"`},
		{MediaContentRequest{Operation: "tags_batch", ContentKeys: []string{key}, Tags: []string{"tag"}}, "POST", "/api/v1/media/batch/tags", `"content_keys"`},
		{MediaContentRequest{Operation: "album_add", ContentKeys: []string{key}, AlbumID: "manual:album", Revision: 7}, "POST", "/api/v1/media/albums/manual:album/items", `"content_keys"`},
		{MediaContentRequest{Operation: "album_remove", ContentKey: key, AlbumID: "manual:album", Revision: 7}, "DELETE", "/api/v1/media/albums/manual:album/content/" + key, ""},
		{MediaContentRequest{Operation: "album_cover", ContentKey: key, AlbumID: "manual:album", Revision: 7}, "PUT", "/api/v1/media/albums/manual:album/cover", `"content_key"`},
	} {
		t.Run(tc.input.Operation, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != tc.method || r.URL.RequestURI() != tc.path || r.Header.Get("Authorization") != "Bearer owner-only-token" {
					t.Errorf("wrong authorized request: %s %s", r.Method, r.URL.RequestURI())
				}
				body, _ := io.ReadAll(r.Body)
				if !strings.Contains(string(body), tc.body) {
					t.Errorf("wrong content selection: %s", body)
				}
				if strings.Contains(string(body), "node_id") {
					t.Error("hash selection downgraded to mutable Node")
				}
				if tc.input.Revision != 0 && r.Header.Get("If-Match") != `"7"` {
					t.Error("lost album revision guard")
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"verified":true}`))
			}))
			defer upstream.Close()
			result, err := New(upstream.URL, "owner-only-token").MediaContent(context.Background(), tc.input)
			if err != nil || !json.Valid(result) || !strings.Contains(string(result), `"verified":true`) {
				t.Fatalf("result lost through Agent: %s %v", result, err)
			}
		})
	}
}

func TestMediaContentTransportRejectsUnboundedOrArbitraryTargets(t *testing.T) {
	key := "sha256:" + strings.Repeat("a", 64)
	for _, input := range []MediaContentRequest{
		{Operation: "get", ContentKey: "../../admin/users"}, {Operation: "DELETE", ContentKey: key},
		{Operation: "get", ContentKey: key, ContentKeys: []string{key}},
		{Operation: "album_remove", ContentKey: key, AlbumID: "foreign:album", Revision: 1},
		{Operation: "album_remove", ContentKey: key, AlbumID: "manual:album"},
		{Operation: "favorite_batch", ContentKeys: make([]string, 1001)},
		{Operation: "tags", ContentKey: key}, {Operation: "favorite", ContentKey: key},
	} {
		if input.Validate() == nil {
			t.Fatalf("unsafe photo operation accepted: %+v", input)
		}
	}
}
