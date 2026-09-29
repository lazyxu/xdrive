//go:build windows

package mount

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
)

const (
	winBaselineLegacyStateVersion = 1
	winBaselineStateMagic         = "XDRIVE_BASELINE_V2\n"
	winBaselineMaxFrameBytes      = 1 << 30
	winBaselineCompactDeltaBytes  = 64 << 20
	winBaselineCompactFrames      = 10_000
)

type winBaselineStateFile struct {
	Version int                         `json:"version"`
	Entries map[string]winBaselineEntry `json:"entries"`
}

type winBaselineEntry struct {
	Node         client.Node `json:"node"`
	LocalModTime time.Time   `json:"local_mod_time,omitempty"`
	LocalSize    int64       `json:"local_size"`
}

type winBaselineDelta struct {
	Puts    map[string]winBaselineEntry `json:"puts,omitempty"`
	Deletes []string                    `json:"deletes,omitempty"`
}

func (p *winProvider) loadPersistedBaseline() (map[string]winState, bool, error) {
	if p.statePath == "" {
		return nil, false, nil
	}
	f, err := os.Open(p.statePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			p.setBaselineStateStats(0, 0)
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("open Windows sync baseline: %w", err)
	}
	prefix := make([]byte, len(winBaselineStateMagic))
	n, prefixErr := io.ReadFull(f, prefix)
	_ = f.Close()
	if prefixErr == nil && bytes.Equal(prefix, []byte(winBaselineStateMagic)) {
		out, frames, deltaBytes, err := p.loadBaselineLog()
		if err != nil {
			return nil, false, err
		}
		p.setBaselineStateStats(frames, deltaBytes)
		filtered, err := p.filterLoadedBaseline(out)
		return filtered, err == nil, err
	}
	if prefixErr != nil && !errors.Is(prefixErr, io.EOF) && !errors.Is(prefixErr, io.ErrUnexpectedEOF) {
		return nil, false, fmt.Errorf("read Windows sync baseline header: %w", prefixErr)
	}
	if n > 0 && bytes.HasPrefix([]byte(winBaselineStateMagic), prefix[:n]) {
		return nil, false, fmt.Errorf("truncated Windows sync baseline header")
	}

	data, err := os.ReadFile(p.statePath)
	if err != nil {
		return nil, false, fmt.Errorf("read legacy Windows sync baseline: %w", err)
	}
	var legacy winBaselineStateFile
	if err := json.Unmarshal(data, &legacy); err != nil {
		return nil, false, fmt.Errorf("decode Windows sync baseline: %w", err)
	}
	if legacy.Version != winBaselineLegacyStateVersion || len(legacy.Entries) == 0 {
		return nil, false, fmt.Errorf("unsupported or empty Windows sync baseline")
	}
	out := make(map[string]winState, len(legacy.Entries))
	for rel, entry := range legacy.Entries {
		out[rel] = winState{
			node: entry.Node, localModTime: entry.LocalModTime, localSize: entry.LocalSize,
		}
	}
	if err := validateLoadedBaseline(out); err != nil {
		return nil, false, err
	}
	// Migrate the old whole-file JSON snapshot in place. The logical path stays
	// unchanged so upgrades and repair flows do not need a second state path.
	if err := p.persistBaseline(out); err != nil {
		return nil, false, fmt.Errorf("migrate Windows sync baseline: %w", err)
	}
	filtered, err := p.filterLoadedBaseline(out)
	return filtered, err == nil, err
}

