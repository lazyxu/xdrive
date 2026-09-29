package synologysync

import (
	"context"
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
	"github.com/lazyxu/xdrive/internal/synology"
)

const (
	SourceKind               = "synology_photos"
	DefaultBatchSize         = 500
	DefaultSyncBatchSize     = 100
	DefaultTransferQueueSize = 64
)

type Remote interface {
	Available(synology.Space) bool
	AlbumsAvailable(synology.Space) bool
	ListFoldersPage(context.Context, synology.Space, int, int) (synology.FolderPage, error)
	ListItemsPage(context.Context, synology.Space, int, int) (synology.ItemPage, error)
	ListAlbumsPage(context.Context, synology.Space, int, int) (synology.AlbumPage, error)
	ListAlbumItemsPage(context.Context, synology.Space, int64, int, int) (synology.ItemPage, error)
}

type SourceAPI interface {
	pullsync.RunAPI
	ObserveSourceItems(context.Context, uint64, string, []client.SourceObservation) ([]client.SourcePlan, error)
	UpdateSourceRunSummary(context.Context, uint64, string, sourcepkg.Summary) error
}

type sourceItemLister interface {
	SourceItems(context.Context, uint64, string, int, int) ([]client.SourceItem, error)
}

type PlanExecutor interface {
	Execute(context.Context, client.SourcePlan, sourcepkg.DiscoveredItem, TransferRef) (client.SourceCommit, error)
}

type TransferRef struct {
	Item synology.Item
}

type Scanner struct {
	Remote            Remote
	API               SourceAPI
	SourceID          uint64
	RunID             string
	IgnoreRules       string
	Mode              string
	Spaces            []synology.Space
	Executor          PlanExecutor
	BatchSize         int
	TransferQueueSize int
}

type Result struct {
	Summary              sourcepkg.Summary
	Collections          []sourcecollection.Snapshot
	CollectionsComplete  bool
	Metadata             []sourcemetadata.Snapshot
	PersonalItems        int64
	SharedItems          int64
	Folders              int64
	Albums               int64
	AlbumMemberships     int64
	DuplicateMemberships int64
	Errors               []string
}

