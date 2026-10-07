package main

import (
	"container/list"
	"context"
	"errors"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/lazyxu/xdrive/internal/userconfig"
)

const (
	agentMediaThumbnailCacheMaxEntries = 256
	agentMediaThumbnailCacheMaxBytes   = int64(32 << 20)
	// Bump when thumbnail pixels can change without a Node revision change.
	agentMediaThumbnailCacheVersion = "v3"
)

type agentMediaThumbnailFetch struct {
	Thumbnail   agentMediaThumbnail
	ETag        string
	MaxAge      time.Duration
	NotModified bool
}

type agentMediaThumbnailCacheEntry struct {
	key       string
	thumbnail agentMediaThumbnail
	etag      string
	expiresAt time.Time
	size      int64
}

type agentMediaThumbnailInflight struct {
	done      chan struct{}
	thumbnail agentMediaThumbnail
	err       error
}

type agentMediaThumbnailCache struct {
	mu         sync.Mutex
	maxEntries int
	maxBytes   int64
	bytes      int64
	entries    map[string]*list.Element
	lru        list.List
	inflight   map[string]*agentMediaThumbnailInflight
	now        func() time.Time
}

func newAgentMediaThumbnailCache(maxEntries int, maxBytes int64) *agentMediaThumbnailCache {
	return &agentMediaThumbnailCache{
		maxEntries: maxEntries,
		maxBytes:   maxBytes,
		entries:    make(map[string]*list.Element),
		inflight:   make(map[string]*agentMediaThumbnailInflight),
		now:        time.Now,
	}
}

func agentMediaThumbnailCacheKey(cfg userconfig.Config, nodeID uint64) string {
	return strings.TrimSpace(cfg.Server) + "\x00" +
		strings.TrimSpace(cfg.Username) + "\x00" +
		strings.TrimSpace(cfg.SessionID) + "\x00" +
		agentMediaThumbnailCacheVersion + "\x00" +
		strconv.FormatUint(nodeID, 10)
}

func (c *agentMediaThumbnailCache) Load(
	ctx context.Context,
	key string,
	loader func(etag string) (agentMediaThumbnailFetch, error),
) (agentMediaThumbnail, error) {
	if c == nil {
		fetch, err := loader("")
		if err != nil {
			return agentMediaThumbnail{}, err
		}
		return fetch.Thumbnail, nil
	}

	now := c.now()
	c.mu.Lock()
	if element := c.entries[key]; element != nil {
		entry := element.Value.(*agentMediaThumbnailCacheEntry)
		if now.Before(entry.expiresAt) {
			c.lru.MoveToFront(element)
			thumbnail := entry.thumbnail
			c.mu.Unlock()
			return thumbnail, nil
		}
	}
	if pending := c.inflight[key]; pending != nil {
		done := pending.done
		c.mu.Unlock()
		select {
		case <-ctx.Done():
			return agentMediaThumbnail{}, ctx.Err()
		case <-done:
			return pending.thumbnail, pending.err
		}
	}

	var stale *agentMediaThumbnailCacheEntry
	if element := c.entries[key]; element != nil {
		entry := element.Value.(*agentMediaThumbnailCacheEntry)
		copyEntry := *entry
		stale = &copyEntry
	}
	pending := &agentMediaThumbnailInflight{done: make(chan struct{})}
	c.inflight[key] = pending
	c.mu.Unlock()

	etag := ""
	if stale != nil {
		etag = stale.etag
	}
	fetch, err := loader(etag)
	result := fetch.Thumbnail
	cacheETag := strings.TrimSpace(fetch.ETag)
	if err == nil && fetch.NotModified {
		if stale == nil || len(stale.thumbnail.Data) == 0 {
			err = errors.New("thumbnail cache revalidation returned not-modified without cached bytes")
		} else {
			result = stale.thumbnail
			if cacheETag == "" {
				cacheETag = stale.etag
			}
		}
	}

	c.mu.Lock()
	if err == nil && len(result.Data) > 0 {
		c.putLocked(
			key,
			result,
			cacheETag,
			c.now().Add(fetch.MaxAge),
		)
	}
	pending.thumbnail = result
	pending.err = err
	delete(c.inflight, key)
	close(pending.done)
	c.mu.Unlock()
	return result, err
}

func (c *agentMediaThumbnailCache) putLocked(
	key string,
	thumbnail agentMediaThumbnail,
	etag string,
	expiresAt time.Time,
) {
	size := int64(len(thumbnail.Data))
	if c.maxEntries <= 0 || c.maxBytes <= 0 || size > c.maxBytes {
		if element := c.entries[key]; element != nil {
			c.removeElementLocked(element)
		}
		return
	}
	if element := c.entries[key]; element != nil {
		c.removeElementLocked(element)
	}
	entry := &agentMediaThumbnailCacheEntry{
		key:       key,
		thumbnail: thumbnail,
		etag:      strings.TrimSpace(etag),
		expiresAt: expiresAt,
		size:      size,
	}
	element := c.lru.PushFront(entry)
	c.entries[key] = element
	c.bytes += size
	for len(c.entries) > c.maxEntries || c.bytes > c.maxBytes {
		if back := c.lru.Back(); back != nil {
			c.removeElementLocked(back)
			continue
		}
		break
	}
}

func (c *agentMediaThumbnailCache) removeElementLocked(element *list.Element) {
	entry := element.Value.(*agentMediaThumbnailCacheEntry)
	delete(c.entries, entry.key)
	c.bytes -= entry.size
	c.lru.Remove(element)
}
