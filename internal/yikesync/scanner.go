package yikesync

import (
	"context"
	"encoding/hex"
	"fmt"
	"path"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"github.com/lazyxu/xdrive/internal/sourcecollection"
	"github.com/lazyxu/xdrive/internal/sourcemetadata"
	"github.com/lazyxu/xdrive/internal/yike"
)

const (
	SourceKind       = "yike_photos"
	DefaultBatchSize = 500
)

type Remote interface {
	UserInfo(context.Context) (yike.UserInfo, error)
	ListFilesPage(context.Context, string) (yike.FileList, error)
	ListAlbumsPage(context.Context, string) (yike.AlbumList, error)
	ListAlbumFilesPage(context.Context, string, string) (yike.AlbumFileList, error)
}

type SourceAPI interface {
	ObserveSourceItems(context.Context, uint64, string, []client.SourceObservation) ([]client.SourcePlan, error)
	CommitSourceItems(context.Context, uint64, string, []client.SourceCommit) error
	HeartbeatSourceRun(context.Context, uint64, string) error
}

type PlanExecutor interface {
	Execute(context.Context, client.SourcePlan, sourcepkg.DiscoveredItem, TransferRef) (client.SourceCommit, error)
}

type Scanner struct {
	Remote      Remote
	API         SourceAPI
	SourceID    uint64
	RunID       string
	IgnoreRules string
	Mode        string
	Executor    PlanExecutor
	BatchSize   int
}

type Result struct {
	Summary              sourcepkg.Summary
	Collections          []sourcecollection.Snapshot
	Metadata             []sourcemetadata.Snapshot
	Albums               int64
	RootItems            int64
	AlbumMemberships     int64
	DuplicateMemberships int64
	SharedItems          int64
	OwnItems             int64
	Errors               []string
}

