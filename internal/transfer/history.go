package transfer

import (
	"errors"
	"strconv"
	"strings"
)

// Maximum terminal task records persisted on an Agent device. Keep every
// eligible root summary first; large folders may have bounded child history.
const DefaultPersistedHistoryRows = 10000

// HistoryEvents is edge-triggered and coalesces bursts. It is deliberately
// independent of normal byte-progress events to avoid disk writes per chunk.
func (m *Manager) HistoryEvents() <-chan struct{} {
	if m == nil {
		return nil
	}
	return m.historyDirty
}

func (m *Manager) markHistoryDirtyLocked() {
	if m.historyDirty == nil {
		return
	}
	select {
	case m.historyDirty <- struct{}{}:
	default:
	}
}

// A grouped child finishing is not by itself a durable history event while
// the group remains active. Once its root is terminal, late children trigger
// a new snapshot (which still excludes any roots with active descendants).
func (m *Manager) markHistoryDirtyForLocked(id string) {
	e := m.entries[id]
	if e == nil {
		return
	}
	root := m.entries[transferRootID(e.task)]
	if root != nil && terminalState(root.task.State) {
		m.markHistoryDirtyLocked()
	}
}

func terminalHistoryCopy(task Task) Task {
	task.InstantBytesPerSecond = 0
	task.SpeedUpdatedAt = nil
	task.Cancelable = false
	task.Retryable = false // Go callbacks cannot survive an Agent restart.
	return task
}

// HistorySnapshot returns a bounded, self-contained collection of fully
// terminal roots and their terminal children. It never persists in-progress
// tasks and always retains root summaries before optional child details.
func (m *Manager) HistorySnapshot(limit int) []Task {
	if m == nil {
		return nil
	}
	if limit <= 0 || limit > DefaultPersistedHistoryRows {
		limit = DefaultPersistedHistoryRows
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	eligible := make(map[string]bool)
	active := make(map[string]bool)
	for _, id := range m.order {
		if e := m.entries[id]; e != nil {
			rootID := transferRootID(e.task)
			if e.task.ID == rootID && terminalState(e.task.State) {
				eligible[rootID] = true
			}
			if activeState(e.task.State) {
				active[rootID] = true
			}
		}
	}
	for id := range active {
		delete(eligible, id)
	}
	selected := make(map[string]bool, len(eligible))
	out := make([]Task, 0, min(limit, len(m.order)))
	for _, id := range m.order {
		e := m.entries[id]
		if e == nil || len(out) >= limit {
			continue
		}
		if e.task.ID != transferRootID(e.task) || !eligible[e.task.ID] {
			continue
		}
		out = append(out, terminalHistoryCopy(e.task))
		selected[e.task.ID] = true
	}
	for _, id := range m.order {
		if len(out) >= limit {
			break
		}
		e := m.entries[id]
		if e == nil || e.task.ParentID == "" || !terminalState(e.task.State) ||
			!eligible[transferRootID(e.task)] || !selected[e.task.ParentID] {
			continue
		}
		out = append(out, terminalHistoryCopy(e.task))
		selected[id] = true
	}
	return out
}

// RestoreHistory is only called after clearing the previous account context.
// Historical callbacks and current speeds are never restored as live work.
func (m *Manager) RestoreHistory(tasks []Task) error {
	if m == nil {
		return errors.New("transfer manager is unavailable")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.entries) != 0 {
		return errors.New("cannot restore history into a nonempty manager")
	}
	if len(tasks) > DefaultPersistedHistoryRows {
		return errors.New("transfer history exceeds the persisted task limit")
	}
	for _, item := range tasks {
		if item.ID == "" || len(item.ID) > 128 || !terminalState(item.State) ||
			m.entries[item.ID] != nil {
			continue
		}
		if item.ParentID != "" && m.entries[item.ParentID] == nil {
			continue
		}
		if item.RootID == "" {
			item.RootID = item.ID
		}
		item = terminalHistoryCopy(item)
		m.entries[item.ID] = &entry{task: item}
		m.order = append(m.order, item.ID)
		m.roots[transferRootID(item)] = struct{}{}
		if strings.HasPrefix(item.ID, "transfer-") {
			if n, err := strconv.ParseUint(strings.TrimPrefix(item.ID, "transfer-"), 10, 64); err == nil && n > m.nextID {
				m.nextID = n
			}
		}
	}
	m.trimLocked()
	m.touchLocked()
	return nil
}
