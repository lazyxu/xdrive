package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"strings"

	"github.com/lazyxu/xdrive/internal/storage"
)

// withLocalIdentityPinnedCASWindow is an INTERNAL, READ-ONLY Local Store
// prerequisite. It holds one cooperating cross-process shared CAS lease while
// checking the complete physical bytes both before and after the observer.
// The observer MUST NOT perform SQL or content writes: CAS/SQL lock ordering
// and owning-Agent proof are separate, unimplemented executor requirements.
// No result from this function is a durable CAS or native-file attestation.
func withLocalIdentityPinnedCASWindow(
	ctx context.Context, store storage.Store, object localEvidenceCloudObject,
	observe func(context.Context) error,
) (resultErr error) {
	if ctx == nil || store == nil || observe == nil ||
		object.Size < 0 || object.Size > localEvidencePhysicalCASLimitBytes ||
		len(object.SHA256) != sha256.Size*2 ||
		strings.ToLower(object.SHA256) != object.SHA256 {
		return errors.New("invalid private CAS observation scope")
	}
	// An arbitrary Store.Open or optional third-party pin is not proof of
	// xDrive Local Store's shard-wide Put/Promote/Delete lock protocol.
	local, ok := store.(*storage.Local)
	if !ok || local == nil {
		return errors.New("cooperating local CAS lifecycle lease unavailable")
	}
	key, err := storage.ContentAddressedKey(object.SHA256)
	if err != nil || key != object.Key {
		return errors.New("noncanonical private CAS object")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	readCtx, cancel := context.WithTimeout(ctx, localEvidencePhysicalCASDeadline)
	defer cancel()
	pinned, err := local.OpenPinnedCAS(readCtx, key)
	if err != nil {
		if readCtx.Err() != nil {
			return readCtx.Err()
		}
		return errors.New("physical CAS pin unavailable")
	}
	defer func() {
		if err := pinned.Close(); err != nil && resultErr == nil {
			resultErr = errors.New("physical CAS pin close failed")
		}
	}()
	seeker, ok := pinned.(io.Seeker)
	if !ok {
		return errors.New("pinned CAS cannot revalidate physical bytes")
	}
	initial, err := pinned.Stat()
	if err != nil || !initial.Mode().IsRegular() || initial.Size() != object.Size {
		return errors.New("pinned CAS file identity or size mismatch")
	}
	verify := func() error {
		if err := readCtx.Err(); err != nil {
			return err
		}
		if _, err := seeker.Seek(0, io.SeekStart); err != nil {
			return errors.New("cannot rewind pinned CAS")
		}
		hash := sha256.New()
		readSize, err := io.CopyBuffer(hash,
			io.LimitReader(contextCASReader{ctx: readCtx, src: pinned}, object.Size+1),
			make([]byte, 256<<10))
		if err != nil {
			if readCtx.Err() != nil {
				return readCtx.Err()
			}
			return errors.New("pinned CAS byte read failed")
		}
		if err := readCtx.Err(); err != nil {
			return err
		}
		current, err := pinned.Stat()
		if err != nil || !current.Mode().IsRegular() ||
			!os.SameFile(initial, current) ||
			!current.ModTime().Equal(initial.ModTime()) ||
			current.Size() != object.Size || readSize != object.Size ||
			hex.EncodeToString(hash.Sum(nil)) != object.SHA256 {
			return errors.New("pinned CAS content or file identity changed")
		}
		return nil
	}
	if err := verify(); err != nil {
		return err
	}
	if err := observe(readCtx); err != nil {
		return err
	}
	// The lease remains open across the observer; independently hash the
	// same open handle again to reject even same-size out-of-band corruption.
	return verify()
}