func (s Scanner) Scan(ctx context.Context) (Result, error) {
	var result Result
	if s.Remote == nil || s.API == nil || s.SourceID == 0 || strings.TrimSpace(s.RunID) == "" {
		return result, fmt.Errorf("Synology scanner is not configured")
	}
	mode := strings.TrimSpace(s.Mode)
	if mode == "" {
		mode = meta.SourceRunModeScan
	}
	if !meta.ValidSourceRunMode(mode) {
		return result, fmt.Errorf("invalid Synology scanner mode %q", mode)
	}
	if mode == meta.SourceRunModeSync && s.Executor == nil {
		return result, fmt.Errorf("Synology sync executor is not configured")
	}
	spaces, err := normalizeSpaces(s.Spaces)
	if err != nil {
		return result, err
	}
	for _, space := range spaces {
		if !s.Remote.Available(space) {
			return result, fmt.Errorf("Synology %s space is selected but unavailable", space)
		}
	}
	matcher, err := sourcepkg.CompileIgnoreRules(s.IgnoreRules)
	if err != nil {
		return result, fmt.Errorf("compile source ignore rules: %w", err)
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
	pathOwners := make(map[string]string)
	includedExternalIDs := make(map[string]struct{})
	if lister, ok := s.API.(sourceItemLister); ok {
		if err := seedSynologyPathOwners(ctx, lister, s.SourceID, pathOwners); err != nil {
			return result, fmt.Errorf("read existing Synology source paths: %w", err)
		}
	}

	var pipeline *pullsync.Pipeline[TransferRef]
	if mode == meta.SourceRunModeSync {
		queueSize := s.TransferQueueSize
		if queueSize <= 0 {
			queueSize = DefaultTransferQueueSize
		}
		pipeline = pullsync.NewPipeline(ctx, queueSize, "Synology", s.SourceID, s.RunID, s.API, s.Executor)
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

	for _, space := range spaces {
		folders, err := collectFolders(ctx, s.Remote, space, func() error {
			return s.API.HeartbeatSourceRun(ctx, s.SourceID, s.RunID)
		})
		if err != nil {
			return result, fmt.Errorf("scan Synology %s folders: %w", space, err)
		}
		result.Folders += int64(len(folders))
		folderPaths := buildFolderPaths(folders)

		offset := 0
		for pageNo := 0; pageNo < 100000; pageNo++ {
			if err := ctx.Err(); err != nil {
				return result, err
			}
			page, err := s.Remote.ListItemsPage(ctx, space, offset, DefaultBatchSize)
			if err != nil {
				return result, fmt.Errorf("scan Synology %s items: %w", space, err)
			}
			for _, remoteItem := range page.List {
				item, err := discoveredItem(space, folderPaths, remoteItem)
				if err != nil {
					return result, err
				}
				if matcher.Ignored(item.Path, false) {
					result.Summary.Add(sourcepkg.PlanResult{Action: sourcepkg.ActionIgnore, Item: item})
					continue
				}
				item.Path = reserveSynologyPath(item.Path, remoteItem.ID, item.ExternalID, pathOwners)
				includedExternalIDs[item.ExternalID] = struct{}{}
				if space == synology.SpacePersonal {
					result.PersonalItems++
				} else {
					result.SharedItems++
				}
				result.Metadata = append(result.Metadata, metadataSnapshot(space, folderPaths, remoteItem))
				batchItems[item.ExternalID] = item
				batchRefs[item.ExternalID] = TransferRef{Item: remoteItem}
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
						return result, err
					}
				}
			}
			if err := finishPage(); err != nil {
				return result, err
			}
			next, done, err := nextOffset(offset, page.Offset, page.Total, len(page.List))
			if err != nil {
				return result, fmt.Errorf("scan Synology %s items: %w", space, err)
			}
			if done {
				break
			}
			offset = next
		}
	}

	result.CollectionsComplete = true
	for _, space := range spaces {
		if !s.Remote.AlbumsAvailable(space) {
			result.CollectionsComplete = false
			break
		}
	}
	if result.CollectionsComplete {
		for _, space := range spaces {
			albums, err := collectAlbums(ctx, s.Remote, space, func() error {
				return s.API.HeartbeatSourceRun(ctx, s.SourceID, s.RunID)
			})
			if err != nil {
				return result, fmt.Errorf("scan Synology %s albums: %w", space, err)
			}
			result.Albums += int64(len(albums))
			for _, album := range albums {
				if album.ID <= 0 {
					return result, fmt.Errorf("invalid Synology %s album id=%d", space, album.ID)
				}
				snapshot := sourcecollection.Snapshot{
					ExternalID:     albumCollectionExternalID(space, album.ID),
					Kind:           "album",
					Name:           albumCollectionName(album),
					RemoteRevision: albumCollectionRevision(album),
				}
				memberSeen := make(map[string]struct{})
				position := int64(0)
				offset := 0
				for pageNo := 0; pageNo < 100000; pageNo++ {
					if err := ctx.Err(); err != nil {
						return result, err
					}
					page, err := s.Remote.ListAlbumItemsPage(ctx, space, album.ID, offset, DefaultBatchSize)
					if err != nil {
						return result, fmt.Errorf("scan Synology %s album %q items: %w", space, album.Name, err)
					}
					for _, remoteItem := range page.List {
						result.AlbumMemberships++
						externalID := fmt.Sprintf("synology:%s:%d", space, remoteItem.ID)
						if _, included := includedExternalIDs[externalID]; included {
							if _, duplicate := memberSeen[externalID]; duplicate {
								result.DuplicateMemberships++
							} else {
								snapshot.Members = append(snapshot.Members, sourcecollection.MemberSnapshot{
									ItemExternalID: externalID,
									Position:       position,
								})
								memberSeen[externalID] = struct{}{}
							}
						}
						position++
					}
					if err := s.API.HeartbeatSourceRun(ctx, s.SourceID, s.RunID); err != nil {
						return result, err
					}
					next, done, err := nextOffset(offset, page.Offset, page.Total, len(page.List))
					if err != nil {
						return result, fmt.Errorf("scan Synology %s album %q items: %w", space, album.Name, err)
					}
					if done {
						break
					}
					offset = next
				}
				result.Collections = append(result.Collections, snapshot)
			}
		}
	}

	if err := flush(); err != nil {
		return result, fmt.Errorf("flush Synology source observations: %w", err)
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
			return result, fmt.Errorf("execute Synology source transfers: %w", worker.Err)
		}
	}
	if err := s.API.UpdateSourceRunSummary(ctx, s.SourceID, s.RunID, result.Summary); err != nil {
		return result, fmt.Errorf("report Synology source progress: %w", err)
	}
	return result, nil
}

