package localpushqueue

import (
	"context"
	"errors"
	"os"
	"path/filepath"
)

// OpenIfPresent distinguishes an untouched previous scan (no queue) from
// an incomplete/corrupt durable task queue. A crash during queue publication
// is NEVER interpreted as permission to drop the original pending work.
func OpenIfPresent(privateBase string, scope Scope) (*Queue, bool, error) {
	dir, err := openDir(privateBase, scope)
	if err != nil {
		return nil, false, err
	}
	index := filepath.Join(dir, "index.json")
	if _, err := os.Lstat(index); errors.Is(err, os.ErrNotExist) {
		if _, taskErr := os.Lstat(filepath.Join(dir, "tasks.ndjson")); errors.Is(taskErr, os.ErrNotExist) {
			return nil, false, nil
		}
		return nil, false, ErrQuarantined
	} else if err != nil {
		return nil, false, ErrQuarantined
	}
	q, err := Open(privateBase, scope)
	if err != nil {
		return nil, false, err
	}
	return q, true, nil
}

// RecheckAll proves every eligible file in an earlier verified queue has a
// recorded original immutable COMMIT under the CURRENT owning authority.
// The returned mapping is historical, not proof that current CAS still exists.
// This is a prerequisite for using a later inventory snapshot as a delta
// baseline; otherwise prior unfinished work could be skipped forever.
func (q *Queue) RecheckAll(ctx context.Context,
	recheckOriginal func(context.Context, Task, Commit) error,
) (map[string]Commit, error) {
	if q == nil || ctx == nil || ctx.Err() != nil || recheckOriginal == nil {
		return nil, ErrQuarantined
	}
	if err := q.verifyTasks(); err != nil {
		return nil, err
	}
	history := make(map[string]Commit, int(q.manifest.Count))
	err := q.readTasks(func(t Task) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		proof, ok, err := q.committed(t)
		if err != nil || !ok || recheckOriginal(ctx, t, proof) != nil {
			return ErrQuarantined
		}
		history[t.Path] = proof
		return nil
	})
	if err != nil || int64(len(history)) != q.manifest.Count {
		return nil, ErrQuarantined
	}
	return history, nil
}
