package main

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/mount"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

const (
	agentAvailabilitySearchPageSize    = 200
	agentAvailabilitySearchWorkers     = 12
	agentAvailabilitySearchSnapshotTTL = 5 * time.Second
	agentAvailabilitySearchMaxEntries  = 4
)

type agentCloudSearchFilters struct {
	Server       client.SearchFilters
	Availability string
}

func (filters agentCloudSearchFilters) Active() bool {
	return filters.Server.Active() || strings.TrimSpace(filters.Availability) != ""
}

func normalizeAgentAvailabilityFilter(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	switch value {
	case "", "local", "always-local", "online-only", "cloud", "mixed", "syncing":
		return value, nil
	default:
		return "", fmt.Errorf("availability must be local, always-local, online-only, cloud, mixed, or syncing")
	}
}

func agentAvailabilityClass(state mount.FileAvailability) string {
	switch {
	case state.Syncing || state.Mode == "syncing":
		return "syncing"
	case state.Mixed || state.Mode == "mixed":
		return "mixed"
	case state.Pinned || state.Mode == "always-local":
		return "always-local"
	case state.OnlineOnly || state.Mode == "online-only":
		return "online-only"
	case state.Mode == "cloud" || !state.AvailableOffline:
		return "cloud"
	default:
		return "local"
	}
}

var (
	errAgentAvailabilitySearchInvalidated   = errors.New("availability search snapshot invalidated")
	errAgentAvailabilitySearchSourceChanged = errors.New("availability search source collection changed")
)

type agentAvailabilitySearchMatch struct {
	SourceOffset int
	NodeID       uint64
}

type agentAvailabilitySearchSnapshot struct {
	CreatedAt   time.Time
	Generation  uint64
	Matches     []agentAvailabilitySearchMatch
	Groups      []client.FileExplorerGroupIndex
	SourceTotal int64
	Sort        string
	Order       string
}

type agentAvailabilitySearchFlight struct {
	generation uint64
	done       chan struct{}
	snapshot   *agentAvailabilitySearchSnapshot
	err        error
}

type agentAvailabilitySearchCache struct {
	mu         sync.Mutex
	generation uint64
	entries    map[string]*agentAvailabilitySearchSnapshot
	flights    map[string]*agentAvailabilitySearchFlight
}

func newAgentAvailabilitySearchCache() *agentAvailabilitySearchCache {
	return &agentAvailabilitySearchCache{
		entries: make(map[string]*agentAvailabilitySearchSnapshot),
		flights: make(map[string]*agentAvailabilitySearchFlight),
	}
}

func (cache *agentAvailabilitySearchCache) Invalidate() {
	if cache == nil {
		return
	}
	cache.mu.Lock()
	cache.generation++
	cache.entries = make(map[string]*agentAvailabilitySearchSnapshot)
	cache.mu.Unlock()
}

func (cache *agentAvailabilitySearchCache) Valid(snapshot *agentAvailabilitySearchSnapshot) bool {
	if cache == nil || snapshot == nil {
		return false
	}
	cache.mu.Lock()
	defer cache.mu.Unlock()
	return snapshot.Generation == cache.generation
}

func (cache *agentAvailabilitySearchCache) GetOrBuild(
	ctx context.Context,
	key string,
	build func(context.Context) (*agentAvailabilitySearchSnapshot, error),
) (*agentAvailabilitySearchSnapshot, error) {
	if cache == nil {
		return build(ctx)
	}
	now := time.Now()
	cache.mu.Lock()
	generation := cache.generation
	if snapshot := cache.entries[key]; snapshot != nil &&
		snapshot.Generation == generation &&
		now.Sub(snapshot.CreatedAt) <= agentAvailabilitySearchSnapshotTTL {
		cache.mu.Unlock()
		return snapshot, nil
	}
	if flight := cache.flights[key]; flight != nil && flight.generation == generation {
		done := flight.done
		cache.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-done:
			return flight.snapshot, flight.err
		}
	}
	flight := &agentAvailabilitySearchFlight{
		generation: generation,
		done:       make(chan struct{}),
	}
	cache.flights[key] = flight
	cache.mu.Unlock()

	snapshot, err := build(ctx)

	cache.mu.Lock()
	if cache.generation != generation {
		snapshot = nil
		err = errAgentAvailabilitySearchInvalidated
	} else if err == nil && snapshot != nil {
		snapshot.Generation = generation
		cache.entries[key] = snapshot
		for len(cache.entries) > agentAvailabilitySearchMaxEntries {
			var oldestKey string
			var oldest time.Time
			for candidateKey, candidate := range cache.entries {
				if candidateKey == key {
					continue
				}
				if oldestKey == "" || candidate.CreatedAt.Before(oldest) {
					oldestKey = candidateKey
					oldest = candidate.CreatedAt
				}
			}
			if oldestKey == "" {
				break
			}
			delete(cache.entries, oldestKey)
		}
	}
	flight.snapshot = snapshot
	flight.err = err
	if cache.flights[key] == flight {
		delete(cache.flights, key)
	}
	close(flight.done)
	cache.mu.Unlock()
	return snapshot, err
}