func normalizeSpaces(input []synology.Space) ([]synology.Space, error) {
	if len(input) == 0 {
		return []synology.Space{synology.SpacePersonal, synology.SpaceShared}, nil
	}
	seen := map[synology.Space]bool{}
	for _, space := range input {
		switch space {
		case synology.SpacePersonal, synology.SpaceShared:
			seen[space] = true
		default:
			return nil, fmt.Errorf("unsupported Synology space %q", space)
		}
	}
	out := make([]synology.Space, 0, len(seen))
	if seen[synology.SpacePersonal] {
		out = append(out, synology.SpacePersonal)
	}
	if seen[synology.SpaceShared] {
		out = append(out, synology.SpaceShared)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("at least one Synology space is required")
	}
	return out, nil
}

func collectFolders(ctx context.Context, remote Remote, space synology.Space, heartbeat func() error) (map[int64]synology.Folder, error) {
	out := make(map[int64]synology.Folder)
	offset := 0
	for pageNo := 0; pageNo < 100000; pageNo++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		page, err := remote.ListFoldersPage(ctx, space, offset, DefaultBatchSize)
		if err != nil {
			return nil, err
		}
		for _, folder := range page.List {
			if folder.ID > 0 {
				out[folder.ID] = folder
			}
		}
		if err := heartbeat(); err != nil {
			return nil, err
		}
		next, done, err := nextOffset(offset, page.Offset, page.Total, len(page.List))
		if err != nil {
			return nil, err
		}
		if done {
			return out, nil
		}
		offset = next
	}
	return nil, fmt.Errorf("Synology folder pagination exceeded safety limit")
}

func collectAlbums(ctx context.Context, remote Remote, space synology.Space, heartbeat func() error) ([]synology.Album, error) {
	var out []synology.Album
	offset := 0
	for pageNo := 0; pageNo < 100000; pageNo++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		page, err := remote.ListAlbumsPage(ctx, space, offset, DefaultBatchSize)
		if err != nil {
			return nil, err
		}
		out = append(out, page.List...)
		if err := heartbeat(); err != nil {
			return nil, err
		}
		next, done, err := nextOffset(offset, page.Offset, page.Total, len(page.List))
		if err != nil {
			return nil, err
		}
		if done {
			return out, nil
		}
		offset = next
	}
	return nil, fmt.Errorf("Synology album pagination exceeded safety limit")
}

func albumCollectionExternalID(space synology.Space, albumID int64) string {
	return fmt.Sprintf("synology:album:%s:%d", space, albumID)
}

func albumCollectionName(album synology.Album) string {
	name := strings.TrimSpace(album.Name)
	if name == "" {
		name = "Album " + strconv.FormatInt(album.ID, 10)
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
		name = "Album " + strconv.FormatInt(album.ID, 10)
	}
	return trimUTF8Bytes(name, 512)
}

func albumCollectionRevision(album synology.Album) string {
	return fmt.Sprintf("type:%s:created:%d:count:%d:shared:%t",
		strings.TrimSpace(album.Type), album.CreateTime, album.ItemCount, album.Shared)
}

func nextOffset(requested, returned, total, count int) (int, bool, error) {
	if count == 0 {
		if total <= requested {
			return requested, true, nil
		}
		return 0, false, fmt.Errorf("pagination returned no entries before total=%d", total)
	}
	base := returned
	if base < requested {
		base = requested
	}
	next := base + count
	if next <= requested {
		return 0, false, fmt.Errorf("pagination did not advance")
	}
	if total > 0 && next >= total {
		return next, true, nil
	}
	return next, false, nil
}

