package synologyfilesync

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/pullsync"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"github.com/lazyxu/xdrive/internal/synology"
)

const (
	SourceKind               = "synology_files"
	DefaultBatchSize         = 500
	DefaultTransferQueueSize = 64
)

type Remote interface {
	ListFolderPage(context.Context, string, int, int) (synology.FileStationPage, error)
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
	RemotePath string
}

type Scanner struct {
	Remote            Remote
	API               SourceAPI
	SourceID          uint64
	RunID             string
	IgnoreRules       string
	Mode              string
	Roots             []string
	Executor          PlanExecutor
	BatchSize         int
	TransferQueueSize int
}

type Result struct {
	Summary     sourcepkg.Summary
	Files       int64
	Directories int64
	Errors      []string
}

type folderTask struct {
	RemotePath   string
	RelativePath string
}

func (s Scanner) Scan(ctx context.Context) (Result, error) {
	var result Result
	if s.Remote == nil || s.API == nil || s.SourceID == 0 || strings.TrimSpace(s.RunID) == "" {
		return result, fmt.Errorf("Synology File Station scanner is not configured")
	}
	mode := strings.TrimSpace(s.Mode)
	if mode == "" {
		mode = meta.SourceRunModeScan
	}
	if !meta.ValidSourceRunMode(mode) {
		return result, fmt.Errorf("invalid Synology File Station scanner mode %q", mode)
	}
	if mode == meta.SourceRunModeSync && s.Executor == nil {
		return result, fmt.Errorf("Synology File Station sync executor is not configured")
	}
	config, err := synology.NormalizeFilePullConfig(synology.FilePullConfig{Roots: s.Roots})
	if err != nil {
		return result, err
	}
	matcher, err := sourcepkg.CompileIgnoreRules(s.IgnoreRules)
	if err != nil {
		return result, fmt.Errorf("compile source ignore rules: %w", err)
	}

	batchSize := s.BatchSize
	if batchSize <= 0 || batchSize > DefaultBatchSize {
		batchSize = DefaultBatchSize
	}
	batch := make([]client.SourceObservation, 0, batchSize)
	batchItems := make(map[string]sourcepkg.DiscoveredItem, batchSize)
	batchRefs := make(map[string]TransferRef, batchSize)
	pathOwners := make(map[string]string)
	if lister, ok := s.API.(sourceItemLister); ok {
		if err := seedPathOwners(ctx, lister, s.SourceID, pathOwners); err != nil {
			return result, fmt.Errorf("read existing File Station source paths: %w", err)
		}
	}

	var pipeline *pullsync.Pipeline[TransferRef]
	if mode == meta.SourceRunModeSync {
		queueSize := s.TransferQueueSize
		if queueSize <= 0 {
			queueSize = DefaultTransferQueueSize
		}
		pipeline = pullsync.NewPipeline(ctx, queueSize, "Synology File Station", s.SourceID, s.RunID, s.API, s.Executor)
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
		transfers := make([]pullsync.Task[TransferRef], 0, len(plans))
		seen := make(map[string]struct{}, len(plans))
		for _, plan := range plans {
			item, ok := batchItems[plan.ExternalID]
			if !ok {
				return fmt.Errorf("server returned plan for unknown external id %q", plan.ExternalID)
			}
			if _, duplicate := seen[plan.ExternalID]; duplicate {
				return fmt.Errorf("server returned duplicate plan for external id %q", plan.ExternalID)
			}
			seen[plan.ExternalID] = struct{}{}
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

	observe := func(item sourcepkg.DiscoveredItem, ref TransferRef) error {
		batchItems[item.ExternalID] = item
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
			return flush()
		}
		return nil
	}

	queue := make([]folderTask, 0, len(config.Roots))
	for _, root := range config.Roots {
		externalID := fileStationExternalID(root)
		relative := reservePath(sanitizeRemotePath(root), root, externalID, pathOwners)
		rootItem := sourcepkg.DiscoveredItem{
			ExternalID:     externalID,
			Kind:           meta.SourceItemKindDirectory,
			Path:           relative,
			RemoteRevision: "root",
		}
		if err := sourcepkg.ValidateDiscoveredItem(&rootItem); err != nil {
			return result, fmt.Errorf("normalize File Station root %q: %w", root, err)
		}
		result.Directories++
		if matcher.Ignored(rootItem.Path, true) {
			result.Summary.Add(sourcepkg.PlanResult{Action: sourcepkg.ActionIgnore, Item: rootItem})
			continue
		}
		if err := observe(rootItem, TransferRef{RemotePath: root}); err != nil {
			return result, err
		}
		queue = append(queue, folderTask{RemotePath: root, RelativePath: relative})
	}

	for len(queue) != 0 {
		task := queue[0]
		queue = queue[1:]
		offset := 0
		for pageNo := 0; pageNo < 100000; pageNo++ {
			if err := ctx.Err(); err != nil {
				return result, err
			}
			page, err := s.Remote.ListFolderPage(ctx, task.RemotePath, offset, DefaultBatchSize)
			if err != nil {
				return result, fmt.Errorf("list File Station folder %q: %w", task.RemotePath, err)
			}
			for _, entry := range page.Entries {
				remotePath, err := synology.NormalizeFileStationPath(entry.Path)
				if err != nil {
					return result, fmt.Errorf("invalid File Station child path %q: %w", entry.Path, err)
				}
				if path.Dir(remotePath) != task.RemotePath {
					return result, fmt.Errorf("File Station child %q escaped parent %q", remotePath, task.RemotePath)
				}
				externalID := fileStationExternalID(remotePath)
				name := sanitizeSegment(entry.Name, remotePath)
				relative := reservePath(path.Join(task.RelativePath, name), remotePath, externalID, pathOwners)
				item := discoveredItem(remotePath, relative, entry)
				if err := sourcepkg.ValidateDiscoveredItem(&item); err != nil {
					return result, fmt.Errorf("normalize File Station item %q: %w", remotePath, err)
				}
				if entry.IsDir {
					result.Directories++
				} else {
					result.Files++
				}
				ignored := matcher.Ignored(item.Path, entry.IsDir)
				if ignored {
					result.Summary.Add(sourcepkg.PlanResult{Action: sourcepkg.ActionIgnore, Item: item})
				} else if err := observe(item, TransferRef{RemotePath: remotePath}); err != nil {
					return result, err
				}
				if entry.IsDir && !ignored {
					queue = append(queue, folderTask{RemotePath: remotePath, RelativePath: relative})
				}
			}
			if err := flush(); err != nil {
				return result, err
			}
			if err := s.API.HeartbeatSourceRun(ctx, s.SourceID, s.RunID); err != nil {
				return result, err
			}
			next, done, err := nextOffset(offset, page.Offset, page.Total, len(page.Entries))
			if err != nil {
				return result, fmt.Errorf("paginate File Station folder %q: %w", task.RemotePath, err)
			}
			if done {
				break
			}
			offset = next
		}
	}

	if err := flush(); err != nil {
		return result, fmt.Errorf("flush File Station source observations: %w", err)
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
			return result, fmt.Errorf("execute File Station source transfers: %w", worker.Err)
		}
	}
	if err := s.API.UpdateSourceRunSummary(ctx, s.SourceID, s.RunID, result.Summary); err != nil {
		return result, fmt.Errorf("report File Station source progress: %w", err)
	}
	return result, nil
}

