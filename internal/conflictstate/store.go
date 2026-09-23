package conflictstate

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type Record struct {
	ID             string    `json:"id"`
	OriginalPath   string    `json:"original_path"`
	ConflictPath   string    `json:"conflict_path"`
	OriginalNodeID uint64    `json:"original_node_id,omitempty"`
	ConflictNodeID uint64    `json:"conflict_node_id,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

type fileData struct {
	Version   int      `json:"version"`
	Conflicts []Record `json:"conflicts"`
}

var mu sync.Mutex

func Path(configDir string) string {
	return filepath.Join(configDir, "conflicts.json")
}

func List(configDir string) ([]Record, error) {
	mu.Lock()
	defer mu.Unlock()
	return listUnlocked(configDir)
}

func Upsert(configDir string, record Record) error {
	mu.Lock()
	defer mu.Unlock()
	record.ID = strings.TrimSpace(record.ID)
	record.OriginalPath = filepath.Clean(strings.TrimSpace(record.OriginalPath))
	record.ConflictPath = filepath.Clean(strings.TrimSpace(record.ConflictPath))
	if record.ID == "" {
		record.ID = record.ConflictPath
	}
	if record.CreatedAt.IsZero() {
		record.CreatedAt = time.Now().UTC()
	}
	items, err := listUnlocked(configDir)
	if err != nil {
		return err
	}
	replaced := false
	for i := range items {
		if items[i].ID == record.ID {
			items[i] = record
			replaced = true
			break
		}
	}
	if !replaced {
		items = append(items, record)
	}
	return writeUnlocked(configDir, items)
}

func Remove(configDir, id string) error {
	mu.Lock()
	defer mu.Unlock()
	items, err := listUnlocked(configDir)
	if err != nil {
		return err
	}
	id = strings.TrimSpace(id)
	out := items[:0]
	for _, item := range items {
		if item.ID != id {
			out = append(out, item)
		}
	}
	if len(out) == len(items) {
		return nil
	}
	return writeUnlocked(configDir, out)
}

func ClearMissing(configDir string, exists func(Record) bool) error {
	mu.Lock()
	defer mu.Unlock()
	items, err := listUnlocked(configDir)
	if err != nil {
		return err
	}
	out := items[:0]
	for _, item := range items {
		if exists(item) {
			out = append(out, item)
		}
	}
	if len(out) == len(items) {
		return nil
	}
	return writeUnlocked(configDir, out)
}

func listUnlocked(configDir string) ([]Record, error) {
	b, err := os.ReadFile(Path(configDir))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	var data fileData
	if err := json.Unmarshal(b, &data); err != nil {
		return nil, err
	}
	items := append([]Record(nil), data.Conflicts...)
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedAt.After(items[j].CreatedAt)
	})
	return items, nil
}

func writeUnlocked(configDir string, items []Record) error {
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		return err
	}
	_ = os.Chmod(configDir, 0o700)
	data := fileData{Version: 1, Conflicts: append([]Record(nil), items...)}
	b, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(configDir, "conflicts-*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(b); err != nil {
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
	if err := os.Rename(name, Path(configDir)); err != nil {
		return err
	}
	_ = os.Chmod(Path(configDir), 0o600)
	return nil
}