func buildFolderPaths(folders map[int64]synology.Folder) map[int64]string {
	out := make(map[int64]string, len(folders))
	siblings := make(map[int64]map[string][]int64)
	for id, folder := range folders {
		segment := sanitizeSegment(folder.Name, id, false)
		key := strings.ToLower(segment)
		if siblings[folder.Parent] == nil {
			siblings[folder.Parent] = make(map[string][]int64)
		}
		siblings[folder.Parent][key] = append(siblings[folder.Parent][key], id)
	}
	var resolve func(int64, map[int64]bool) string
	resolve = func(id int64, stack map[int64]bool) string {
		if value, ok := out[id]; ok {
			return value
		}
		folder, ok := folders[id]
		if !ok || id <= 0 || stack[id] {
			return ""
		}
		stack[id] = true
		segment := sanitizeSegment(folder.Name, id, false)
		if ids := siblings[folder.Parent][strings.ToLower(segment)]; len(ids) > 1 {
			segment = appendStableSuffix(segment, id)
		}
		parent := ""
		if folder.Parent > 0 {
			parent = resolve(folder.Parent, stack)
		}
		delete(stack, id)
		if parent == "" {
			out[id] = segment
		} else {
			out[id] = path.Join(parent, segment)
		}
		return out[id]
	}
	for id := range folders {
		resolve(id, make(map[int64]bool))
	}
	return out
}

func discoveredItem(space synology.Space, folderPaths map[int64]string, remote synology.Item) (sourcepkg.DiscoveredItem, error) {
	if remote.ID <= 0 || remote.Filesize < 0 {
		return sourcepkg.DiscoveredItem{}, fmt.Errorf("invalid Synology Photos item id=%d size=%d", remote.ID, remote.Filesize)
	}
	prefix := "Personal"
	if space == synology.SpaceShared {
		prefix = "Shared"
	}
	parent := strings.Trim(folderPaths[remote.FolderID], "/")
	name := sanitizeSegment(remote.Filename, remote.ID, false)
	relative := path.Join(prefix, parent, name)
	modified := indexedTime(remote.IndexedTime)
	externalID := fmt.Sprintf("synology:%s:%d", space, remote.ID)
	item := sourcepkg.DiscoveredItem{
		ExternalID:     externalID,
		Kind:           meta.SourceItemKindFile,
		Path:           relative,
		Size:           remote.Filesize,
		ModifiedAt:     &modified,
		RemoteRevision: remoteRevision(remote),
	}
	if err := sourcepkg.ValidateDiscoveredItem(&item); err != nil {
		return sourcepkg.DiscoveredItem{}, err
	}
	return item, nil
}

func metadataSnapshot(space synology.Space, folderPaths map[int64]string, item synology.Item) sourcemetadata.Snapshot {
	var capturedAt *time.Time
	if item.Time > 0 {
		value := time.Unix(item.Time, 0).UTC()
		capturedAt = &value
	}
	original := path.Join(folderPaths[item.FolderID], item.Filename)
	return sourcemetadata.Snapshot{
		ItemExternalID:  fmt.Sprintf("synology:%s:%d", space, item.ID),
		OriginalPath:    strings.Trim(original, "/"),
		OwnerExternalID: strconv.FormatInt(item.OwnerUserID, 10),
		CapturedAt:      capturedAt,
	}
}