func discoveredItem(remotePath, relativePath string, entry synology.FileStationEntry) sourcepkg.DiscoveredItem {
	kind := meta.SourceItemKindFile
	size := entry.FileSize()
	if entry.IsDir {
		kind = meta.SourceItemKindDirectory
		size = 0
	}
	modified := entry.ModifiedAt()
	mtime := int64(0)
	if modified != nil {
		mtime = modified.Unix()
	}
	return sourcepkg.DiscoveredItem{
		ExternalID:     fileStationExternalID(remotePath),
		Kind:           kind,
		Path:           relativePath,
		Size:           size,
		ModifiedAt:     modified,
		RemoteRevision: fmt.Sprintf("mtime:%d:size:%d:dir:%t", mtime, size, entry.IsDir),
	}
}

func fileStationExternalID(remotePath string) string {
	sum := sha256.Sum256([]byte(remotePath))
	return "synology-file-path:" + hex.EncodeToString(sum[:])
}

func sanitizeRemotePath(remotePath string) string {
	parts := strings.Split(strings.Trim(remotePath, "/"), "/")
	for i := range parts {
		parts[i] = sanitizeSegment(parts[i], path.Join("/", strings.Join(parts[:i+1], "/")))
	}
	return path.Join(parts...)
}

func sanitizeSegment(value, stableKey string) string {
	if value == "" {
		value = path.Base(stableKey)
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
	clean = trimUTF8Bytes(clean, 255)
	if err := meta.ValidateName(clean); err == nil {
		return clean
	}
	suffix := " [" + shortPathHash(stableKey) + "]"
	clean = trimUTF8Bytes(strings.TrimRight(clean, " ."), 255-len([]byte(suffix)))
	if clean == "" {
		clean = "item"
	}
	candidate := clean + suffix
	if err := meta.ValidateName(candidate); err == nil {
		return candidate
	}
	return "item-" + shortPathHash(stableKey)
}

func reservePath(preferred, remotePath, externalID string, owners map[string]string) string {
	key := strings.ToLower(preferred)
	if current, exists := owners[key]; !exists || current == externalID {
		owners[key] = externalID
		return preferred
	}
	dir := path.Dir(preferred)
	if dir == "." {
		dir = ""
	}
	base := path.Base(preferred)
	ext := path.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	for attempt := 0; ; attempt++ {
		suffix := " [" + shortPathHash(remotePath)
		if attempt > 0 {
			suffix += "-" + strconv.Itoa(attempt+1)
		}
		suffix += "]"
		maxStem := 255 - len([]byte(ext)) - len([]byte(suffix))
		if maxStem < 1 {
			ext = ""
			maxStem = 255 - len([]byte(suffix))
		}
		candidate := trimUTF8Bytes(stem, maxStem) + suffix + ext
		if dir != "" {
			candidate = path.Join(dir, candidate)
		}
		candidateKey := strings.ToLower(candidate)
		if current, exists := owners[candidateKey]; !exists || current == externalID {
			owners[candidateKey] = externalID
			return candidate
		}
	}
}

func shortPathHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:4])
}

func seedPathOwners(ctx context.Context, lister sourceItemLister, sourceID uint64, owners map[string]string) error {
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