func (s Scanner) Scan(ctx context.Context) (Result, error) {
	var result Result
	if s.Remote == nil || s.API == nil || s.SourceID == 0 || strings.TrimSpace(s.RunID) == "" {
		return result, fmt.Errorf("Yike scanner is not configured")
	}
	mode := strings.TrimSpace(s.Mode)
	if mode == "" {
		mode = meta.SourceRunModeScan
	}
	if !meta.ValidSourceRunMode(mode) {
		return result, fmt.Errorf("invalid Yike scanner mode %q", mode)
	}
	if mode == meta.SourceRunModeSync && s.Executor == nil {
		return result, fmt.Errorf("Yike sync executor is not configured")
	}
	matcher, err := sourcepkg.CompileIgnoreRules(s.IgnoreRules)
	if err != nil {
		return result, fmt.Errorf("compile source ignore rules: %w", err)
	}
	info, err := s.Remote.UserInfo(ctx)
	if err != nil {
		return result, fmt.Errorf("read Yike user info: %w", err)
	}
	ownUK, err := strconv.ParseInt(strings.TrimSpace(info.YouaID), 10, 64)
	if err != nil || ownUK <= 0 {
		return result, fmt.Errorf("invalid Yike youa_id %q", info.YouaID)
	}

	batchSize := s.BatchSize
	if batchSize <= 0 || batchSize > DefaultBatchSize {
		batchSize = DefaultBatchSize
	}
	batch := make([]client.SourceObservation, 0, batchSize)
	batchItems := make(map[string]sourcepkg.DiscoveredItem, batchSize)
	batchRefs := make(map[string]TransferRef, batchSize)
	seen := make(map[string]bool)

	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		plans, err := s.API.ObserveSourceItems(ctx, s.SourceID, s.RunID, batch)
		if err != nil {
			return err
		}
		if len(plans) != len(batch) {
			return fmt.Errorf("source plan count mismatch: got %d want %d", len(plans), len(batch))
		}
		planned := make(map[string]struct{}, len(plans))
		commits := make([]client.SourceCommit, 0, len(plans))
		for _, plan := range plans {
			item, ok := batchItems[plan.ExternalID]
			if !ok {
				return fmt.Errorf("server returned plan for unknown external id %q", plan.ExternalID)
			}
			if _, duplicate := planned[plan.ExternalID]; duplicate {
				return fmt.Errorf("server returned duplicate plan for external id %q", plan.ExternalID)
			}
			planned[plan.ExternalID] = struct{}{}
			action := sourcepkg.PlanAction(plan.Action)
			if !validPlanAction(action) {
				return fmt.Errorf("server returned unsupported source action %q", plan.Action)
			}
			result.Summary.Add(sourcepkg.PlanResult{Action: action, Item: item})
			if mode != meta.SourceRunModeSync || !executionAction(action) {
				continue
			}
			if err := s.API.HeartbeatSourceRun(ctx, s.SourceID, s.RunID); err != nil {
				return err
			}
			commit, err := s.Executor.Execute(ctx, plan, item, batchRefs[plan.ExternalID])
			if err != nil {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				result.Summary.AddFailure()
				appendResultError(&result, item.ExternalID, item.Path, err)
				continue
			}
			commits = append(commits, commit)
			if err := s.API.HeartbeatSourceRun(ctx, s.SourceID, s.RunID); err != nil {
				return err
			}
		}
		if len(commits) != 0 {
			if err := s.commitResults(ctx, commits, &result); err != nil {
				return err
			}
		}
		batch = batch[:0]
		clear(batchItems)
		clear(batchRefs)
		return nil
	}

	add := func(ownerUK int64, file yike.File, albumFile *yike.AlbumFile) (string, bool, error) {
		externalID, err := yike.ExternalID(ownerUK, file.FSID)
		if err != nil {
			return "", false, err
		}
		item, err := discoveredItem(ownUK, ownerUK, file)
		if err != nil {
			return "", false, err
		}

		if included, duplicate := seen[externalID]; duplicate {
			result.DuplicateMemberships++
			return externalID, included, nil
		}

		if matcher.Ignored(item.Path, false) {
			seen[externalID] = false
			result.Summary.Add(sourcepkg.PlanResult{Action: sourcepkg.ActionIgnore, Item: item})
			return externalID, false, nil
		}
		seen[externalID] = true
		result.Metadata = append(result.Metadata, metadataSnapshot(ownerUK, file))
		if ownerUK == ownUK {
			result.OwnItems++
		} else {
			result.SharedItems++
		}
		batchItems[item.ExternalID] = item
		ref := TransferRef{OwnUK: ownUK, OwnerUK: ownerUK, File: file}
		if albumFile != nil {
			copy := *albumFile
			ref.AlbumFile = &copy
		}
		batchRefs[item.ExternalID] = ref
		batch = append(batch, client.SourceObservation{
			ExternalID:     item.ExternalID,
			Kind:           item.Kind,
			Path:           item.Path,
			Size:           item.Size,
			ModifiedAt:     item.ModifiedAt,
			RemoteRevision: item.RemoteRevision,
		})
		if len(batch) >= batchSize {
			if err := flush(); err != nil {
				return "", false, err
			}
		}
		return externalID, true, nil
	}

	if err := walkFilePages(ctx,
		func(cursor string) (yike.FileList, error) { return s.Remote.ListFilesPage(ctx, cursor) },
		func(page yike.FileList) error {
			for _, file := range page.List {
				result.RootItems++
				if _, _, err := add(ownUK, file, nil); err != nil {
					return err
				}
			}
			return s.API.HeartbeatSourceRun(ctx, s.SourceID, s.RunID)
		},
	); err != nil {
		return result, fmt.Errorf("scan Yike root library: %w", err)
	}

	albums, err := collectAlbums(ctx, s.Remote, func() error {
		return s.API.HeartbeatSourceRun(ctx, s.SourceID, s.RunID)
	})
	if err != nil {
		return result, fmt.Errorf("scan Yike albums: %w", err)
	}
	result.Albums = int64(len(albums))

	for _, album := range albums {
		collectionID, err := collectionExternalID(album)
		if err != nil {
			return result, fmt.Errorf("invalid Yike album %q: %w", album.Title, err)
		}
		snapshot := sourcecollection.Snapshot{
			ExternalID:     collectionID,
			Kind:           "album",
			Name:           collectionName(album),
			RemoteRevision: collectionRevision(album),
		}
		memberSeen := make(map[string]struct{})
		var position int64
		if err := walkAlbumFilePages(ctx,
			func(cursor string) (yike.AlbumFileList, error) {
				return s.Remote.ListAlbumFilesPage(ctx, album.AlbumID, cursor)
			},
			func(page yike.AlbumFileList) error {
				for _, file := range page.List {
					result.AlbumMemberships++
					ownerUK := file.OwnerUK(ownUK)
					externalID, included, err := add(ownerUK, file.File, &file)
					if err != nil {
						return err
					}
					if included {
						if _, duplicate := memberSeen[externalID]; !duplicate {
							snapshot.Members = append(snapshot.Members, sourcecollection.MemberSnapshot{
								ItemExternalID: externalID,
								Position:       position,
							})
							memberSeen[externalID] = struct{}{}
						}
					}
					position++
				}
				return s.API.HeartbeatSourceRun(ctx, s.SourceID, s.RunID)
			},
		); err != nil {
			return result, fmt.Errorf("scan Yike album %q: %w", album.Title, err)
		}
		result.Collections = append(result.Collections, snapshot)
	}
	if err := flush(); err != nil {
		return result, fmt.Errorf("flush Yike source observations: %w", err)
	}
	return result, nil
}