func seedSynologyPathOwners(ctx context.Context, lister sourceItemLister, sourceID uint64, owners map[string]string) error {
	const pageSize = 1000
	for offset := 0; ; offset += pageSize {
		items, err := lister.SourceItems(ctx, sourceID, "", pageSize, offset)
		if err != nil {
			return err
		}
		for _, item := range items {
			if item.NodeID == nil || strings.TrimSpace(item.ExternalID) == "" {
				continue
			}
			clean, err := sourcepkg.NormalizeRelativePath(item.Path)
			if err != nil {
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

func reserveSynologyPath(preferred string, itemID int64, externalID string, owners map[string]string) string {
	if owners == nil {
		return preferred
	}
	key := strings.ToLower(preferred)
	if current, exists := owners[key]; !exists || current == externalID {
		owners[key] = externalID
		return preferred
	}
	for attempt := 0; ; attempt++ {
		candidate := collisionSynologyPath(preferred, itemID, attempt)
		candidateKey := strings.ToLower(candidate)
		if current, exists := owners[candidateKey]; !exists || current == externalID {
			owners[candidateKey] = externalID
			return candidate
		}
	}
}

func collisionSynologyPath(preferred string, itemID int64, attempt int) string {
	dir := path.Dir(preferred)
	if dir == "." {
		dir = ""
	}
	base := path.Base(preferred)
	ext := path.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	suffix := " (" + strconv.FormatInt(itemID, 10) + ")"
	if attempt > 0 {
		suffix = " (" + strconv.FormatInt(itemID, 10) + "-" + strconv.Itoa(attempt+1) + ")"
	}
	maxStemBytes := 255 - len([]byte(ext)) - len([]byte(suffix))
	if maxStemBytes < 1 {
		ext = ""
		maxStemBytes = 255 - len([]byte(suffix))
	}
	stem = trimUTF8Bytes(stem, maxStemBytes)
	candidate := stem + suffix + ext
	if err := meta.ValidateName(candidate); err != nil {
		candidate = "item-" + strconv.FormatInt(itemID, 10) + suffix + ext
		candidate = trimUTF8Bytes(candidate, 255)
	}
	if dir == "" {
		return candidate
	}
	return path.Join(dir, candidate)
}

func indexedTime(value int64) time.Time {
	if value <= 0 {
		return time.Unix(0, 0).UTC()
	}
	if value > 10_000_000_000 {
		return time.UnixMilli(value).UTC()
	}
	return time.Unix(value, 0).UTC()
}

func remoteRevision(item synology.Item) string {
	cacheKey := item.CacheKey()
	if cacheKey != "" {
		return fmt.Sprintf("cache:%s:size:%d", trimUTF8Bytes(cacheKey, 180), item.Filesize)
	}
	return fmt.Sprintf("indexed:%d:size:%d", item.IndexedTime, item.Filesize)
}

func sanitizeSegment(value string, id int64, stableSuffix bool) string {
	// Synology folder names and filenames are already single path segments.
	// Treat slash/backslash as unrepresentable characters instead of parsing
	// them as a second hierarchy, and preserve representable leading spaces.
	if value == "" {
		value = "item"
	}
	var b strings.Builder
	for _, r := range value {
		switch {
		case r < 32:
			b.WriteRune('_')
		case strings.ContainsRune("<>:\"/\\|?*", r):
			b.WriteRune('_')
		default:
			b.WriteRune(r)
		}
	}
	clean := strings.TrimRight(b.String(), " .")
	if clean == "" || clean == "." || clean == ".." {
		clean = "item"
	}
	if stableSuffix {
		return appendStableSuffix(clean, id)
	}
	clean = trimSegmentPreserveExtension(clean, 255)
	if err := meta.ValidateName(clean); err != nil {
		prefixed := trimSegmentPreserveExtension("_"+clean, 255)
		if err := meta.ValidateName(prefixed); err == nil {
			return prefixed
		}
		return appendStableSuffix("folder", id)
	}
	return clean
}

func appendStableSuffix(value string, id int64) string {
	suffix := " [" + strconv.FormatInt(id, 10) + "]"
	value = trimUTF8Bytes(strings.TrimRight(value, " ."), 255-len([]byte(suffix)))
	if value == "" {
		value = "item"
	}
	candidate := value + suffix
	if err := meta.ValidateName(candidate); err != nil {
		candidate = "item-" + strconv.FormatInt(id, 10)
	}
	return candidate
}

func trimSegmentPreserveExtension(value string, maxBytes int) string {
	if len([]byte(value)) <= maxBytes {
		return value
	}
	ext := path.Ext(value)
	if ext == "" || len([]byte(ext)) >= maxBytes {
		return trimUTF8Bytes(value, maxBytes)
	}
	stem := strings.TrimSuffix(value, ext)
	return trimUTF8Bytes(stem, maxBytes-len([]byte(ext))) + ext
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