func agentAvailabilitySearchCacheKey(
	cfg userconfig.Config,
	root, query, sortKey, order string,
	filters agentCloudSearchFilters,
	grouping client.FileExplorerGroupingOptions,
) string {
	int64Value := func(value *int64) string {
		if value == nil {
			return ""
		}
		return strconv.FormatInt(*value, 10)
	}
	foldersFirst := ""
	if grouping.FoldersFirst != nil {
		foldersFirst = strconv.FormatBool(*grouping.FoldersFirst)
	}
	return strings.Join([]string{
		strings.TrimRight(strings.TrimSpace(cfg.Server), "/"),
		cfg.Username,
		filepath.Clean(root),
		strings.TrimSpace(query),
		strings.TrimSpace(sortKey),
		strings.TrimSpace(order),
		strings.TrimSpace(filters.Server.Kind),
		strings.TrimSpace(filters.Server.ModifiedFrom),
		strings.TrimSpace(filters.Server.ModifiedTo),
		int64Value(filters.Server.MinSize),
		int64Value(filters.Server.MaxSize),
		strconv.FormatUint(filters.Server.SourceID, 10),
		strings.TrimSpace(grouping.Group),
		foldersFirst,
		strings.TrimSpace(filters.Availability),
	}, "\x00")
}

func agentAvailabilityAbsolutePath(root, relative string) (string, error) {
	root, err := filepath.Abs(filepath.Clean(root))
	if err != nil {
		return "", err
	}
	relative = strings.TrimSpace(relative)
	if relative == "" {
		return "", fmt.Errorf("search result path is empty")
	}
	local := filepath.FromSlash(relative)
	if filepath.IsAbs(local) {
		return "", fmt.Errorf("search result path must be relative")
	}
	absolute, err := filepath.Abs(filepath.Join(root, local))
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(root, absolute)
	if err != nil {
		return "", err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("search result path escapes the managed root")
	}
	return filepath.Clean(absolute), nil
}

type agentAvailabilitySearchPageLoader func(
	context.Context,
	int,
	int,
) (client.SearchRange, error)

type agentAvailabilityResolver func(string) (string, error)