func (p *winProvider) loadBaselineLog() (map[string]winState, int, int64, error) {
	f, err := os.OpenFile(p.statePath, os.O_RDWR, 0)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("open Windows sync baseline log: %w", err)
	}
	defer f.Close()

	header := make([]byte, len(winBaselineStateMagic))
	if _, err := io.ReadFull(f, header); err != nil {
		return nil, 0, 0, fmt.Errorf("read Windows sync baseline header: %w", err)
	}
	if string(header) != winBaselineStateMagic {
		return nil, 0, 0, fmt.Errorf("unsupported Windows sync baseline format")
	}

	out := make(map[string]winState)
	validEnd := int64(len(header))
	frames := 0
	var deltaBytes int64
	for {
		frameStart := validEnd
		var lenBuf [4]byte
		_, err := io.ReadFull(f, lenBuf[:])
		if errors.Is(err, io.EOF) {
			break
		}
		if errors.Is(err, io.ErrUnexpectedEOF) {
			if err := truncateBaselineTail(f, validEnd); err != nil {
				return nil, 0, 0, fmt.Errorf("truncate partial Windows sync baseline frame: %w", err)
			}
			break
		}
		if err != nil {
			return nil, 0, 0, fmt.Errorf("read Windows sync baseline frame length: %w", err)
		}
		payloadLen := int64(binary.LittleEndian.Uint32(lenBuf[:]))
		if payloadLen <= 0 || payloadLen > winBaselineMaxFrameBytes {
			return nil, 0, 0, fmt.Errorf("invalid Windows sync baseline frame length %d", payloadLen)
		}

		payload := make([]byte, payloadLen)
		if _, err := io.ReadFull(f, payload); err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				if truncateErr := truncateBaselineTail(f, validEnd); truncateErr != nil {
					return nil, 0, 0, fmt.Errorf("truncate partial Windows sync baseline payload: %w", truncateErr)
				}
				break
			}
			return nil, 0, 0, fmt.Errorf("read Windows sync baseline frame: %w", err)
		}
		var crcBuf [4]byte
		if _, err := io.ReadFull(f, crcBuf[:]); err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				if truncateErr := truncateBaselineTail(f, validEnd); truncateErr != nil {
					return nil, 0, 0, fmt.Errorf("truncate partial Windows sync baseline checksum: %w", truncateErr)
				}
				break
			}
			return nil, 0, 0, fmt.Errorf("read Windows sync baseline checksum: %w", err)
		}
		if got, want := crc32.ChecksumIEEE(payload), binary.LittleEndian.Uint32(crcBuf[:]); got != want {
			return nil, 0, 0, fmt.Errorf("Windows sync baseline frame checksum mismatch")
		}

		var delta winBaselineDelta
		if err := json.Unmarshal(payload, &delta); err != nil {
			return nil, 0, 0, fmt.Errorf("decode Windows sync baseline frame: %w", err)
		}
		applyBaselineDelta(out, delta)
		frames++
		frameBytes := int64(8) + payloadLen
		validEnd = frameStart + frameBytes
		if frames > 1 {
			deltaBytes += frameBytes
		}
	}
	if frames == 0 {
		return nil, 0, 0, fmt.Errorf("empty Windows sync baseline log")
	}
	if err := validateLoadedBaseline(out); err != nil {
		return nil, 0, 0, err
	}
	return out, frames, deltaBytes, nil
}

func (p *winProvider) filterLoadedBaseline(in map[string]winState) (map[string]winState, error) {
	out := make(map[string]winState, len(in))
	for rel, state := range in {
		if rel != "" && p.policy.excludedPath(rel) {
			continue
		}
		if state.node.ID == 0 {
			return nil, fmt.Errorf("invalid Windows sync baseline node at %q", rel)
		}
		out[rel] = state
	}
	if _, ok := out[""]; !ok {
		return nil, fmt.Errorf("Windows sync baseline is missing root")
	}
	return out, nil
}

func validateLoadedBaseline(in map[string]winState) error {
	if len(in) == 0 {
		return fmt.Errorf("empty Windows sync baseline")
	}
	for rel, state := range in {
		if state.node.ID == 0 {
			return fmt.Errorf("invalid Windows sync baseline node at %q", rel)
		}
	}
	if _, ok := in[""]; !ok {
		return fmt.Errorf("Windows sync baseline is missing root")
	}
	return nil
}

func applyBaselineDelta(baseline map[string]winState, delta winBaselineDelta) {
	for _, rel := range delta.Deletes {
		delete(baseline, rel)
	}
	for rel, entry := range delta.Puts {
		baseline[rel] = winState{
			node: entry.Node, localModTime: entry.LocalModTime, localSize: entry.LocalSize,
		}
	}
}

