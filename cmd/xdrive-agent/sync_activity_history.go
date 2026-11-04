package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"time"

	"github.com/lazyxu/xdrive/internal/syncactivity"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

// This is separate from the existing transfer-history-v1 JSON: a transfer is
// not necessarily a sync change, and an operation can change metadata without
// transferring bytes. Each Agent account has its own durable SQLite file.
func agentSyncActivityIdentity(cfg userconfig.Config) (string, string, error) {
	original, key, err := agentTransferHistoryIdentity(cfg)
	if err != nil {
		return "", "", err
	}
	return filepath.Join(filepath.Dir(original), "sync-activity-v1-"+key+".sqlite"), key, nil
}

func (c *agentController) loadInitialSyncActivity() {
	cfg, err := userconfig.Load()
	if err != nil || cfg.SessionInvalid {
		return
	}
	c.switchSyncActivity(cfg)
}

// Caller holds syncActivityMu. A shutdown/account change flushes accepted
// receipts into the previous Owner's file before detaching that database.
func (c *agentController) flushSyncActivityPendingLocked() {
	if c.syncActivity != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		for runID, items := range c.syncActivityPending {
			if len(items) == 0 {
				continue
			}
			if err := c.syncActivity.AppendBatch(ctx, items); err != nil {
				log.Printf("xDrive pending sync activity batch %s not saved: %v", runID, err)
			}
		}
	}
	c.syncActivityPending = make(map[string][]syncactivity.Item)
	c.syncActivityLost = make(map[string]bool)
}

func (c *agentController) switchSyncActivity(cfg userconfig.Config) {
	c.syncActivityMu.Lock()
	defer c.syncActivityMu.Unlock()
	c.flushSyncActivityPendingLocked()
	if c.syncActivity != nil {
		if err := c.syncActivity.Close(); err != nil {
			log.Printf("xDrive sync activity close: %v", err)
		}
	}
	c.syncActivity = nil
	c.syncActivityKey = ""
	c.syncActivityPrunedAt = time.Time{}
	if cfg.SessionInvalid {
		return
	}
	path, key, err := agentSyncActivityIdentity(cfg)
	if err != nil {
		log.Printf("xDrive sync activity scope: %v", err)
		return
	}
	store, err := syncactivity.Open(path, key)
	if err != nil {
		log.Printf("xDrive sync activity open: %v", err)
		return
	}
	c.syncActivity = store
	c.syncActivityKey = key
	now := time.Now().UTC()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := store.Prune(ctx, now); err != nil {
		log.Printf("xDrive sync activity retention cleanup failed: %v", err)
	} else {
		c.syncActivityPrunedAt = now
	}
}

func (c *agentController) closeSyncActivity() {
	c.syncActivityMu.Lock()
	defer c.syncActivityMu.Unlock()
	c.flushSyncActivityPendingLocked()
	if c.syncActivity != nil {
		if err := c.syncActivity.Close(); err != nil {
			log.Printf("xDrive sync activity close: %v", err)
		}
	}
	c.syncActivity = nil
	c.syncActivityKey = ""
	c.syncActivityPrunedAt = time.Time{}
}

func (c *agentController) syncActivityForCurrentAccount() (*syncactivity.Store, error) {
	// Caller holds syncActivityMu while using the returned Store: an Owner switch
	// cannot close or replace it until that query finishes.
	cfg, err := userconfig.Load()
	if err != nil || cfg.SessionInvalid {
		return nil, errors.New("sync activity requires a valid login")
	}
	_, key, err := agentSyncActivityIdentity(cfg)
	if err != nil {
		return nil, err
	}
	if c.syncActivity == nil || c.syncActivityKey != key {
		return nil, fmt.Errorf("sync activity for current account is not available")
	}
	return c.syncActivity, nil
}

func (c *agentController) SyncActivityRuns(ctx context.Context, limit int, after *syncactivity.RunCursor) ([]syncactivity.Run, error) {
	c.syncActivityMu.Lock()
	defer c.syncActivityMu.Unlock()
	store, err := c.syncActivityForCurrentAccount()
	if err != nil {
		return nil, err
	}
	return store.List(ctx, limit, after)
}

func (c *agentController) SyncActivityRun(ctx context.Context, id string) (syncactivity.Run, error) {
	c.syncActivityMu.Lock()
	defer c.syncActivityMu.Unlock()
	store, err := c.syncActivityForCurrentAccount()
	if err != nil {
		return syncactivity.Run{}, err
	}
	return store.Get(ctx, id)
}

func (c *agentController) SyncActivityItems(ctx context.Context, id string, limit int, after *syncactivity.ItemCursor) ([]syncactivity.Item, error) {
	c.syncActivityMu.Lock()
	defer c.syncActivityMu.Unlock()
	store, err := c.syncActivityForCurrentAccount()
	if err != nil {
		return nil, err
	}
	return store.Items(ctx, id, limit, after)
}
