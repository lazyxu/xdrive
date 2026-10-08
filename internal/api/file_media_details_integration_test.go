package api

import (
	"context"
	"errors"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestFileMediaDetailsProjectsCurrentOwnerRevisionOnly(t *testing.T) {
	db, srv, userA, userB, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.MediaMetadata{}); err != nil {
		t.Fatal(err)
	}

	image := createFilePropertiesFile(t, db, userA.ID, root.ID, "photo.jpg", 8)
	video := createFilePropertiesFile(t, db, userA.ID, root.ID, "clip.mp4", 16)
	stale := createFilePropertiesFile(t, db, userA.ID, root.ID, "stale.mov", 32)

	for _, metadata := range []meta.MediaMetadata{
		{
			NodeID: image.ID, OwnerID: userA.ID, NodeRevision: image.Revision,
			MediaKind: meta.MediaKindImage, Width: 4032, Height: 3024,
			IndexState: meta.MediaIndexStateReady,
		},
		{
			NodeID: video.ID, OwnerID: userA.ID, NodeRevision: video.Revision,
			MediaKind: meta.MediaKindVideo, Width: 1920, Height: 1080,
			DurationMS: 125000, IndexState: meta.MediaIndexStateReady,
		},
		{
			NodeID: stale.ID, OwnerID: userA.ID, NodeRevision: stale.Revision + 1,
			MediaKind: meta.MediaKindVideo, Width: 640, Height: 480,
			DurationMS: 9000, IndexState: meta.MediaIndexStateReady,
		},
	} {
		if err := db.Create(&metadata).Error; err != nil {
			t.Fatal(err)
		}
	}

	rows, err := srv.computeFileMediaDetails(
		context.Background(),
		userA.ID,
		[]batchNodeRef{
			{ID: video.ID, Revision: video.Revision},
			{ID: image.ID, Revision: image.Revision},
			{ID: stale.ID, Revision: stale.Revision},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("rows=%d want=3", len(rows))
	}
	if rows[0].ID != video.ID || rows[0].Width != 1920 ||
		rows[0].Height != 1080 || rows[0].DurationMS != 125000 {
		t.Fatalf("video details=%+v", rows[0])
	}
	if rows[1].ID != image.ID || rows[1].Width != 4032 ||
		rows[1].Height != 3024 || rows[1].DurationMS != 0 {
		t.Fatalf("image details=%+v", rows[1])
	}
	if rows[2].ID != stale.ID || rows[2].Width != 0 ||
		rows[2].Height != 0 || rows[2].DurationMS != 0 {
		t.Fatalf("stale metadata leaked into current revision: %+v", rows[2])
	}

	if _, err := srv.computeFileMediaDetails(
		context.Background(),
		userA.ID,
		[]batchNodeRef{{ID: image.ID, Revision: image.Revision + 1}},
	); err == nil {
		t.Fatal("stale requested revision unexpectedly succeeded")
	} else {
		var failure *batchMutationFailure
		if !errors.As(err, &failure) || failure.Code != "revision_conflict" {
			t.Fatalf("stale revision error=%v", err)
		}
	}

	foreignRoot := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: userB.ID, Revision: 1}
	if err := db.Create(&foreignRoot).Error; err != nil {
		t.Fatal(err)
	}
	foreign := createFilePropertiesFile(t, db, userB.ID, foreignRoot.ID, "foreign.mp4", 64)
	if _, err := srv.computeFileMediaDetails(
		context.Background(),
		userA.ID,
		[]batchNodeRef{{ID: foreign.ID, Revision: foreign.Revision}},
	); err == nil {
		t.Fatal("cross-owner media details unexpectedly succeeded")
	} else {
		var failure *batchMutationFailure
		if !errors.As(err, &failure) || failure.Code != "node_not_found" {
			t.Fatalf("cross-owner error=%v", err)
		}
	}

	dir := createFilePropertiesDir(t, db, userA.ID, root.ID, "folder")
	if _, err := srv.computeFileMediaDetails(
		context.Background(),
		userA.ID,
		[]batchNodeRef{{ID: dir.ID, Revision: dir.Revision}},
	); err == nil {
		t.Fatal("directory media details unexpectedly succeeded")
	} else {
		var failure *batchMutationFailure
		if !errors.As(err, &failure) || failure.Code != "media_details_file_required" {
			t.Fatalf("directory error=%v", err)
		}
	}
}