func (p *winProvider) persistBaseline(baseline map[string]winState) error {
	if p.statePath == "" {
		p.setBaselineStateStats(0, 0)
		return nil
	}
	if err := validateLoadedBaseline(baseline); err != nil {
		return err
	}
	delta := winBaselineDelta{Puts: baselineEntries(baseline)}
	frame, err := encodeBaselineFrame(delta)
	if err != nil {
		return err
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
	if err := writeBaselineBytes(tmp, []byte(winBaselineStateMagic)); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := writeBaselineBytes(tmp, frame); err != nil {
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
	p.setBaselineStateStats(1, 0)
	return nil
}

func (p *winProvider) persistBaselineDelta(previous, current map[string]winState) error {
	if p.statePath == "" {
		return nil
	}
	delta := diffBaseline(previous, current)
	if len(delta.Puts) == 0 && len(delta.Deletes) == 0 {
		return nil
	}
	if _, err := os.Stat(p.statePath); errors.Is(err, os.ErrNotExist) {
		return p.persistBaseline(current)
	} else if err != nil {
		return err
	}

	frame, err := encodeBaselineFrame(delta)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(p.statePath, os.O_WRONLY|os.O_APPEND, 0)
	if err != nil {
		return fmt.Errorf("open Windows sync baseline for append: %w", err)
	}
	if err := writeBaselineBytes(f, frame); err != nil {
		_ = f.Close()
		return fmt.Errorf("append Windows sync baseline: %w", err)
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return fmt.Errorf("sync Windows sync baseline: %w", err)
	}
	if err := f.Close(); err != nil {
		return err
	}

	frames, deltaBytes := p.addBaselineStateStats(int64(len(frame)))
	if frames >= winBaselineCompactFrames || deltaBytes >= winBaselineCompactDeltaBytes {
		if err := p.persistBaseline(current); err != nil {
			return fmt.Errorf("compact Windows sync baseline: %w", err)
		}
	}
	return nil
}

func diffBaseline(previous, current map[string]winState) winBaselineDelta {
	delta := winBaselineDelta{}
	for rel, before := range previous {
		after, exists := current[rel]
		if !exists {
			delta.Deletes = append(delta.Deletes, rel)
			continue
		}
		if baselineStateEqual(before, after) {
			continue
		}
		if delta.Puts == nil {
			delta.Puts = make(map[string]winBaselineEntry)
		}
		delta.Puts[rel] = baselineEntry(after)
	}
	for rel, after := range current {
		if _, exists := previous[rel]; exists {
			continue
		}
		if delta.Puts == nil {
			delta.Puts = make(map[string]winBaselineEntry)
		}
		delta.Puts[rel] = baselineEntry(after)
	}
	sort.Strings(delta.Deletes)
	return delta
}

func baselineEntries(baseline map[string]winState) map[string]winBaselineEntry {
	out := make(map[string]winBaselineEntry, len(baseline))
	for rel, state := range baseline {
		out[rel] = baselineEntry(state)
	}
	return out
}

func baselineEntry(state winState) winBaselineEntry {
	return winBaselineEntry{
		Node: state.node, LocalModTime: state.localModTime, LocalSize: state.localSize,
	}
}

func baselineStateEqual(a, b winState) bool {
	return a.node.ID == b.node.ID &&
		sameOptionalUint64(a.node.ParentID, b.node.ParentID) &&
		a.node.Name == b.node.Name &&
		a.node.Type == b.node.Type &&
		a.node.Size == b.node.Size &&
		a.node.Revision == b.node.Revision &&
		a.node.SHA256 == b.node.SHA256 &&
		sameOptionalTime(a.node.DeletedAt, b.node.DeletedAt) &&
		a.node.CreatedAt.Equal(b.node.CreatedAt) &&
		a.node.UpdatedAt.Equal(b.node.UpdatedAt) &&
		a.localModTime.Equal(b.localModTime) &&
		a.localSize == b.localSize
}

func sameOptionalUint64(a, b *uint64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func sameOptionalTime(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return a.Equal(*b)
}

func encodeBaselineFrame(delta winBaselineDelta) ([]byte, error) {
	payload, err := json.Marshal(delta)
	if err != nil {
		return nil, fmt.Errorf("encode Windows sync baseline delta: %w", err)
	}
	if len(payload) == 0 || int64(len(payload)) > winBaselineMaxFrameBytes {
		return nil, fmt.Errorf("Windows sync baseline frame is too large: %d bytes", len(payload))
	}
	frame := make([]byte, 4+len(payload)+4)
	binary.LittleEndian.PutUint32(frame[:4], uint32(len(payload)))
	copy(frame[4:], payload)
	binary.LittleEndian.PutUint32(frame[4+len(payload):], crc32.ChecksumIEEE(payload))
	return frame, nil
}

func writeBaselineBytes(f *os.File, data []byte) error {
	n, err := f.Write(data)
	if err != nil {
		return err
	}
	if n != len(data) {
		return io.ErrShortWrite
	}
	return nil
}

func truncateBaselineTail(f *os.File, size int64) error {
	if err := f.Truncate(size); err != nil {
		return err
	}
	return f.Sync()
}

func (p *winProvider) setBaselineStateStats(frames int, deltaBytes int64) {
	p.mu.Lock()
	p.stateFrames = frames
	p.stateDeltaBytes = deltaBytes
	p.mu.Unlock()
}

func (p *winProvider) addBaselineStateStats(frameBytes int64) (int, int64) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.stateFrames++
	p.stateDeltaBytes += frameBytes
	return p.stateFrames, p.stateDeltaBytes
}
