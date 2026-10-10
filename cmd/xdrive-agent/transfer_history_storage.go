package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/transfer"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

const (
	agentTransferHistoryVersion  = 1
	agentTransferHistoryMaxBytes = 64 << 20
)

type agentTransferHistoryFile struct {
	Version int             `json:"version"`
	Owner   string          `json:"owner"`
	SavedAt time.Time       `json:"saved_at"`
	Tasks   []transfer.Task `json:"tasks"`
}

// The history is for this device and signed-in account. It is not placed in
// the Server database and cannot be shared with another Desktop or Web.
func agentTransferHistoryIdentity(cfg userconfig.Config) (string, string, error) {
	if strings.TrimSpace(cfg.Server) == "" || strings.TrimSpace(cfg.Username) == "" {
		return "", "", errors.New("a configured transfer-history account is required")
	}
	dir, err := userconfig.Dir()
	if err != nil {
		return "", "", err
	}
	identity := strings.TrimRight(strings.TrimSpace(cfg.Server), "/") + "\x00" + strings.TrimSpace(cfg.Username)
	hash := sha256.Sum256([]byte(identity))
	key := hex.EncodeToString(hash[:])
	return filepath.Join(dir, "transfer-history-v1-"+key+".json"), key, nil
}

func readAgentTransferHistory(path, key string) ([]transfer.Task, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > agentTransferHistoryMaxBytes {
		return nil, errors.New("transfer history is not a bounded regular file")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, agentTransferHistoryMaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > agentTransferHistoryMaxBytes {
		return nil, errors.New("transfer history exceeds file-size limit")
	}
	var snapshot agentTransferHistoryFile
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return nil, fmt.Errorf("parse local transfer history: %w", err)
	}
	if snapshot.Version != agentTransferHistoryVersion || snapshot.Owner != key {
		return nil, errors.New("transfer history version or account key differs")
	}
	if len(snapshot.Tasks) > transfer.DefaultPersistedHistoryRows {
		return nil, errors.New("transfer history exceeds task count limit")
	}
	return snapshot.Tasks, nil
}

// Atomic replacement and 0600 permissions prevent a crash from leaving
// partially written history or exposing filenames to other OS users.
func writeAgentTransferHistory(path, key string, tasks []transfer.Task) error {
	data, err := json.Marshal(agentTransferHistoryFile{
		Version: agentTransferHistoryVersion,
		Owner:   key,
		SavedAt: time.Now().UTC(),
		Tasks:   tasks,
	})
	if err != nil {
		return err
	}
	if len(data) > agentTransferHistoryMaxBytes {
		return errors.New("transfer history exceeds file-size limit")
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "transfer-history-*.tmp")
	if err != nil {
		return err
	}
	tempName := tmp.Name()
	defer os.Remove(tempName)
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tempName, path); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
}

// Called with c.historyMu held, so old and new account snapshots
// cannot be crossed by a concurrent completion event or buffered wakeup.
func (c *agentController) persistTransferHistoryLocked() error {
	if c.historyPath == "" || c.historyKey == "" {
		return nil
	}
	tasks := c.transfers.HistorySnapshot(transfer.DefaultPersistedHistoryRows)
	return writeAgentTransferHistory(c.historyPath, c.historyKey, tasks)
}

func (c *agentController) flushTransferHistory() {
	c.historyMu.Lock()
	defer c.historyMu.Unlock()
	if err := c.persistTransferHistoryLocked(); err != nil {
		log.Printf("xDrive transfer history write failed: %v", err)
	}
}

func (c *agentController) runTransferHistoryWriter(ctx context.Context) {
	for {
		select {
		case <-c.transfers.HistoryEvents():
			c.flushTransferHistory()
		case <-ctx.Done():
			c.flushTransferHistory()
			return
		}
	}
}

func (c *agentController) loadInitialTransferHistory() {
	cfg, err := userconfig.Load()
	if err != nil || cfg.SessionInvalid {
		return
	}
	path, key, err := agentTransferHistoryIdentity(cfg)
	if err != nil {
		log.Printf("xDrive transfer history scope unavailable: %v", err)
		return
	}
	c.historyPath = path
	c.historyKey = key
	tasks, err := readAgentTransferHistory(path, key)
	if err != nil {
		log.Printf("xDrive transfer history read failed: %v", err)
		return
	}
	if err := c.transfers.RestoreHistory(tasks); err != nil {
		log.Printf("xDrive transfer history restore failed: %v", err)
	}
}

func (c *agentController) switchTransferHistory(cfg userconfig.Config) {
	c.historyMu.Lock()
	defer c.historyMu.Unlock()
	if err := c.persistTransferHistoryLocked(); err != nil {
		log.Printf("xDrive previous transfer history write failed: %v", err)
	}
	// Previous in-memory entries must not be visible under a new identity.
	c.transfers.Clear()
	c.historyPath = ""
	c.historyKey = ""
	path, key, err := agentTransferHistoryIdentity(cfg)
	if err != nil {
		log.Printf("xDrive transfer history scope unavailable: %v", err)
		return
	}
	c.historyPath = path
	c.historyKey = key
	tasks, err := readAgentTransferHistory(path, key)
	if err != nil {
		log.Printf("xDrive transfer history read failed: %v", err)
		return
	}
	if err := c.transfers.RestoreHistory(tasks); err != nil {
		log.Printf("xDrive transfer history restore failed: %v", err)
	}
}

func (c *agentController) stopTransferHistory() {
	c.historyMu.Lock()
	defer c.historyMu.Unlock()
	if err := c.persistTransferHistoryLocked(); err != nil {
		log.Printf("xDrive transfer history write failed at logout: %v", err)
	}
	c.historyPath = ""
	c.historyKey = ""
	c.transfers.Clear()
}
