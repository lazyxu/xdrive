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
	ListFoldersPage(context.Context, synology.Space, int, int) (synology.FolderPage, error)
	ListItemsPage(context.Context, synology.Space, int, int) (synology.ItemPage, error)
}

type SourceAPI interface {
	pullsync.RunAPI
	ObserveSourceItems(context.Context, uint64, string, []client.SourceObservation) ([]client.SourcePlan, error)
	UpdateSourceRunSummary(context.Context, uint64, string, sourcepkg.Summary) error
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
	Summary       sourcepkg.Summary
	Metadata      []sourcemetadata.Snapshot
	PersonalItems int64
	SharedItems   int64
	Folders       int64
	Errors        []string
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
	name := sanitizeSegment(remote.Filename, remote.ID, true)
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
	original := path.Join(folderPaths[item.FolderID], strings.TrimSpace(item.Filename))
	return sourcemetadata.Snapshot{
		ItemExternalID:  fmt.Sprintf("synology:%s:%d", space, item.ID),
		OriginalPath:    strings.Trim(original, "/"),
		OwnerExternalID: strconv.FormatInt(item.OwnerUserID, 10),
		CapturedAt:      capturedAt,
	}
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
	value = strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	value = path.Base(value)
	if value == "." || value == "/" || value == "" {
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
	clean := strings.TrimRight(strings.TrimSpace(b.String()), " .")
	if clean == "" {
		clean = "item"
	}
	if stableSuffix {
		return appendStableSuffix(clean, id)
	}
	clean = trimUTF8Bytes(clean, 255)
	if err := meta.ValidateName(clean); err != nil {
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
