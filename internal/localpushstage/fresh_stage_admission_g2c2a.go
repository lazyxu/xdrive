package localpushstage

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"

	"github.com/lazyxu/xdrive/internal/localpush"
)

// RequireFreshLocalOriginalStageScope is a READ-ONLY owning-Agent preflight.
// Even an empty recovery directory might be left after interrupted Stage.
// This check is not an interprocess lock or permission to release old bytes.
func RequireFreshLocalOriginalStageScope(ctx context.Context, configDir string, grant localpush.RootGrant) error {
	if ctx == nil || ctx.Err() != nil {
		return errLocalStageRecovery
	}
	dir, err := localStageRecoveryScope(configDir, grant)
	if err != nil {
		return errLocalStageRecovery
	}
	for _, path := range []string{filepath.Dir(filepath.Dir(dir)), filepath.Dir(dir), dir} {
		info, statErr := os.Lstat(path)
		if errors.Is(statErr, os.ErrNotExist) {
			continue
		}
		if statErr != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 ||
			(runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
			return errLocalStageRecovery
		}
		if path == dir {
			return errLocalStageRecovery
		}
	}
	if ctx.Err() != nil || localStageRecoveryScopeStillCurrent(configDir, grant) != nil {
		return errLocalStageRecovery
	}
	return nil
}
