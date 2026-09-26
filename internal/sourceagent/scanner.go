package sourceagent

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
)

const (
	DefaultBatchSize         = 500
	DefaultHeartbeatInterval = 5 * time.Minute
	SynologyKind             = "synology_photos"
)

type API interface {
	Source(context.Context, uint64) (client.Source, error)
	BeginSourceRun(context.Context, uint64, string, string) (client.SyncRun, error)
	ObserveSourceItems(context.Context, uint64, string, []client.SourceObservation) ([]client.SourcePlan, error)
	HeartbeatSourceRun(context.Context, uint64, string) error
	FinishSourceRun(context.Context, uint64, string, client.FinishSourceRunInput) (client.SyncRun, error)
}

type Root struct {
	Key        string
	Path       string
	Prefix     string
	ExpectedID string
}

type Scanner struct {
	API               API
	SourceID          uint64
	Roots             []Root
	BatchSize         int
	HeartbeatInterval time.Duration
}

func Roots(personal, shared string) []Root {
	return RootsWithIdentities(personal, "", shared, "")
}

func RootsWithIdentities(personal, personalID, shared, sharedID string) []Root {
	var roots []Root
	if strings.TrimSpace(personal) != "" {
		roots = append(roots, Root{Key: "personal", Path: personal, Prefix: "Personal", ExpectedID: strings.TrimSpace(personalID)})
	}
	if strings.TrimSpace(shared) != "" {
		roots = append(roots, Root{Key: "shared", Path: shared, Prefix: "Shared", ExpectedID: strings.TrimSpace(sharedID)})
	}
	return roots
}

func RootIdentity(key, rootPath string) (string, error) {
	key = strings.TrimSpace(key)
	rootPath = strings.TrimSpace(rootPath)
	if key == "" || rootPath == "" {
		return "", fmt.Errorf("root key and path are required")
	}
	info, err := os.Lstat(rootPath)
	if err != nil {
		return "", err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("root path must not be a symbolic link")
	}
	if !info.IsDir() {
		return "", fmt.Errorf("root path is not a directory")
	}
	return fileExternalID(key, info)
}

