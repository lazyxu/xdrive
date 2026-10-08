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
	query := MediaQuery{Search: "marina", Category: "panorama"}
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
				if got := r.URL.Query().Get("category"); got != "panorama" {
					t.Fatalf("category=%q", got)
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
					TimelineGroupSets: &MediaTimelineGroupSets{
						Year: []MediaTimelineGroupIndex{
							{Key: "2026", ItemCount: 600, StartIndex: 0},
							{Key: "unknown", ItemCount: 40, StartIndex: 600},
						},
						Month: []MediaTimelineGroupIndex{
							{Key: "2026-10", ItemCount: 600, StartIndex: 0},
							{Key: "unknown", ItemCount: 40, StartIndex: 600},
						},
						Day: []MediaTimelineGroupIndex{
							{Key: "2026-10-05", ItemCount: 600, StartIndex: 0},
							{Key: "unknown", ItemCount: 40, StartIndex: 600},
						},
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
				page.TimelineGroups[1].StartIndex != 600 ||
				page.TimelineGroupSets == nil ||
				page.TimelineGroupSets.Year[0].Key != "2026" ||
				page.TimelineGroupSets.Day[0].Key != "2026-10-05" {
				t.Fatalf("unexpected page: %+v", page)
			}
		})
	}

	trashServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/media/trash" {
			t.Fatalf("trash path=%q", r.URL.Path)
		}
		if got := r.URL.Query().Get("limit"); got != "40" {
			t.Fatalf("trash limit=%q", got)
		}
		if got := r.URL.Query().Get("offset"); got != "20" {
			t.Fatalf("trash offset=%q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(MediaItemRange{
			Items: []MediaItem{{
				Node:      Node{ID: 7, Name: "deleted.jpg", Type: "file"},
				TrashRoot: &Node{ID: 9, Name: "Deleted Folder", Type: "dir"},
			}},
			TotalCount: 1,
			Offset:     20,
			Limit:      40,
		})
	}))
	defer trashServer.Close()
	trashPage, err := New(trashServer.URL, "token").MediaTrashRange(
		context.Background(),
		40,
		20,
	)
	if err != nil {
		t.Fatal(err)
	}
	if trashPage.TotalCount != 1 ||
		len(trashPage.Items) != 1 ||
		trashPage.Items[0].TrashRoot == nil ||
		trashPage.Items[0].TrashRoot.ID != 9 {
		t.Fatalf("unexpected trash page: %+v", trashPage)
	}

	cli := New("http://127.0.0.1", "")
	if _, err := cli.MediaItemsRangeQuery(
		context.Background(), MediaQuery{}, 200, -1,
	); err == nil {
		t.Fatal("negative media range offset unexpectedly succeeded")
	}
}

func TestMediaMemoriesQueries(t *testing.T) {
	requestIndex := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch requestIndex {
		case 0:
			if r.URL.Path != "/api/v1/media/memories" {
				t.Fatalf("memories path=%q", r.URL.Path)
			}
			if got := r.URL.Query().Get("anchor_date"); got != "2026-10-08" {
				t.Fatalf("anchor_date=%q", got)
			}
			if got := r.URL.Query().Get("limit"); got != "24" {
				t.Fatalf("memory limit=%q", got)
			}
			_ = json.NewEncoder(w).Encode([]MediaMemory{{
				ID: "recent:2026-10-08", Kind: "recent_day",
				Title: "今天", ItemCount: 4,
			}})
		case 1:
			if r.URL.Path != "/api/v1/media/memories/recent:2026-10-08/items" {
				t.Fatalf("memory items path=%q", r.URL.Path)
			}
			if got := r.URL.Query().Get("range"); got != "true" {
				t.Fatalf("memory range=%q", got)
			}
			if got := r.URL.Query().Get("limit"); got != "40" {
				t.Fatalf("memory item limit=%q", got)
			}
			if got := r.URL.Query().Get("offset"); got != "20" {
				t.Fatalf("memory item offset=%q", got)
			}
			_ = json.NewEncoder(w).Encode(MediaItemRange{
				Items:      []MediaItem{{Node: Node{ID: 31, Name: "photo.jpg", Type: "file"}}},
				TotalCount: 4, Offset: 20, Limit: 40,
			})
		default:
			t.Fatalf("unexpected request %d", requestIndex)
		}
		requestIndex++
	}))
	defer server.Close()

	cli := New(server.URL, "token")
	memories, err := cli.MediaMemories(context.Background(), "2026-10-08", 24)
	if err != nil {
		t.Fatal(err)
	}
	if len(memories) != 1 || memories[0].ID != "recent:2026-10-08" {
		t.Fatalf("memories=%+v", memories)
	}
	page, err := cli.MediaMemoryItemsRange(
		context.Background(),
		"recent:2026-10-08",
		40,
		20,
	)
	if err != nil {
		t.Fatal(err)
	}
	if page.TotalCount != 4 || len(page.Items) != 1 || page.Items[0].Node.ID != 31 {
		t.Fatalf("memory page=%+v", page)
	}
}
