package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMediaItemRangeQueries(t *testing.T) {
	type requestCase struct {
		name string
		path string
		call func(*Client) (MediaItemRange, error)
	}
	query := MediaQuery{Search: "marina"}
	cases := []requestCase{
		{
			name: "items",
			path: "/api/v1/media/items",
			call: func(c *Client) (MediaItemRange, error) {
				return c.MediaItemsRangeQuery(context.Background(), query, 200, 0)
			},
		},
		{
			name: "album",
			path: "/api/v1/media/albums/folder:42/items",
			call: func(c *Client) (MediaItemRange, error) {
				return c.MediaAlbumItemsRangeQuery(context.Background(), "folder:42", query, 200, 0)
			},
		},
		{
			name: "person",
			path: "/api/v1/media/people/identities/person:v1:abc/items",
			call: func(c *Client) (MediaItemRange, error) {
				return c.MediaPersonIdentityItemsRangeQuery(
					context.Background(), "person:v1:abc", query, 200, 0,
				)
			},
		},
		{
			name: "suggested",
			path: "/api/v1/media/people/suggestions/auto:v1:abc/items",
			call: func(c *Client) (MediaItemRange, error) {
				return c.MediaSuggestedPersonItemsRangeQuery(
					context.Background(), "auto:v1:abc", query, 200, 0,
				)
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != tc.path {
					t.Fatalf("path=%q want=%q", r.URL.Path, tc.path)
				}
				if got := r.URL.Query().Get("range"); got != "true" {
					t.Fatalf("range=%q", got)
				}
				if got := r.URL.Query().Get("offset"); got != "0" {
					t.Fatalf("offset=%q", got)
				}
				if got := r.URL.Query().Get("limit"); got != "200" {
					t.Fatalf("limit=%q", got)
				}
				if got := r.URL.Query().Get("q"); got != "marina" {
					t.Fatalf("q=%q", got)
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(MediaItemRange{
					Items:      []MediaItem{{Node: Node{ID: 7, Name: "photo.jpg", Type: "file"}}},
					TotalCount: 640,
					Offset:     0,
					Limit:      200,
					TimelineGroups: []MediaTimelineGroupIndex{
						{Key: "2026-10", ItemCount: 600, StartIndex: 0},
						{Key: "unknown", ItemCount: 40, StartIndex: 600},
					},
				})
			}))
			defer server.Close()

			cli := New(server.URL, "token")
			page, err := tc.call(cli)
			if err != nil {
				t.Fatal(err)
			}
			if page.TotalCount != 640 || page.Offset != 0 || page.Limit != 200 ||
				len(page.Items) != 1 || page.Items[0].Node.ID != 7 ||
				len(page.TimelineGroups) != 2 ||
				page.TimelineGroups[0].Key != "2026-10" ||
				page.TimelineGroups[1].StartIndex != 600 {
				t.Fatalf("unexpected page: %+v", page)
			}
		})
	}

	cli := New("http://127.0.0.1", "")
	if _, err := cli.MediaItemsRangeQuery(
		context.Background(), MediaQuery{}, 200, -1,
	); err == nil {
		t.Fatal("negative media range offset unexpectedly succeeded")
	}
}
