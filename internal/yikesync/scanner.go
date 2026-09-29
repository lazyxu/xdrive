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
	"github.com/lazyxu/xdrive/internal/pullsync"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"github.com/lazyxu/xdrive/internal/sourcecollection"
	"github.com/lazyxu/xdrive/internal/sourcemetadata"
	"github.com/lazyxu/xdrive/internal/yike"
)

const (
	SourceKind               = "yike_photos"
	DefaultBatchSize         = 500
	DefaultSyncBatchSize     = 100
	DefaultTransferQueueSize = 64
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
	FailSourceItems(context.Context, uint64, string, []client.SourceFailure) error
	UpdateSourceRunSummary(context.Context, uint64, string, sourcepkg.Summary) error
	HeartbeatSourceRun(context.Context, uint64, string) error
}

type sourceItemLister interface {
	SourceItems(context.Context, uint64, string, int, int) ([]client.SourceItem, error)
}

type targetNodeLister interface {
	List(context.Context, uint64) ([]client.Node, error)
}

type PlanExecutor interface {
	Execute(context.Context, client.SourcePlan, sourcepkg.DiscoveredItem, TransferRef) (client.SourceCommit, error)
}

type Scanner struct {
	Remote            Remote
	API               SourceAPI
	SourceID          uint64
	RunID             string
	TargetNodeID      uint64
	IgnoreRules       string
	Mode              string
	Executor          PlanExecutor
	BatchSize         int
	TransferQueueSize int
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
	if batchSize <= 0 {
		if mode == meta.SourceRunModeSync {
			batchSize = DefaultSyncBatchSize
		} else {
			batchSize = DefaultBatchSize
		}
	}
	if batchSize > DefaultBatchSize {
		batchSize = DefaultBatchSize
	}
	batch := make([]client.SourceObservation, 0, batchSize)
	batchItems := make(map[string]sourcepkg.DiscoveredItem, batchSize)
	batchRefs := make(map[string]TransferRef, batchSize)
	seen := make(map[string]bool)
	pathOwners := make(map[string]string)
	if lister, ok := s.API.(sourceItemLister); ok {
		if err := seedYikePathOwners(ctx, lister, s.SourceID, pathOwners); err != nil {
			return result, fmt.Errorf("read existing Yike source paths: %w", err)
		}
	}
	if s.TargetNodeID != 0 {
		if lister, ok := s.API.(targetNodeLister); ok {
			if err := seedYikeTargetChildren(ctx, lister, s.TargetNodeID, pathOwners); err != nil {
				return result, fmt.Errorf("read existing Yike target names: %w", err)
			}
		}
	}

	var pipeline *pullsync.Pipeline[TransferRef]
	if mode == meta.SourceRunModeSync {
		queueSize := s.TransferQueueSize
		if queueSize <= 0 {
			queueSize = DefaultTransferQueueSize
		}
		pipeline = pullsync.NewPipeline(ctx, queueSize, "Yike", s.SourceID, s.RunID, s.API, s.Executor)
		defer pipeline.Abort()
	}

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
		transfers := make([]pullsync.Task[TransferRef], 0, len(plans))
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
			if mode == meta.SourceRunModeSync && pullsync.ExecutionAction(action) {
				transfers = append(transfers, pullsync.Task[TransferRef]{
					Plan: plan,
					Item: item,
					Ref:  batchRefs[plan.ExternalID],
				})
			}
		}
		if err := s.API.UpdateSourceRunSummary(ctx, s.SourceID, s.RunID, result.Summary); err != nil {
			return err
		}
		for _, task := range transfers {
			if err := pipeline.Submit(task.Plan, task.Item, task.Ref); err != nil {
				return err
			}
		}
		batch = batch[:0]
		clear(batchItems)
		clear(batchRefs)
		return nil
	}

	finishPage := func() error {
		if mode == meta.SourceRunModeSync {
			if err := flush(); err != nil {
				return err
			}
		}
		return s.API.HeartbeatSourceRun(ctx, s.SourceID, s.RunID)
	}

	add := func(ownerUK int64, file yike.File, albumFile *yike.AlbumFile) (string, bool, error) {
		externalID, err := yike.ExternalID(ownerUK, file.FSID)
		if err != nil {
			return "", false, err
		}
		item, err := discoveredItem(ownerUK, file)
		if err != nil {
			return "", false, err
		}

		if included, duplicate := seen[externalID]; duplicate {
			result.DuplicateMemberships++
			return externalID, included, nil
		}

		// Match both the current visible path and the old xDrive-only
		// Library/Shared+[fsid] alias so existing ignore rules keep working.
		if matcher.Ignored(item.Path, false) || matcher.Ignored(legacyYikeIgnorePath(ownUK, ownerUK, file), false) {
			seen[externalID] = false
			result.Summary.Add(sourcepkg.PlanResult{Action: sourcepkg.ActionIgnore, Item: item})
			return externalID, false, nil
		}
		item.Path = reserveYikePath(item.Path, ownerUK, file.FSID, externalID, pathOwners)
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
			return finishPage()
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
				return finishPage()
			},
		); err != nil {
			return result, fmt.Errorf("scan Yike album %q: %w", album.Title, err)
		}
		result.Collections = append(result.Collections, snapshot)
	}
	if err := flush(); err != nil {
		return result, fmt.Errorf("flush Yike source observations: %w", err)
	}
	if pipeline != nil {
		worker := pipeline.Finish()
		result.Summary.FailedItems += worker.Summary.FailedItems
		for _, message := range worker.Errors {
			if len(result.Errors) >= 5 {
				break
			}
			result.Errors = append(result.Errors, message)
		}
		if worker.Err != nil {
			return result, fmt.Errorf("execute Yike source transfers: %w", worker.Err)
		}
	}
	if err := s.API.UpdateSourceRunSummary(ctx, s.SourceID, s.RunID, result.Summary); err != nil {
		return result, fmt.Errorf("report Yike source progress: %w", err)
	}
	return result, nil
}

