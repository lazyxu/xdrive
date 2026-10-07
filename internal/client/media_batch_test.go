package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestMediaBatchMutations(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body struct {
			NodeIDs  []uint64 `json:"node_ids"`
			Favorite *bool    `json:"favorite"`
			Tags     []string `json:"tags"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(body.NodeIDs, []uint64{7, 9}) {
			t.Fatalf("node_ids=%v", body.NodeIDs)
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/media/batch/favorite":
			if r.Method != http.MethodPatch || body.Favorite == nil || !*body.Favorite {
				t.Fatalf("favorite request method=%s body=%+v", r.Method, body)
			}
			_ = json.NewEncoder(w).Encode(MediaBatchFavorite{Updated: 2, Favorite: true})
		case "/api/v1/media/batch/tags":
			if r.Method != http.MethodPost || !reflect.DeepEqual(body.Tags, []string{"family"}) {
				t.Fatalf("tags request method=%s body=%+v", r.Method, body)
			}
			_ = json.NewEncoder(w).Encode(MediaBatchTags{Updated: 2, Tags: body.Tags})
		default:
			t.Fatalf("unexpected path=%s", r.URL.Path)
		}
	}))
	defer server.Close()

	cli := New(server.URL, "token")
	favorite, err := cli.SetMediaFavoriteBatch(context.Background(), []uint64{7, 9}, true)
	if err != nil {
		t.Fatal(err)
	}
	if favorite.Updated != 2 || !favorite.Favorite {
		t.Fatalf("favorite=%+v", favorite)
	}
	tags, err := cli.AddMediaTagsBatch(context.Background(), []uint64{7, 9}, []string{"family"})
	if err != nil {
		t.Fatal(err)
	}
	if tags.Updated != 2 || !reflect.DeepEqual(tags.Tags, []string{"family"}) {
		t.Fatalf("tags=%+v", tags)
	}
	if calls != 2 {
		t.Fatalf("calls=%d", calls)
	}
}