func (s Scanner) Run(ctx context.Context, trigger string) (client.SyncRun, error) {
	if s.API == nil {
		return client.SyncRun{}, fmt.Errorf("source API is unavailable")
	}
	if s.SourceID == 0 {
		return client.SyncRun{}, fmt.Errorf("source id is required")
	}
	if len(s.Roots) == 0 {
		return client.SyncRun{}, fmt.Errorf("at least one source root is required")
	}
	if err := validateRoots(s.Roots); err != nil {
		return client.SyncRun{}, err
	}

	source, err := s.API.Source(ctx, s.SourceID)
	if err != nil {
		return client.SyncRun{}, err
	}
	if source.Kind != SynologyKind || source.Direction != meta.SourceDirectionPush {
		return client.SyncRun{}, fmt.Errorf("source %d is not a Synology Photos push source", s.SourceID)
	}

	runID := uuid.NewString()
	run, err := s.API.BeginSourceRun(ctx, s.SourceID, runID, trigger)
	if err != nil {
		return client.SyncRun{}, err
	}
	var summary sourcepkg.Summary
	failRun := func(cause error) (client.SyncRun, error) {
		summary.AddFailure()
		status := meta.SyncRunStatusFailed
		if errors.Is(cause, context.Canceled) || errors.Is(cause, context.DeadlineExceeded) {
			status = meta.SyncRunStatusCancelled
		}
		finished, finishErr := s.API.FinishSourceRun(context.Background(), s.SourceID, run.ID, client.FinishSourceRunInput{
			Status:            status,
			CompleteInventory: false,
			Summary:           summary,
			Error:             cause.Error(),
		})
		if finishErr != nil {
			return client.SyncRun{}, errors.Join(cause, fmt.Errorf("finish failed source run: %w", finishErr))
		}
		return finished, cause
	}

	if run.Mode != meta.SourceRunModeScan {
		return failRun(fmt.Errorf("source run_mode=%q requires the sync executor, which is not available in this scanner build", run.Mode))
	}

	for _, root := range s.Roots {
		if strings.TrimSpace(root.ExpectedID) == "" {
			return failRun(fmt.Errorf("%s root identity is not configured; run setup again", root.Key))
		}
		actualID, err := RootIdentity(root.Key, root.Path)
		if err != nil {
			return failRun(fmt.Errorf("validate %s root %s: %w", root.Key, root.Path, err))
		}
		if actualID != root.ExpectedID {
			return failRun(fmt.Errorf("%s root identity changed: got %s want %s; run setup again after verifying the Synology volume is mounted", root.Key, actualID, root.ExpectedID))
		}
	}

	matcher, err := sourcepkg.CompileIgnoreRules(run.IgnoreRules)
	if err != nil {
		return failRun(fmt.Errorf("compile source ignore rules: %w", err))
	}

	heartbeatInterval := s.HeartbeatInterval
	if heartbeatInterval <= 0 {
		heartbeatInterval = DefaultHeartbeatInterval
	}
	lastHeartbeat := time.Now()
	heartbeatIfDue := func() error {
		if time.Since(lastHeartbeat) < heartbeatInterval {
			return nil
		}
		if err := s.API.HeartbeatSourceRun(ctx, s.SourceID, run.ID); err != nil {
			return err
		}
		lastHeartbeat = time.Now()
		return nil
	}

	batchSize := s.BatchSize
	if batchSize <= 0 || batchSize > DefaultBatchSize {
		batchSize = DefaultBatchSize
	}
	batch := make([]client.SourceObservation, 0, batchSize)
	localItems := make(map[string]sourcepkg.DiscoveredItem, batchSize)
	seenIdentities := make(map[string]string)

	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		plans, err := s.API.ObserveSourceItems(ctx, s.SourceID, run.ID, batch)
		if err != nil {
			return err
		}
		if len(plans) != len(batch) {
			return fmt.Errorf("source plan count mismatch: got %d want %d", len(plans), len(batch))
		}
		seen := make(map[string]struct{}, len(plans))
		for _, plan := range plans {
			item, ok := localItems[plan.ExternalID]
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
			summary.Add(sourcepkg.PlanResult{Action: action, Item: item})
		}
		batch = batch[:0]
		clear(localItems)
		return nil
	}

	addItem := func(item sourcepkg.DiscoveredItem) error {
		if err := heartbeatIfDue(); err != nil {
			return fmt.Errorf("heartbeat source run: %w", err)
		}
		if previous, exists := seenIdentities[item.ExternalID]; exists {
			return fmt.Errorf("duplicate source identity %q for %q and %q", item.ExternalID, previous, item.Path)
		}
		seenIdentities[item.ExternalID] = item.Path
		if matcher.Ignored(item.Path, item.Kind == meta.SourceItemKindDirectory) {
			summary.Add(sourcepkg.PlanResult{Action: sourcepkg.ActionIgnore, Item: item})
			return nil
		}
		if _, exists := localItems[item.ExternalID]; exists {
			return fmt.Errorf("duplicate source identity %q in one batch", item.ExternalID)
		}
		localItems[item.ExternalID] = item
		batch = append(batch, client.SourceObservation{
			ExternalID: item.ExternalID, Kind: item.Kind, Path: item.Path, Size: item.Size,
			ModifiedAt: item.ModifiedAt, SHA256: item.SHA256, RemoteRevision: item.RemoteRevision,
		})
		if len(batch) >= batchSize {
			return flush()
		}
		return nil
	}

	for _, root := range s.Roots {
		virtual := sourcepkg.DiscoveredItem{
			ExternalID: "root:" + root.Key,
			Kind:       meta.SourceItemKindDirectory,
			Path:       root.Prefix,
		}
		if err := addItem(virtual); err != nil {
			return failRun(err)
		}

		rootPath := filepath.Clean(root.Path)
		err := filepath.WalkDir(rootPath, func(current string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if err := ctx.Err(); err != nil {
				return err
			}
			if current == rootPath {
				return nil
			}
			if entry.Type()&os.ModeSymlink != 0 {
				return nil
			}
			info, err := entry.Info()
			if err != nil {
				return err
			}
			rel, err := filepath.Rel(rootPath, current)
			if err != nil {
				return err
			}
			targetPath := filepath.ToSlash(filepath.Join(root.Prefix, rel))
			kind := meta.SourceItemKindFile
			size := info.Size()
			if entry.IsDir() {
				kind = meta.SourceItemKindDirectory
				size = 0
			}
			externalID, err := fileExternalID(root.Key, info)
			if err != nil {
				return err
			}
			modified := info.ModTime().UTC()
			return addItem(sourcepkg.DiscoveredItem{
				ExternalID: externalID,
				Kind:       kind,
				Path:       targetPath,
				Size:       size,
				ModifiedAt: &modified,
			})
		})
		if err != nil {
			return failRun(fmt.Errorf("scan %s root %s: %w", root.Key, root.Path, err))
		}
	}
	if err := flush(); err != nil {
		return failRun(fmt.Errorf("flush source observations: %w", err))
	}

	finished, err := s.API.FinishSourceRun(ctx, s.SourceID, run.ID, client.FinishSourceRunInput{
		Status:            meta.SyncRunStatusCompleted,
		CompleteInventory: true,
		Summary:           summary,
	})
	if err != nil {
		return client.SyncRun{}, err
	}
	return finished, nil
}

func validateRoots(roots []Root) error {
	seenKey := map[string]struct{}{}
	seenPrefix := map[string]struct{}{}
	for _, root := range roots {
		root.Key = strings.TrimSpace(root.Key)
		root.Path = strings.TrimSpace(root.Path)
		root.Prefix = strings.Trim(strings.ReplaceAll(strings.TrimSpace(root.Prefix), "\\", "/"), "/")
		if root.Key == "" || root.Path == "" || root.Prefix == "" {
			return fmt.Errorf("source root key, path, and prefix are required")
		}
		if _, ok := seenKey[root.Key]; ok {
			return fmt.Errorf("duplicate source root key %q", root.Key)
		}
		seenKey[root.Key] = struct{}{}
		if _, ok := seenPrefix[root.Prefix]; ok {
			return fmt.Errorf("duplicate source root prefix %q", root.Prefix)
		}
		seenPrefix[root.Prefix] = struct{}{}
		if _, err := sourcepkg.NormalizeRelativePath(root.Prefix); err != nil {
			return fmt.Errorf("invalid source root prefix %q: %w", root.Prefix, err)
		}
	}
	return nil
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
