//go:build windows

package mount

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
)

const winBaselineStateVersion = 1

type winBaselineStateFile struct {
	Version int                         `json:"version"`
	Entries map[string]winBaselineEntry `json:"entries"`
}

type winBaselineEntry struct {
	Node         client.Node `json:"node"`
	LocalModTime time.Time   `json:"local_mod_time,omitempty"`
	LocalSize    int64       `json:"local_size"`
}

func (p *winProvider) loadPersistedBaseline() (map[string]winState, bool, error) {
	if p.statePath == "" {
		return nil, false, nil
	}
	data, err := os.ReadFile(p.statePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("read Windows sync baseline: %w", err)
	}
	var state winBaselineStateFile
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, false, fmt.Errorf("decode Windows sync baseline: %w", err)
	}
	if state.Version != winBaselineStateVersion || len(state.Entries) == 0 {
		return nil, false, fmt.Errorf("unsupported or empty Windows sync baseline")
	}
	out := make(map[string]winState, len(state.Entries))
	for rel, entry := range state.Entries {
		if rel != "" && p.policy.excludedPath(rel) {
			continue
		}
		if entry.Node.ID == 0 {
			return nil, false, fmt.Errorf("invalid Windows sync baseline node at %q", rel)
		}
		out[rel] = winState{
			node: entry.Node, localModTime: entry.LocalModTime, localSize: entry.LocalSize,
		}
	}
	if _, ok := out[""]; !ok {
		return nil, false, fmt.Errorf("Windows sync baseline is missing root")
	}
	return out, true, nil
}

func (p *winProvider) persistBaseline(baseline map[string]winState) error {
	if p.statePath == "" {
		return nil
	}
	state := winBaselineStateFile{
		Version: winBaselineStateVersion,
		Entries: make(map[string]winBaselineEntry, len(baseline)),
	}
	for rel, entry := range baseline {
		state.Entries[rel] = winBaselineEntry{
			Node: entry.node, LocalModTime: entry.localModTime, LocalSize: entry.localSize,
		}
	}
	data, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("encode Windows sync baseline: %w", err)
	}
	dir := filepath.Dir(p.statePath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create Windows sync state directory: %w", err)
	}
	tmp, err := os.CreateTemp(dir, "baseline-*.tmp")
	if err != nil {
		return fmt.Errorf("create Windows sync baseline temp file: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
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
	if err := os.Rename(tmpName, p.statePath); err != nil {
		return fmt.Errorf("replace Windows sync baseline: %w", err)
	}
	_ = os.Chmod(p.statePath, 0o600)
	return nil
}
