// Package localpushqueue is the Agent-private durable work list for Push v2.
// It does not upload bytes, authorize a Source, or declare a complete backup.
// The existing original Operation journal and generic /uploads writer remain
// the sole authorities for a file's physical upload and SQL/CAS commit.
package localpushqueue

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
)

const version = 1
const maxTasks = 250000

var ErrQuarantined = errors.New("local Push task queue requires original-operation reconciliation")

// Scope is constructed only from the authenticated owning Agent and a fully
// verified CURRENT inventory. No renderer path, credential, or Device token
// is accepted here. It is deliberately bound to a single snapshot/revision.
type Scope struct {
	Server          string `json:"server"`
	Account         string `json:"account"`
	DeviceID        string `json:"device_id"`
	RootID          string `json:"root_id"`
	RootFingerprint string `json:"root_fingerprint"`
	SourceID        uint64 `json:"source_id"`
	SourceRevision  uint64 `json:"source_revision"`
	TargetNodeID    uint64 `json:"target_node_id"`
	SnapshotSHA256  string `json:"snapshot_sha256"`
}

// Task is one manifest-derived file, not a new Operation or remote mutation.
// The existing private per-file Plan must mint/persist OperationID before HTTP.
type Task struct {
	Path              string `json:"path"`
	Size              int64  `json:"size"`
	NativeIdentityKey string `json:"native_identity_key"`
}

// Commit is historical evidence returned by the authenticated common uploader
// after it has verified the original immutable SQL Operation. It is *not* a
// statement that today's CAS object exists or that the Source backup finished.
type Commit struct {
	OperationID  string `json:"operation_id"`
	ResumeKey    string `json:"resume_key"`
	NodeID       uint64 `json:"node_id"`
	NodeRevision uint64 `json:"node_revision"`
	ContentSHA   string `json:"content_sha256"`
	Size         int64  `json:"size"`
}

type Stats struct {
	Tasks               int64
	CommittedNow        int64
	HistoricalRechecked int64
}

type manifest struct {
	Version int    `json:"version"`
	Scope   Scope  `json:"scope"`
	Count   int64  `json:"count"`
	SHA256  string `json:"sha256"`
}

type Queue struct {
	dir      string
	scope    Scope
	manifest manifest
}

// No queue/private-path representation may escape through ordinary Agent IPC.
func (Queue) MarshalJSON() ([]byte, error) { return []byte("{}"), nil }

func validSHA(v string) bool {
	if len(v) != 64 {
		return false
	}
	for _, ch := range v {
		if ch < '0' || ch > '9' {
			if ch < 'a' || ch > 'f' {
				return false
			}
		}
	}
	return true
}

func validScope(s Scope) bool {
	return s.Server != "" && s.Account != "" && s.DeviceID != "" &&
		s.RootID != "" && s.SourceID > 0 && s.SourceRevision > 0 &&
		s.TargetNodeID > 0 && validSHA(s.RootFingerprint) &&
		validSHA(s.SnapshotSHA256) &&
		!strings.ContainsAny(s.Server+s.Account+s.DeviceID+s.RootID, "\x00\r\n")
}