func (s Scanner) commitResults(ctx context.Context, commits []client.SourceCommit, result *Result) error {
	if err := s.API.CommitSourceItems(ctx, s.SourceID, s.RunID, commits); err == nil {
		return nil
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	for _, commit := range commits {
		if err := s.API.CommitSourceItems(ctx, s.SourceID, s.RunID, []client.SourceCommit{commit}); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			result.Summary.AddFailure()
			appendResultError(result, commit.ExternalID, commit.Path, err)
		}
	}
	return nil
}

func appendResultError(result *Result, externalID, itemPath string, err error) {
	if result == nil || err == nil || len(result.Errors) >= 5 {
		return
	}
	message := fmt.Sprintf("%s (%s): %v", externalID, itemPath, err)
	if len(message) > 1024 {
		message = message[:1024]
	}
	result.Errors = append(result.Errors, message)
}

func metadataSnapshot(ownerUK int64, file yike.File) sourcemetadata.Snapshot {
	var createdAt *time.Time
	if file.CTime > 0 {
		value := time.Unix(file.CTime, 0).UTC()
		createdAt = &value
	}
	thumbnailURL := ""
	for _, candidate := range file.ThumbURL {
		if candidate = strings.TrimSpace(candidate); candidate != "" {
			thumbnailURL = candidate
			break
		}
	}
	externalID, _ := yike.ExternalID(ownerUK, file.FSID)
	return sourcemetadata.Snapshot{
		ItemExternalID:  externalID,
		OriginalPath:    strings.TrimSpace(file.Path),
		OwnerExternalID: strconv.FormatInt(ownerUK, 10),
		RemoteCreatedAt: createdAt,
		ContentMD5:      metadataMD5(file.MD5),
		ThumbnailURL:    thumbnailURL,
	}
}

func metadataMD5(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) != 32 {
		return ""
	}
	if _, err := hex.DecodeString(value); err != nil {
		return ""
	}
	return value
}

func collectionExternalID(album yike.Album) (string, error) {
	albumID := strings.TrimSpace(album.AlbumID)
	if albumID == "" {
		return "", fmt.Errorf("album_id is empty")
	}
	value := "yike:album:" + albumID
	if len([]byte(value)) > 512 {
		return "", fmt.Errorf("album_id is too long")
	}
	return value, nil
}

func collectionName(album yike.Album) string {
	name := strings.TrimSpace(album.Title)
	if name == "" {
		name = "Album " + strings.TrimSpace(album.AlbumID)
	}
	var b strings.Builder
	for _, r := range name {
		if r < 32 {
			b.WriteRune(' ')
			continue
		}
		b.WriteRune(r)
	}
	name = strings.TrimSpace(b.String())
	if name == "" {
		name = "Album " + strings.TrimSpace(album.AlbumID)
	}
	name = trimUTF8Bytes(name, 512)
	if strings.TrimSpace(name) == "" {
		return "Album"
	}
	return name
}

func collectionRevision(album yike.Album) string {
	return fmt.Sprintf("tid:%d:mtime:%d:join:%d", album.TID, album.MTime, album.JoinTime)
}

func discoveredItem(ownUK, ownerUK int64, file yike.File) (sourcepkg.DiscoveredItem, error) {
	externalID, err := yike.ExternalID(ownerUK, file.FSID)
	if err != nil {
		return sourcepkg.DiscoveredItem{}, err
	}
	modified := file.ModifiedAt()
	name := canonicalFileName(file.Path, file.FSID)
	prefix := "Library"
	if ownerUK != ownUK {
		prefix = path.Join("Shared", strconv.FormatInt(ownerUK, 10))
	}
	revision := ""
	if md5 := strings.ToLower(strings.TrimSpace(file.MD5)); md5 != "" {
		revision = "md5:" + md5
	}
	item := sourcepkg.DiscoveredItem{
		ExternalID:     externalID,
		Kind:           meta.SourceItemKindFile,
		Path:           path.Join(prefix, name),
		Size:           file.Size,
		ModifiedAt:     &modified,
		RemoteRevision: revision,
	}
	if err := sourcepkg.ValidateDiscoveredItem(&item); err != nil {
		return sourcepkg.DiscoveredItem{}, err
	}
	return item, nil
}

