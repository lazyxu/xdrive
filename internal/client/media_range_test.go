package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestMediaCleanupQueries(t *testing.T) {
	requestIndex := 0
	duplicateID := "duplicate:v1:" + strings.Repeat("a", 64)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch requestIndex {
		case 0:
			if r.URL.Path != "/api/v1/media/duplicates" {
				t.Fatalf("duplicates path=%q", r.URL.Path)
			}
			if got := r.URL.Query().Get("limit"); got != "24" {
				t.Fatalf("duplicates limit=%q", got)
			}
			_ = json.NewEncoder(w).Encode(MediaDuplicateGroupList{
				Groups: []MediaDuplicateGroup{{
					ID: duplicateID, ItemCount: 2,
					LogicalDuplicateBytes: 100,
					RecommendedKeepNodeID: 31,
				}},
				TotalGroups: 1, TotalItems: 2, LogicalDuplicateBytes: 100,
			})
		case 1:
			if r.URL.Path != "/api/v1/media/duplicates/"+duplicateID+"/items" {
				t.Fatalf("duplicate items path=%q", r.URL.Path)
			}
			if got := r.URL.Query().Get("range"); got != "true" {
				t.Fatalf("duplicate range=%q", got)
			}
			_ = json.NewEncoder(w).Encode(MediaItemRange{
				Items:      []MediaItem{{Node: Node{ID: 31, Name: "copy.jpg", Type: "file"}}},
				TotalCount: 2, Offset: 0, Limit: 40,
			})
		case 2:
			if r.URL.Path != "/api/v1/media/bursts" {
				t.Fatalf("bursts path=%q", r.URL.Path)
			}
			_ = json.NewEncoder(w).Encode(MediaBurstReviewList{
				Groups: []MediaBurstReview{{
					ID: "burst:v1:42", ItemCount: 3,
					RecommendedNodeID:        31,
					PotentialCleanupBytes:    200,
					PhysicalReclaimableBytes: 100,
				}},
				TotalGroups: 1, TotalItems: 3,
				PotentialCleanupBytes: 200, PhysicalReclaimableBytes: 100,
			})
		case 3:
			if r.URL.Path != "/api/v1/media/bursts/burst:v1:42/items" {
				t.Fatalf("burst items path=%q", r.URL.Path)
			}
			_ = json.NewEncoder(w).Encode(MediaItemRange{
				Items:      []MediaItem{{Node: Node{ID: 31, Name: "burst.jpg", Type: "file"}}},
				TotalCount: 3, Offset: 0, Limit: 40,
			})
		default:
			t.Fatalf("unexpected request %d", requestIndex)
		}
		requestIndex++
	}))
	defer server.Close()

	cli := New(server.URL, "token")
	duplicates, err := cli.MediaDuplicateGroups(context.Background(), 24)
	if err != nil {
		t.Fatal(err)
	}
	if duplicates.TotalGroups != 1 || duplicates.Groups[0].ID != duplicateID {
		t.Fatalf("duplicates=%+v", duplicates)
	}
	duplicatePage, err := cli.MediaDuplicateItemsRange(
		context.Background(), duplicateID, 40, 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if duplicatePage.TotalCount != 2 || duplicatePage.Items[0].Node.ID != 31 {
		t.Fatalf("duplicate page=%+v", duplicatePage)
	}
	bursts, err := cli.MediaBurstReviews(context.Background(), 24)
	if err != nil {
		t.Fatal(err)
	}
	if bursts.TotalGroups != 1 || bursts.Groups[0].ID != "burst:v1:42" {
		t.Fatalf("bursts=%+v", bursts)
	}
	burstPage, err := cli.MediaBurstReviewItemsRange(
		context.Background(), "burst:v1:42", 40, 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if burstPage.TotalCount != 3 || burstPage.Items[0].Node.ID != 31 {
		t.Fatalf("burst page=%+v", burstPage)
	}
}

func TestMediaEditRecipeQueries(t *testing.T) {
	requestIndex := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch requestIndex {
		case 0:
			if r.Method != http.MethodGet ||
				r.URL.Path != "/api/v1/media/items/31/edit" {
				t.Fatalf("edit get method=%s path=%q", r.Method, r.URL.Path)
			}
			_ = json.NewEncoder(w).Encode(MediaEditRecipe{
				Version: 1, Revision: 1, SourceCurrent: true,
				MediaKind: "image", CropWidth: 1, CropHeight: 1,
			})
		case 1:
			if r.Method != http.MethodPut ||
				r.URL.Path != "/api/v1/media/items/31/edit" {
				t.Fatalf("edit put method=%s path=%q", r.Method, r.URL.Path)
			}
			var input MediaEditRecipeInput
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				t.Fatal(err)
			}
			if input.Revision != 1 || input.RotationDegrees != 90 {
				t.Fatalf("edit input=%+v", input)
			}
			_ = json.NewEncoder(w).Encode(MediaEditRecipe{
				Version: 1, Revision: 2, SourceCurrent: true,
				MediaKind: "image", RotationDegrees: 90,
				CropWidth: 1, CropHeight: 1,
			})
		case 2:
			if r.Method != http.MethodDelete ||
				r.URL.Path != "/api/v1/media/items/31/edit" ||
				r.URL.Query().Get("revision") != "2" {
				t.Fatalf(
					"edit delete method=%s path=%q revision=%q",
					r.Method,
					r.URL.Path,
					r.URL.Query().Get("revision"),
				)
			}
			_ = json.NewEncoder(w).Encode(MediaEditRecipe{
				Version: 1, SourceCurrent: true,
				MediaKind: "image", CropWidth: 1, CropHeight: 1,
			})
		default:
			t.Fatalf("unexpected request %d", requestIndex)
		}
		requestIndex++
	}))
	defer server.Close()

	cli := New(server.URL, "token")
	got, err := cli.MediaEditRecipe(context.Background(), 31)
	if err != nil {
		t.Fatal(err)
	}
	if got.Revision != 1 {
		t.Fatalf("edit=%+v", got)
	}
	got, err = cli.SaveMediaEditRecipe(
		context.Background(),
		31,
		MediaEditRecipeInput{
			Revision: 1, RotationDegrees: 90,
			CropWidth: 1, CropHeight: 1,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if got.Revision != 2 || got.RotationDegrees != 90 {
		t.Fatalf("saved edit=%+v", got)
	}
	got, err = cli.ResetMediaEditRecipe(context.Background(), 31, 2)
	if err != nil {
		t.Fatal(err)
	}
	if got.Revision != 0 || got.CropWidth != 1 || got.CropHeight != 1 {
		t.Fatalf("reset edit=%+v", got)
	}
}

func TestMediaCreativeGenerationQueries(t *testing.T) {
	requestIndex := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch requestIndex {
		case 0:
			if r.Method != http.MethodPost ||
				r.URL.Path != "/api/v1/media/items/31/creative" {
				t.Fatalf("creative create method=%s path=%q", r.Method, r.URL.Path)
			}
			var input MediaCreativeInput
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				t.Fatal(err)
			}
			if input.Kind != "cutout" ||
				input.CutoutMode != "object" ||
				len(input.Points) != 1 ||
				!input.Points[0].Foreground {
				t.Fatalf("creative create input=%+v", input)
			}
			w.WriteHeader(http.StatusAccepted)
			_ = json.NewEncoder(w).Encode(MediaCreativeGeneration{
				ID: "creative-1", Kind: "cutout", State: "queued",
				SourceAssetID: 1, SourceNodeID: 31, SourceNodeRevision: 1,
			})
		case 1:
			if r.Method != http.MethodGet ||
				r.URL.Path != "/api/v1/media/creative/creative-1" {
				t.Fatalf("creative get method=%s path=%q", r.Method, r.URL.Path)
			}
			_ = json.NewEncoder(w).Encode(MediaCreativeGeneration{
				ID: "creative-1", Kind: "cutout", State: "running",
				SourceAssetID: 1, SourceNodeID: 31, SourceNodeRevision: 1,
			})
		case 2:
			if r.Method != http.MethodPost ||
				r.URL.Path != "/api/v1/media/creative/creative-1/cancel" {
				t.Fatalf("creative cancel method=%s path=%q", r.Method, r.URL.Path)
			}
			_ = json.NewEncoder(w).Encode(MediaCreativeGeneration{
				ID: "creative-1", Kind: "cutout", State: "cancelled",
				SourceAssetID: 1, SourceNodeID: 31, SourceNodeRevision: 1,
			})
		default:
			t.Fatalf("unexpected request %d", requestIndex)
		}
		requestIndex++
	}))
	defer server.Close()

	cli := New(server.URL, "token")
	generation, err := cli.CreateMediaCreativeGeneration(
		context.Background(),
		31,
		MediaCreativeInput{
			Kind:       "cutout",
			CutoutMode: "object",
			Points:     []MediaCreativePoint{{X: 0.5, Y: 0.4, Foreground: true}},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if generation.ID != "creative-1" || generation.State != "queued" {
		t.Fatalf("created generation=%+v", generation)
	}

	generation, err = cli.MediaCreativeGeneration(context.Background(), "creative-1")
	if err != nil {
		t.Fatal(err)
	}
	if generation.State != "running" {
		t.Fatalf("running generation=%+v", generation)
	}

	generation, err = cli.CancelMediaCreativeGeneration(
		context.Background(),
		"creative-1",
	)
	if err != nil {
		t.Fatal(err)
	}
	if generation.State != "cancelled" {
		t.Fatalf("cancelled generation=%+v", generation)
	}
}