func validTask(t Task) bool {
	if t.Path == "" || len(t.Path) > 4096 || t.Size < 0 ||
		!validSHA(t.NativeIdentityKey) || path.Clean(t.Path) != t.Path ||
		strings.HasPrefix(t.Path, "/") || strings.ContainsAny(t.Path, "\\:\x00\r\n") {
		return false
	}
	for _, part := range strings.Split(t.Path, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}

func validCommit(t Task, c Commit) bool {
	return len(c.OperationID) == 36 && strings.Count(c.OperationID, "-") == 4 &&
		len(c.ResumeKey) == 68 && strings.HasPrefix(c.ResumeKey, "lp2_") &&
		validSHA(c.ResumeKey[4:]) && c.NodeID > 0 && c.NodeRevision > 0 &&
		validSHA(c.ContentSHA) && c.Size == t.Size
}

func scopeKey(s Scope) string {
	raw, _ := json.Marshal(s)
	hash := sha256.Sum256(append([]byte("xdrive/localpush/queue/v1\x00"), raw...))
	return hex.EncodeToString(hash[:])
}

func checkPrivateDir(dir string) error {
	if !filepath.IsAbs(dir) || filepath.Clean(dir) != dir {
		return ErrQuarantined
	}
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 ||
		(runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0) {
		return ErrQuarantined
	}
	return nil
}

func checkPrivateFile(file string) error {
	info, err := os.Lstat(file)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 ||
		(runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0) {
		return ErrQuarantined
	}
	return nil
}

func openDir(privateBase string, s Scope) (string, error) {
	if !validScope(s) || !filepath.IsAbs(privateBase) {
		return "", ErrQuarantined
	}
	// Every parent is owned by the Agent; refuse symlinks and permissive
	// directories rather than following an attacker-controlled queue root.
	if err := checkPrivateDir(privateBase); err != nil {
		return "", err
	}
	parent := filepath.Join(privateBase, "common-upload-queues")
	if err := os.MkdirAll(parent, 0700); err != nil {
		return "", err
	}
	if err := checkPrivateDir(parent); err != nil {
		return "", err
	}
	dir := filepath.Join(parent, "queue-"+scopeKey(s))
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	if err := checkPrivateDir(dir); err != nil {
		return "", err
	}
	return dir, nil
}

func syncDir(dir string) error {
	if runtime.GOOS == "windows" {
		return nil
	}
	f, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}

func readJSON(file string, limit int64, value any) error {
	if err := checkPrivateFile(file); err != nil {
		return err
	}
	// Limit the *whole* file, not only what the JSON decoder chooses to read.
	info, err := os.Lstat(file)
	if err != nil || info.Size() < 2 || info.Size() > limit {
		return ErrQuarantined
	}
	f, err := os.Open(file)
	if err != nil {
		return ErrQuarantined
	}
	defer f.Close()
	d := json.NewDecoder(io.LimitReader(f, limit+1))
	d.DisallowUnknownFields()
	if err := d.Decode(value); err != nil {
		return ErrQuarantined
	}
	var trailing any
	if err := d.Decode(&trailing); !errors.Is(err, io.EOF) {
		return ErrQuarantined
	}
	return nil
}

func writeNewJSON(file string, value any) error {
	f, err := os.OpenFile(file, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return ErrQuarantined
	}
	encErr := json.NewEncoder(f).Encode(value)
	syncErr := f.Sync()
	closeErr := f.Close()
	if encErr != nil || syncErr != nil || closeErr != nil {
		return ErrQuarantined
	}
	return syncDir(filepath.Dir(file))
}

// Build publishes a durable immutable queue only AFTER the owning caller's
// complete verified-inventory callback has succeeded. Partial/canceled scans
// can never turn into runnable tasks. Existing queue data is never replaced.
// Queue items contain no Owner JWT, Device token, or absolute native path.
func Build(ctx context.Context, privateBase string, scope Scope,
	streamVerified func(func(Task) error) error,
) (*Queue, error) {
	if ctx == nil || ctx.Err() != nil || streamVerified == nil {
		return nil, ErrQuarantined
	}
	dir, err := openDir(privateBase, scope)
	if err != nil {
		return nil, err
	}
	if _, err := os.Lstat(filepath.Join(dir, "index.json")); err == nil {
		return Open(privateBase, scope)
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, ErrQuarantined
	}
	// O_EXCL refuses a second writer, including any incomplete crash journal.
	f, err := os.OpenFile(filepath.Join(dir, "tasks.ndjson"),
		os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, ErrQuarantined
	}
	abort := true
	defer func() {
		_ = f.Close()
		if abort {
			// No HTTP, Plan or remote operation occurs inside Build.
			// Only this unfinished, unpublished queue can be discarded.
			_ = os.Remove(filepath.Join(dir, "tasks.ndjson"))
		}
	}()
	h := sha256.New()
	bw := bufio.NewWriterSize(io.MultiWriter(f, h), 32<<10)
	encoder := json.NewEncoder(bw)
	seen := make(map[string]struct{})
	var count int64
	err = streamVerified(func(t Task) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if !validTask(t) || count >= maxTasks {
			return ErrQuarantined
		}
		if _, exists := seen[t.Path]; exists {
			return ErrQuarantined
		}
		seen[t.Path] = struct{}{}
		count++
		return encoder.Encode(t)
	})
	if err != nil || ctx.Err() != nil {
		return nil, ErrQuarantined
	}
	if err := bw.Flush(); err != nil {
		return nil, ErrQuarantined
	}
	if err := f.Sync(); err != nil {
		return nil, ErrQuarantined
	}
	if err := f.Close(); err != nil {
		return nil, ErrQuarantined
	}
	if err := syncDir(dir); err != nil {
		return nil, ErrQuarantined
	}
	m := manifest{Version: version, Scope: scope, Count: count,
		SHA256: hex.EncodeToString(h.Sum(nil))}
	if err := writeNewJSON(filepath.Join(dir, "index.json"), m); err != nil {
		return nil, err
	}
	abort = false
	return Open(privateBase, scope)
}

// Open validates the *whole* durable queue before any upload callback runs.
// A corrupt/truncated file, wrong Owner/Device/Root, or changed Source revision
// cannot be treated as an empty queue or used to mint a new file Operation.
func Open(privateBase string, scope Scope) (*Queue, error) {
	dir, err := openDir(privateBase, scope)
	if err != nil {
		return nil, err
	}
	var m manifest
	if err := readJSON(filepath.Join(dir, "index.json"), 8192, &m); err != nil ||
		m.Version != version || m.Scope != scope || m.Count < 0 ||
		m.Count > maxTasks || !validSHA(m.SHA256) {
		return nil, ErrQuarantined
	}
	q := &Queue{dir: dir, scope: scope, manifest: m}
	if err := q.verifyTasks(); err != nil {
		return nil, err
	}
	return q, nil
}

