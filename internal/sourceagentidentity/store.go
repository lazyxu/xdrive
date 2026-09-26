package sourceagentidentity

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/sourceagent"
)

const stateVersion = 1

type record struct {
	ExternalID         string
	StrongKey          string
	WeakKey            string
	Kind               string
	Path               string
	Size               int64
	ModifiedUnixNano   int64
	HasModified        bool
	LastSeenGeneration uint64
}

type metaFile struct {
	Version    int
	Generation uint64
}

type shardFile struct {
	Version int
	Records []record
}

type Store struct {
	mu sync.Mutex

	dir        string
	generation uint64
	records    map[string]*record
	shards     map[byte]map[string]*record
	byStrong   map[string]string
	byWeak     map[string][]string
	dirty      map[byte]struct{}
	touched    map[string]struct{}
}

func Open(dir string) (*Store, error) {
	dir = filepath.Clean(strings.TrimSpace(dir))
	if dir == "" || dir == "." {
		return nil, fmt.Errorf("identity state directory is required")
	}
	s := &Store{
		dir:      dir,
		records:  make(map[string]*record),
		shards:   make(map[byte]map[string]*record),
		byStrong: make(map[string]string),
		byWeak:   make(map[string][]string),
		dirty:    make(map[byte]struct{}),
		touched:  make(map[string]struct{}),
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) Resolve(obs sourceagent.IdentityObservation) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	legacy := strings.TrimSpace(obs.Filesystem.LegacyExternalID)
	strong := strings.TrimSpace(obs.Filesystem.StrongKey)
	weak := strings.TrimSpace(obs.Filesystem.WeakKey)
	if legacy == "" || weak == "" {
		return "", fmt.Errorf("filesystem identity is incomplete")
	}
	if strings.TrimSpace(obs.Kind) == "" || strings.TrimSpace(obs.Path) == "" {
		return "", fmt.Errorf("identity observation kind and path are required")
	}

	if strong != "" {
		if externalID, ok := s.byStrong[strong]; ok {
			rec := s.records[externalID]
			s.updateRecord(rec, obs)
			return externalID, nil
		}
		if rec := s.matchWeakForStrongMigration(weak, obs); rec != nil {
			rec.StrongKey = strong
			s.byStrong[strong] = rec.ExternalID
			s.updateRecord(rec, obs)
			return rec.ExternalID, nil
		}
	} else if rec := s.matchWeakFallback(weak, obs); rec != nil {
		s.updateRecord(rec, obs)
		return rec.ExternalID, nil
	}

	externalID := legacy
	if _, exists := s.records[externalID]; exists {
		externalID = "fs2:" + rootFromWeakKey(weak) + ":" + uuid.NewString()
	}
	rec := &record{ExternalID: externalID, StrongKey: strong, WeakKey: weak}
	s.addRecord(rec)
	s.updateRecord(rec, obs)
	return externalID, nil
}

func (s *Store) Flush() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.flushUnlocked()
}

func (s *Store) Complete() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	next := s.generation + 1
	for externalID := range s.touched {
		rec := s.records[externalID]
		if rec == nil {
			continue
		}
		rec.LastSeenGeneration = next
		s.dirty[shardFor(externalID)] = struct{}{}
	}
	if err := s.flushUnlocked(); err != nil {
		return err
	}
	if err := writeJSONAtomic(s.dir, "meta.json", metaFile{Version: stateVersion, Generation: next}); err != nil {
		return err
	}
	s.generation = next
	clear(s.touched)
	return nil
}

func (s *Store) Generation() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.generation
}

func (s *Store) load() error {
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return err
	}
	_ = os.Chmod(s.dir, 0o700)

	metaPath := filepath.Join(s.dir, "meta.json")
	data, err := os.ReadFile(metaPath)
	if err == nil {
		var meta metaFile
		if err := json.Unmarshal(data, &meta); err != nil {
			return fmt.Errorf("read identity meta: %w", err)
		}
		if meta.Version != stateVersion {
			return fmt.Errorf("unsupported identity state version %d", meta.Version)
		}
		s.generation = meta.Generation
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}

	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), "shard-") || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		index, ok := parseShardName(entry.Name())
		if !ok {
			return fmt.Errorf("invalid identity shard filename %q", entry.Name())
		}
		data, err := os.ReadFile(filepath.Join(s.dir, entry.Name()))
		if err != nil {
			return err
		}
		var shard shardFile
		if err := json.Unmarshal(data, &shard); err != nil {
			return fmt.Errorf("read identity shard %s: %w", entry.Name(), err)
		}
		if shard.Version != stateVersion {
			return fmt.Errorf("unsupported identity shard version %d", shard.Version)
		}
		for i := range shard.Records {
			copy := shard.Records[i]
			if copy.ExternalID == "" || copy.WeakKey == "" || shardFor(copy.ExternalID) != index {
				return fmt.Errorf("invalid identity record in %s", entry.Name())
			}
			if _, exists := s.records[copy.ExternalID]; exists {
				return fmt.Errorf("duplicate identity external id %q", copy.ExternalID)
			}
			if copy.StrongKey != "" {
				if existing, exists := s.byStrong[copy.StrongKey]; exists {
					return fmt.Errorf("duplicate strong identity %q for %q and %q", copy.StrongKey, existing, copy.ExternalID)
				}
			}
			s.addRecord(&copy)
		}
	}
	return nil
}