func agentAvailabilityMatchesPage(
	ctx context.Context,
	root, target string,
	items []client.SearchResult,
	resolve agentAvailabilityResolver,
) ([]bool, error) {
	matches := make([]bool, len(items))
	if len(items) == 0 {
		return matches, nil
	}
	workerCount := agentAvailabilitySearchWorkers
	if workerCount > len(items) {
		workerCount = len(items)
	}
	workCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	jobs := make(chan int)
	var wg sync.WaitGroup
	var firstErr error
	var errOnce sync.Once

	worker := func() {
		defer wg.Done()
		for index := range jobs {
			if workCtx.Err() != nil {
				return
			}
			absolute, err := agentAvailabilityAbsolutePath(root, items[index].Path)
			if err == nil {
				var class string
				class, err = resolve(absolute)
				if err == nil {
					matches[index] = class == target
				}
			}
			if err != nil {
				errOnce.Do(func() {
					firstErr = err
					cancel()
				})
				return
			}
		}
	}

	wg.Add(workerCount)
	for index := 0; index < workerCount; index++ {
		go worker()
	}
sendLoop:
	for index := range items {
		select {
		case <-workCtx.Done():
			break sendLoop
		case jobs <- index:
		}
	}
	close(jobs)
	wg.Wait()
	if firstErr != nil {
		return nil, firstErr
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return matches, nil
}

func buildAgentAvailabilitySearchSnapshot(
	ctx context.Context,
	root, target string,
	loadPage agentAvailabilitySearchPageLoader,
	resolve agentAvailabilityResolver,
) (*agentAvailabilitySearchSnapshot, error) {
	target, err := normalizeAgentAvailabilityFilter(target)
	if err != nil || target == "" {
		if err == nil {
			err = fmt.Errorf("availability filter is required")
		}
		return nil, err
	}

	first, err := loadPage(ctx, 0, agentAvailabilitySearchPageSize)
	if err != nil {
		return nil, err
	}
	if first.Offset != 0 {
		return nil, fmt.Errorf("availability search first range offset=%d, want 0", first.Offset)
	}
	if !first.HasTotalCount() {
		return nil, fmt.Errorf("availability search first range must include total_count")
	}
	sourceTotal := first.TotalCount
	originalGroups := append([]client.FileExplorerGroupIndex(nil), first.Groups...)
	groupCounts := make([]int64, len(originalGroups))
	matches := make([]agentAvailabilitySearchMatch, 0)
	groupCursor := 0

	process := func(page client.SearchRange) error {
		if page.HasTotalCount() && page.TotalCount != sourceTotal {
			return fmt.Errorf("search collection changed while evaluating availability")
		}
		pageMatches, err := agentAvailabilityMatchesPage(ctx, root, target, page.Items, resolve)
		if err != nil {
			return err
		}
		for index, matched := range pageMatches {
			if !matched {
				continue
			}
			globalOffset := page.Offset + index
			matches = append(matches, agentAvailabilitySearchMatch{
				SourceOffset: globalOffset,
				NodeID:       page.Items[index].Node.ID,
			})
			for groupCursor < len(originalGroups) &&
				int64(globalOffset) >= originalGroups[groupCursor].StartIndex+originalGroups[groupCursor].ItemCount {
				groupCursor++
			}
			if groupCursor < len(originalGroups) &&
				int64(globalOffset) >= originalGroups[groupCursor].StartIndex {
				groupCounts[groupCursor]++
			}
		}
		return nil
	}

	if err := process(first); err != nil {
		return nil, err
	}
	nextOffset := first.Offset + len(first.Items)
	for int64(nextOffset) < sourceTotal {
		if len(first.Items) == 0 && nextOffset == 0 {
			return nil, fmt.Errorf("availability search made no pagination progress")
		}
		page, err := loadPage(ctx, nextOffset, agentAvailabilitySearchPageSize)
		if err != nil {
			return nil, err
		}
		if page.Offset != nextOffset {
			return nil, fmt.Errorf("availability search range offset=%d, want %d", page.Offset, nextOffset)
		}
		if len(page.Items) == 0 {
			return nil, fmt.Errorf("availability search ended before total_count")
		}
		if err := process(page); err != nil {
			return nil, err
		}
		nextOffset = page.Offset + len(page.Items)
	}

	filteredGroups := make([]client.FileExplorerGroupIndex, 0, len(originalGroups))
	var filteredStart int64
	for index, group := range originalGroups {
		count := groupCounts[index]
		if count == 0 {
			continue
		}
		filteredGroups = append(filteredGroups, client.FileExplorerGroupIndex{
			Key:        group.Key,
			ItemCount:  count,
			StartIndex: filteredStart,
		})
		filteredStart += count
	}

	return &agentAvailabilitySearchSnapshot{
		CreatedAt:   time.Now(),
		Matches:     matches,
		Groups:      filteredGroups,
		SourceTotal: sourceTotal,
		Sort:        first.Sort,
		Order:       first.Order,
	}, nil
}

func materializeAgentAvailabilitySearchRange(
	ctx context.Context,
	snapshot *agentAvailabilitySearchSnapshot,
	offset, limit int,
	loadPage agentAvailabilitySearchPageLoader,
) ([]client.SearchResult, error) {
	if snapshot == nil || offset < 0 || limit <= 0 || offset >= len(snapshot.Matches) {
		return []client.SearchResult{}, nil
	}
	end := offset + limit
	if end > len(snapshot.Matches) {
		end = len(snapshot.Matches)
	}
	selected := snapshot.Matches[offset:end]
	out := make([]client.SearchResult, 0, len(selected))
	currentPageOffset := -1
	var currentPage client.SearchRange
	for _, match := range selected {
		sourceOffset := match.SourceOffset
		pageOffset := (sourceOffset / agentAvailabilitySearchPageSize) * agentAvailabilitySearchPageSize
		if pageOffset != currentPageOffset {
			page, err := loadPage(ctx, pageOffset, agentAvailabilitySearchPageSize)
			if err != nil {
				return nil, err
			}
			if page.HasTotalCount() && page.TotalCount != snapshot.SourceTotal {
				return nil, fmt.Errorf("search collection changed while materializing availability range")
			}
			currentPage = page
			currentPageOffset = pageOffset
		}
		index := sourceOffset - currentPage.Offset
		if index < 0 || index >= len(currentPage.Items) {
			return nil, fmt.Errorf("%w: source offset %d is no longer materializable", errAgentAvailabilitySearchSourceChanged, sourceOffset)
		}
		if currentPage.Items[index].Node.ID != match.NodeID {
			return nil, fmt.Errorf(
				"%w: source offset %d node=%d want=%d",
				errAgentAvailabilitySearchSourceChanged,
				sourceOffset,
				currentPage.Items[index].Node.ID,
				match.NodeID,
			)
		}
		out = append(out, currentPage.Items[index])
	}
	return out, nil
}

func (c *agentController) cloudSearchRangeByAvailability(
	ctx context.Context,
	cli *client.Client,
	cfg userconfig.Config,
	query string,
	offset, limit int,
	sortKey, order string,
	filters agentCloudSearchFilters,
	grouping client.FileExplorerGroupingOptions,
) (agentCloudSearchRange, error) {
	root, err := userconfig.EffectiveMountPath(cfg)
	if err != nil {
		return agentCloudSearchRange{}, err
	}
	root, err = filepath.Abs(root)
	if err != nil {
		return agentCloudSearchRange{}, err
	}

	includeAll := query == "" && !filters.Server.Active()
	loadPageWithCountPolicy := func(
		pageCtx context.Context,
		pageOffset, pageLimit int,
		omitTotalCount bool,
	) (client.SearchRange, error) {
		return cli.SearchRange(pageCtx, client.SearchRangeOptions{
			Query:          query,
			Filters:        filters.Server,
			Grouping:       grouping,
			IncludeAll:     includeAll,
			OmitTotalCount: omitTotalCount,
			Limit:          pageLimit,
			Offset:         pageOffset,
			Sort:           strings.TrimSpace(sortKey),
			Order:          strings.TrimSpace(order),
		})
	}
	loadPage := func(pageCtx context.Context, pageOffset, pageLimit int) (client.SearchRange, error) {
		return loadPageWithCountPolicy(pageCtx, pageOffset, pageLimit, pageOffset > 0)
	}
	loadPageUncounted := func(pageCtx context.Context, pageOffset, pageLimit int) (client.SearchRange, error) {
		return loadPageWithCountPolicy(pageCtx, pageOffset, pageLimit, true)
	}
	resolve := func(absolute string) (string, error) {
		state, err := mount.Availability(absolute)
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return "cloud", nil
			}
			return "", err
		}
		return agentAvailabilityClass(state), nil
	}
	key := agentAvailabilitySearchCacheKey(
		cfg,
		root,
		query,
		sortKey,
		order,
		filters,
		grouping,
	)
	for {
		snapshot, err := c.availabilitySearch.GetOrBuild(ctx, key, func(buildCtx context.Context) (*agentAvailabilitySearchSnapshot, error) {
			return buildAgentAvailabilitySearchSnapshot(
				buildCtx,
				root,
				filters.Availability,
				loadPage,
				resolve,
			)
		})
		if errors.Is(err, errAgentAvailabilitySearchInvalidated) {
			if ctx.Err() != nil {
				return agentCloudSearchRange{}, ctx.Err()
			}
			continue
		}
		if err != nil {
			return agentCloudSearchRange{}, err
		}
		items, err := materializeAgentAvailabilitySearchRange(
			ctx,
			snapshot,
			offset,
			limit,
			loadPageUncounted,
		)
		if errors.Is(err, errAgentAvailabilitySearchSourceChanged) {
			c.availabilitySearch.Invalidate()
			if ctx.Err() != nil {
				return agentCloudSearchRange{}, ctx.Err()
			}
			continue
		}
		if err != nil {
			return agentCloudSearchRange{}, err
		}
		if !c.availabilitySearch.Valid(snapshot) {
			if ctx.Err() != nil {
				return agentCloudSearchRange{}, ctx.Err()
			}
			continue
		}
		out := make([]agentCloudSearchResult, 0, len(items))
		for _, item := range items {
			out = append(out, agentCloudSearchResult{
				Node:   item.Node,
				Path:   item.Path,
				Crumbs: agentCloudCrumbs(item.Breadcrumbs),
			})
		}
		return agentCloudSearchRange{
			Items:      out,
			TotalCount: int64(len(snapshot.Matches)),
			Offset:     offset,
			Limit:      limit,
			Sort:       snapshot.Sort,
			Order:      snapshot.Order,
			Groups:     snapshot.Groups,
		}, nil
	}
}