func metadataSnapshot(ownerUK int64, file yike.File) sourcemetadata.Snapshot {
	var capturedAt *time.Time
	if file.ShootTime > 0 {
		value := time.Unix(file.ShootTime, 0).UTC()
		capturedAt = &value
	}
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
		CapturedAt:      capturedAt,
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

func discoveredItem(ownerUK int64, file yike.File) (sourcepkg.DiscoveredItem, error) {
	externalID, err := yike.ExternalID(ownerUK, file.FSID)
	if err != nil {
		return sourcepkg.DiscoveredItem{}, err
	}
	modified := file.ModifiedAt()
	remotePath := canonicalRemotePath(file)
	revision := ""
	if md5 := strings.ToLower(strings.TrimSpace(file.MD5)); md5 != "" {
		revision = "md5:" + md5
	}
	item := sourcepkg.DiscoveredItem{
		ExternalID:     externalID,
		Kind:           meta.SourceItemKindFile,
		Path:           remotePath,
		Size:           file.Size,
		ModifiedAt:     &modified,
		RemoteRevision: revision,
	}
	if err := sourcepkg.ValidateDiscoveredItem(&item); err != nil {
		return sourcepkg.DiscoveredItem{}, err
	}
	return item, nil
}

// canonicalRemotePath returns the user-visible Yike filename only. The path
// directory component is an internal Yike/Baidu namespace rather than a
// user-visible folder hierarchy, so xDrive must not expose it as directories.
func canonicalRemotePath(file yike.File) string {
	return canonicalYikeFileName(file.VisibleName(), "file-"+strconv.FormatInt(file.FSID, 10))
}

func seedYikePathOwners(ctx context.Context, lister sourceItemLister, sourceID uint64, owners map[string]string) error {
	const pageSize = 1000
	for offset := 0; ; offset += pageSize {
		items, err := lister.SourceItems(ctx, sourceID, "", pageSize, offset)
		if err != nil {
			return err
		}
		for _, item := range items {
			if item.NodeID == nil || item.ExternalID == "" {
				continue
			}
			clean, err := sourcepkg.NormalizeRelativePath(item.Path)
			if err != nil || strings.Contains(clean, "/") {
				continue
			}
			key := strings.ToLower(clean)
			if _, exists := owners[key]; !exists {
				owners[key] = item.ExternalID
			}
		}
		if len(items) < pageSize {
			return nil
		}
	}
}

func seedYikeTargetChildren(ctx context.Context, lister targetNodeLister, targetNodeID uint64, owners map[string]string) error {
	children, err := lister.List(ctx, targetNodeID)
	if err != nil {
		return err
	}
	for _, node := range children {
		name := strings.TrimSpace(node.Name)
		if name == "" {
			continue
		}
		key := strings.ToLower(name)
		if _, exists := owners[key]; !exists {
			owners[key] = "node:" + strconv.FormatUint(node.ID, 10)
		}
	}
	return nil
}

func reserveYikePath(preferred string, ownerUK, fsid int64, externalID string, owners map[string]string) string {
	if owners == nil {
		return preferred
	}
	key := strings.ToLower(preferred)
	if current, exists := owners[key]; !exists || current == externalID {
		owners[key] = externalID
		return preferred
	}

	for attempt := 0; ; attempt++ {
		candidate := collisionYikeFileName(preferred, ownerUK, fsid, attempt)
		candidateKey := strings.ToLower(candidate)
		if current, exists := owners[candidateKey]; !exists || current == externalID {
			owners[candidateKey] = externalID
			return candidate
		}
	}
}

func collisionYikeFileName(preferred string, ownerUK, fsid int64, attempt int) string {
	ext := path.Ext(preferred)
	stem := strings.TrimSuffix(preferred, ext)
	suffix := " (" + strconv.FormatInt(fsid, 10) + ")"
	if attempt > 0 {
		suffix = " (" + strconv.FormatInt(ownerUK, 10) + "-" + strconv.FormatInt(fsid, 10)
		if attempt > 1 {
			suffix += "-" + strconv.Itoa(attempt)
		}
		suffix += ")"
	}
	maxStemBytes := 255 - len([]byte(ext)) - len([]byte(suffix))
	if maxStemBytes < 1 {
		ext = ""
		maxStemBytes = 255 - len([]byte(suffix))
	}
	stem = trimUTF8Bytes(stem, maxStemBytes)
	candidate := stem + suffix + ext
	if err := meta.ValidateName(candidate); err == nil {
		return candidate
	}
	return canonicalYikeFileName(
		"file-"+strconv.FormatInt(ownerUK, 10)+"-"+strconv.FormatInt(fsid, 10)+"-"+strconv.Itoa(attempt+1)+ext,
		"file-"+strconv.FormatInt(fsid, 10),
	)
}

func legacyYikeIgnorePath(ownUK, ownerUK int64, file yike.File) string {
	name := legacyYikeFileName(file.Path, file.FSID)
	if ownerUK == ownUK {
		return path.Join("Library", name)
	}
	return path.Join("Shared", strconv.FormatInt(ownerUK, 10), name)
}

func legacyYikeFileName(remotePath string, fsid int64) string {
	remotePath = strings.ReplaceAll(strings.TrimSpace(remotePath), "\\", "/")
	base := path.Base(remotePath)
	if base == "." || base == "/" || base == "" {
		base = "file"
	}
	clean := canonicalYikeFileName(base, "file")
	suffix := " [" + strconv.FormatInt(fsid, 10) + "]"
	clean = trimUTF8Bytes(clean, 255-len([]byte(suffix)))
	candidate := clean + suffix
	if err := meta.ValidateName(candidate); err != nil {
		return "file-" + strconv.FormatInt(fsid, 10)
	}
	return candidate
}

func canonicalYikeFileName(value, fallback string) string {
	var b strings.Builder
	for _, r := range value {
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
	if clean == "" || clean == "." || clean == ".." {
		clean = fallback
	}

	preserveExtension := func(name string, maxBytes int) string {
		if len([]byte(name)) <= maxBytes {
			return name
		}
		ext := path.Ext(name)
		if ext == "" || len([]byte(ext)) >= maxBytes {
			return trimUTF8Bytes(name, maxBytes)
		}
		stem := strings.TrimSuffix(name, ext)
		return trimUTF8Bytes(stem, maxBytes-len([]byte(ext))) + ext
	}

	clean = preserveExtension(clean, 255)
	if err := meta.ValidateName(clean); err == nil {
		return clean
	}

	// Reserved Windows basenames such as CON.jpg cannot be represented by the
	// shared CfAPI/FUSE namespace. Prefixing "_" is the smallest safe change.
	clean = preserveExtension("_"+clean, 255)
	if err := meta.ValidateName(clean); err == nil {
		return clean
	}
	return preserveExtension(fallback, 255)
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
		next := strings.TrimSpace(string(page.Cursor))
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
		next := strings.TrimSpace(string(page.Cursor))
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
		next := strings.TrimSpace(string(page.Cursor))
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