func (s *Store) addRecord(rec *record) {
	s.records[rec.ExternalID] = rec
	index := shardFor(rec.ExternalID)
	if s.shards[index] == nil {
		s.shards[index] = make(map[string]*record)
	}
	s.shards[index][rec.ExternalID] = rec
	if rec.StrongKey != "" {
		s.byStrong[rec.StrongKey] = rec.ExternalID
	}
	s.byWeak[rec.WeakKey] = append(s.byWeak[rec.WeakKey], rec.ExternalID)
}

func (s *Store) updateRecord(rec *record, obs sourceagent.IdentityObservation) {
	if rec == nil {
		return
	}
	newStrong := strings.TrimSpace(obs.Filesystem.StrongKey)
	newWeak := strings.TrimSpace(obs.Filesystem.WeakKey)
	if rec.StrongKey == "" && newStrong != "" {
		rec.StrongKey = newStrong
		s.byStrong[newStrong] = rec.ExternalID
	}
	if rec.WeakKey != newWeak && newWeak != "" {
		s.removeWeak(rec.WeakKey, rec.ExternalID)
		rec.WeakKey = newWeak
		s.byWeak[newWeak] = append(s.byWeak[newWeak], rec.ExternalID)
	}
	rec.Kind = obs.Kind
	rec.Path = obs.Path
	rec.Size = obs.Size
	rec.LastSeenGeneration = s.generation
	if obs.ModifiedAt != nil {
		rec.HasModified = true
		rec.ModifiedUnixNano = obs.ModifiedAt.UTC().UnixNano()
	} else {
		rec.HasModified = false
		rec.ModifiedUnixNano = 0
	}
	s.touched[rec.ExternalID] = struct{}{}
	s.dirty[shardFor(rec.ExternalID)] = struct{}{}
}

func (s *Store) matchWeakForStrongMigration(weak string, obs sourceagent.IdentityObservation) *record {
	for _, externalID := range s.byWeak[weak] {
		rec := s.records[externalID]
		if rec == nil || rec.StrongKey != "" {
			continue
		}
		if generationIsCurrent(rec.LastSeenGeneration, s.generation) || metadataMatches(rec, obs) {
			return rec
		}
	}
	return nil
}

func (s *Store) matchWeakFallback(weak string, obs sourceagent.IdentityObservation) *record {
	var candidates []*record
	for _, externalID := range s.byWeak[weak] {
		if rec := s.records[externalID]; rec != nil {
			candidates = append(candidates, rec)
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].LastSeenGeneration > candidates[j].LastSeenGeneration
	})
	for _, rec := range candidates {
		if generationIsCurrent(rec.LastSeenGeneration, s.generation) {
			return rec
		}
		if metadataMatches(rec, obs) {
			return rec
		}
	}
	return nil
}

func generationIsCurrent(recordGeneration, currentGeneration uint64) bool {
	if recordGeneration == currentGeneration {
		return true
	}
	return currentGeneration != ^uint64(0) && recordGeneration == currentGeneration+1
}

func metadataMatches(rec *record, obs sourceagent.IdentityObservation) bool {
	if rec == nil || rec.Kind != obs.Kind || rec.Path != obs.Path || rec.Size != obs.Size {
		return false
	}
	if rec.HasModified != (obs.ModifiedAt != nil) {
		return false
	}
	if !rec.HasModified {
		return true
	}
	return rec.ModifiedUnixNano == obs.ModifiedAt.UTC().UnixNano()
}

func (s *Store) removeWeak(key, externalID string) {
	items := s.byWeak[key]
	out := items[:0]
	for _, candidate := range items {
		if candidate != externalID {
			out = append(out, candidate)
		}
	}
	if len(out) == 0 {
		delete(s.byWeak, key)
	} else {
		s.byWeak[key] = out
	}
}

func (s *Store) flushUnlocked() error {
	if len(s.dirty) == 0 {
		return nil
	}
	indices := make([]int, 0, len(s.dirty))
	for index := range s.dirty {
		indices = append(indices, int(index))
	}
	sort.Ints(indices)
	for _, rawIndex := range indices {
		index := byte(rawIndex)
		records := make([]record, 0, len(s.shards[index]))
		for _, rec := range s.shards[index] {
			records = append(records, *rec)
		}
		sort.Slice(records, func(i, j int) bool {
			return records[i].ExternalID < records[j].ExternalID
		})
		name := fmt.Sprintf("shard-%02x.json", index)
		if err := writeJSONAtomic(s.dir, name, shardFile{Version: stateVersion, Records: records}); err != nil {
			return err
		}
		delete(s.dirty, index)
	}
	return nil
}

func writeJSONAtomic(dir, name string, value any) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	_ = os.Chmod(dir, 0o700)
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, name+".*.tmp")
	if err != nil {
		return err
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
	target := filepath.Join(dir, name)
	if err := os.Rename(tmpName, target); err != nil {
		return err
	}
	_ = os.Chmod(target, 0o600)
	return nil
}

func shardFor(externalID string) byte {
	sum := sha256.Sum256([]byte(externalID))
	return sum[0]
}

func rootFromWeakKey(weak string) string {
	parts := strings.SplitN(weak, ":", 3)
	if len(parts) == 3 && parts[0] == "ino" && parts[1] != "" {
		return parts[1]
	}
	return "unknown"
}

func parseShardName(name string) (byte, bool) {
	value := strings.TrimSuffix(strings.TrimPrefix(name, "shard-"), ".json")
	if len(value) != 2 {
		return 0, false
	}
	parsed, err := strconv.ParseUint(value, 16, 8)
	if err != nil {
		return 0, false
	}
	return byte(parsed), true
}