func canonicalFileName(remotePath string, fsid int64) string {
	remotePath = strings.ReplaceAll(strings.TrimSpace(remotePath), "\\", "/")
	base := path.Base(remotePath)
	if base == "." || base == "/" || base == "" {
		base = "file"
	}
	var b strings.Builder
	for _, r := range base {
		switch {
		case r < 32:
			b.WriteRune('_')
		case strings.ContainsRune("<>:\"/\\\\|?*", r):
			b.WriteRune('_')
		default:
			b.WriteRune(r)
		}
	}
	clean := strings.TrimRight(b.String(), " .")
	if clean == "" {
		clean = "file"
	}
	suffix := " [" + strconv.FormatInt(fsid, 10) + "]"
	maxBaseBytes := 255 - len([]byte(suffix))
	clean = trimUTF8Bytes(clean, maxBaseBytes)
	candidate := clean + suffix
	if err := meta.ValidateName(candidate); err != nil {
		candidate = "file-" + strconv.FormatInt(fsid, 10)
	}
	return candidate
}

func trimUTF8Bytes(value string, maxBytes int) string {
	if maxBytes <= 0 {
		return ""
	}
	if len([]byte(value)) <= maxBytes {
		return value
	}
	for len(value) > 0 && len([]byte(value)) > maxBytes {
		_, size := utf8.DecodeLastRuneInString(value)
		if size <= 0 {
			break
		}
		value = value[:len(value)-size]
	}
	return value
}

func validPlanAction(action sourcepkg.PlanAction) bool {
	switch action {
	case sourcepkg.ActionIgnore, sourcepkg.ActionUnchanged, sourcepkg.ActionCreate,
		sourcepkg.ActionUpdate, sourcepkg.ActionMove, sourcepkg.ActionMoveUpdate:
		return true
	default:
		return false
	}
}

func walkFilePages(
	ctx context.Context,
	fetch func(string) (yike.FileList, error),
	consume func(yike.FileList) error,
) error {
	cursor := ""
	seen := map[string]struct{}{}
	for pageNo := 0; pageNo < 100000; pageNo++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		page, err := fetch(cursor)
		if err != nil {
			return err
		}
		if err := consume(page); err != nil {
			return err
		}
		if !page.HasNext() {
			return nil
		}
		next := strings.TrimSpace(page.Cursor)
		if next == "" {
			return fmt.Errorf("Yike pagination has_more=1 but cursor is empty")
		}
		if _, duplicate := seen[next]; duplicate {
			return fmt.Errorf("Yike pagination cursor repeated")
		}
		seen[next] = struct{}{}
		cursor = next
	}
	return fmt.Errorf("Yike pagination exceeded safety limit")
}

func walkAlbumFilePages(
	ctx context.Context,
	fetch func(string) (yike.AlbumFileList, error),
	consume func(yike.AlbumFileList) error,
) error {
	cursor := ""
	seen := map[string]struct{}{}
	for pageNo := 0; pageNo < 100000; pageNo++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		page, err := fetch(cursor)
		if err != nil {
			return err
		}
		if err := consume(page); err != nil {
			return err
		}
		if !page.HasNext() {
			return nil
		}
		next := strings.TrimSpace(page.Cursor)
		if next == "" {
			return fmt.Errorf("Yike album-file pagination has_more=1 but cursor is empty")
		}
		if _, duplicate := seen[next]; duplicate {
			return fmt.Errorf("Yike album-file pagination cursor repeated")
		}
		seen[next] = struct{}{}
		cursor = next
	}
	return fmt.Errorf("Yike album-file pagination exceeded safety limit")
}

func collectAlbums(ctx context.Context, remote Remote, heartbeat func() error) ([]yike.Album, error) {
	cursor := ""
	seen := map[string]struct{}{}
	var out []yike.Album
	for pageNo := 0; pageNo < 100000; pageNo++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		page, err := remote.ListAlbumsPage(ctx, cursor)
		if err != nil {
			return nil, err
		}
		out = append(out, page.List...)
		if err := heartbeat(); err != nil {
			return nil, err
		}
		if !page.HasNext() {
			return out, nil
		}
		next := strings.TrimSpace(page.Cursor)
		if next == "" {
			return nil, fmt.Errorf("Yike album pagination has_more=1 but cursor is empty")
		}
		if _, duplicate := seen[next]; duplicate {
			return nil, fmt.Errorf("Yike album pagination cursor repeated")
		}
		seen[next] = struct{}{}
		cursor = next
	}
	return nil, fmt.Errorf("Yike album pagination exceeded safety limit")
}
