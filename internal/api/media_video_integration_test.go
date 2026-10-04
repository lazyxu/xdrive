package api

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestMediaVideoPlaybackTicketAndRange(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "media_video_stream_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{},
		&meta.Node{},
		&meta.File{},
		&meta.MediaMetadata{},
	); err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB:    db,
		Store: store,
		Auth:  auth.New("media-video-integration-secret", time.Hour),
	}
	router := server.Router()

	user := meta.User{
		Username:       "video-owner",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	token, err := server.Auth.Issue(user.ID, user.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}

	video := testRangeMP4()
	const storageKey = "video/playback.mp4"
	if _, err := store.Put(t.Context(), storageKey, bytes.NewReader(video)); err != nil {
		t.Fatal(err)
	}
	node := meta.Node{
		Name: "phone-video.mp4", Type: meta.NodeTypeFile,
		OwnerID: user.ID, Revision: 1,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	file := meta.File{
		NodeID: node.ID, Size: int64(len(video)), StorageKey: storageKey,
		SHA256: strings.Repeat("a", 64),
	}
	if err := db.Create(&file).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.MediaMetadata{
		NodeID: node.ID, OwnerID: user.ID, NodeRevision: node.Revision,
		SHA256: file.SHA256, MediaKind: meta.MediaKindVideo,
		MIMEType: "video/mp4", IndexState: meta.MediaIndexStateReady,
		RelationEvidenceVersion: mediapkg.RelationEvidenceVersion,
	}).Error; err != nil {
		t.Fatal(err)
	}

	ticketResponse := request(
		t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/media/items/%d/video-ticket", node.ID),
		token, nil, http.StatusOK,
	)
	var ticket mediaVideoTicketDTO
	if err := json.Unmarshal(ticketResponse.Body.Bytes(), &ticket); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(ticket.URL, fmt.Sprintf("/api/v1/media/play/%d?ticket=", node.ID)) ||
		!ticket.ExpiresAt.After(time.Now()) {
		t.Fatalf("ticket=%+v", ticket)
	}

	rangeResponse := requestWithHeaders(
		t, router, http.MethodGet, ticket.URL, "", nil, http.StatusPartialContent,
		map[string]string{"Range": "bytes=0-11"},
	)
	if got := rangeResponse.Header().Get("Content-Type"); got != "video/mp4" {
		t.Fatalf("content-type=%q", got)
	}
	if got := rangeResponse.Header().Get("Content-Range"); got != fmt.Sprintf("bytes 0-11/%d", len(video)) {
		t.Fatalf("content-range=%q", got)
	}
	if !bytes.Equal(rangeResponse.Body.Bytes(), video[:12]) {
		t.Fatalf("range bytes=%x want=%x", rangeResponse.Body.Bytes(), video[:12])
	}
	if got := rangeResponse.Header().Get("Content-Disposition"); !strings.HasPrefix(got, "inline;") {
		t.Fatalf("content-disposition=%q", got)
	}
	if got := rangeResponse.Header().Get("ETag"); got != "\"media-video-"+strings.Repeat("a", 64)+"\"" {
		t.Fatalf("etag=%q", got)
	}

	invalidRange := requestWithHeaders(
		t, router, http.MethodGet, ticket.URL, "", nil, http.StatusRequestedRangeNotSatisfiable,
		map[string]string{"Range": fmt.Sprintf("bytes=%d-", len(video)+100)},
	)
	if got := invalidRange.Header().Get("Content-Range"); got != fmt.Sprintf("bytes */%d", len(video)) {
		t.Fatalf("invalid range content-range=%q", got)
	}

	authedRange := requestWithHeaders(
		t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d/video", node.ID),
		token, nil, http.StatusPartialContent,
		map[string]string{"Range": "bytes=12-19"},
	)
	if !bytes.Equal(authedRange.Body.Bytes(), video[12:20]) {
		t.Fatalf("authenticated range bytes=%x want=%x", authedRange.Body.Bytes(), video[12:20])
	}

	if err := db.Model(&meta.Node{}).Where("id = ?", node.ID).
		Update("revision", gorm.Expr("revision + 1")).Error; err != nil {
		t.Fatal(err)
	}
	request(
		t, router, http.MethodGet, ticket.URL, "", nil, http.StatusGone,
	)
}

func testRangeMP4() []byte {
	box := func(kind string, payload []byte) []byte {
		out := make([]byte, 8+len(payload))
		binary.BigEndian.PutUint32(out[:4], uint32(len(out)))
		copy(out[4:8], []byte(kind))
		copy(out[8:], payload)
		return out
	}
	ftyp := box("ftyp", append([]byte("isom"), make([]byte, 8)...))
	moov := box("moov", nil)
	mdat := box("mdat", []byte("0123456789abcdefghijklmnopqrstuvwxyz"))
	return append(append(ftyp, moov...), mdat...)
}