func (q *Queue) taskPath() string { return filepath.Join(q.dir, "tasks.ndjson") }

func (q *Queue) readTasks(yield func(Task) error) error {
	if err := checkPrivateFile(q.taskPath()); err != nil {
		return err
	}
	f, err := os.Open(q.taskPath())
	if err != nil {
		return ErrQuarantined
	}
	defer f.Close()
	decoder := json.NewDecoder(bufio.NewReaderSize(f, 32<<10))
	decoder.DisallowUnknownFields()
	count := int64(0)
	seen := make(map[string]struct{})
	for {
		var t Task
		err := decoder.Decode(&t)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil || !validTask(t) || count >= maxTasks {
			return ErrQuarantined
		}
		if _, exists := seen[t.Path]; exists {
			return ErrQuarantined
		}
		seen[t.Path] = struct{}{}
		count++
		if err := yield(t); err != nil {
			return err
		}
	}
	if count != q.manifest.Count {
		return ErrQuarantined
	}
	return nil
}

func (q *Queue) verifyTasks() error {
	if err := checkPrivateFile(q.taskPath()); err != nil {
		return err
	}
	f, err := os.Open(q.taskPath())
	if err != nil {
		return ErrQuarantined
	}
	h := sha256.New()
	_, hashErr := io.Copy(h, f)
	closeErr := f.Close()
	if hashErr != nil || closeErr != nil ||
		hex.EncodeToString(h.Sum(nil)) != q.manifest.SHA256 {
		return ErrQuarantined
	}
	return q.readTasks(func(Task) error { return nil })
}

func (q *Queue) commitFile(t Task) string {
	h := sha256.Sum256([]byte("xdrive/localpush/committed-path/v1\x00" + t.Path))
	return filepath.Join(q.dir, "committed-"+hex.EncodeToString(h[:])+".json")
}

func (q *Queue) committed(t Task) (Commit, bool, error) {
	var result Commit
	p := q.commitFile(t)
	if _, err := os.Lstat(p); errors.Is(err, os.ErrNotExist) {
		return result, false, nil
	} else if err != nil {
		return result, false, ErrQuarantined
	}
	var stored struct {
		Task   Task   `json:"task"`
		Commit Commit `json:"commit"`
	}
	if err := readJSON(p, 8192, &stored); err != nil ||
		stored.Task != t || !validCommit(t, stored.Commit) {
		return result, false, ErrQuarantined
	}
	return stored.Commit, true, nil
}

func (q *Queue) recordCommitted(t Task, c Commit) error {
	if !validCommit(t, c) {
		return ErrQuarantined
	}
	return writeNewJSON(q.commitFile(t), struct {
		Task   Task   `json:"task"`
		Commit Commit `json:"commit"`
	}{Task: t, Commit: c})
}

// Run is intentionally serial. The upload callback MUST bind to the existing
// persisted per-file original Plan, use the normal authenticated /uploads
// transport, and return ONLY a verified original SQL receipt. When a commit
// marker is already present, recheckOriginal MUST contact that authenticated
// original Operation; this queue alone never proves a current remote backup.
//
// Unknown results stop the run. The task and original Operation survive for
// replay; a new Operation MUST NOT be minted just because this call failed.
func (q *Queue) Run(ctx context.Context,
	upload func(context.Context, Task) (Commit, error),
	recheckOriginal func(context.Context, Task, Commit) error,
) (Stats, error) {
	var stats Stats
	if q == nil || ctx == nil || upload == nil || recheckOriginal == nil ||
		ctx.Err() != nil {
		return stats, ErrQuarantined
	}
	if err := q.verifyTasks(); err != nil {
		return stats, err
	}
	err := q.readTasks(func(t Task) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		stats.Tasks++
		receipt, hasCommit, err := q.committed(t)
		if err != nil {
			return err
		}
		if hasCommit {
			if err := recheckOriginal(ctx, t, receipt); err != nil {
				return ErrQuarantined
			}
			stats.HistoricalRechecked++
			return nil
		}
		receipt, err = upload(ctx, t)
		if err != nil || !validCommit(t, receipt) {
			return ErrQuarantined
		}
		if err := q.recordCommitted(t, receipt); err != nil {
			// The SQL Operation may have committed although the local
			// checkpoint failed. Never treat this as cancellation.
			return ErrQuarantined
		}
		stats.CommittedNow++
		return nil
	})
	if err != nil {
		return stats, fmt.Errorf("original local Push task queue interrupted: %w", err)
	}
	return stats, nil
}
