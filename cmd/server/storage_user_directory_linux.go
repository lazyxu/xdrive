//go:build linux

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// User-owned storage is separate from immutable CAS objects. This explicit
// recovery command only repairs DIRECTORY metadata below one numeric user ID.
// It does not touch regular files, symlinks, CAS, media caches or the database.
type userDirectoryAccessReport struct {
	UserID           uint64   `json:"user_id"`
	Applied          bool     `json:"applied"`
	Directories      int      `json:"directories_checked"`
	OwnerMismatches  int      `json:"directories_with_wrong_owner"`
	ModeMismatches   int      `json:"directories_missing_owner_rwx"`
	RegularFilesSeen int      `json:"files_untouched"`
	SymlinksSeen     int      `json:"symlinks_untouched"`
	Samples          []string `json:"sample_paths,omitempty"`
}

func runStorageRepairUserDirectories(args []string) error {
	rootDefault := strings.TrimSpace(os.Getenv("XD_STORAGE_ROOT"))
	if rootDefault == "" {
		rootDefault = "/data"
	}
	f := flag.NewFlagSet("storage repair-user-directories", flag.ContinueOnError)
	root := f.String("root", rootDefault, "exact xDrive storage root")
	userID := f.Uint64("user-id", 0, "numeric owner ID for one storage subtree")
	uid := f.Int("uid", defaultStorageOwnerID, "runtime storage UID")
	gid := f.Int("gid", defaultStorageOwnerID, "runtime storage GID")
	apply := f.Bool("apply", false, "repair directory metadata (default is read-only dry-run)")
	if err := f.Parse(args); err != nil {
		return err
	}
	if f.NArg() != 0 || *userID == 0 || *uid <= 0 || *gid <= 0 || !filepath.IsAbs(*root) {
		return fmt.Errorf("usage: xdrive-server storage repair-user-directories --user-id N [--root /data] [--uid UID] [--gid GID] [--apply]")
	}
	r, err := repairOneUserDirectoryTree(*root, *userID, *uid, *gid, *apply)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(r)
}

func repairOneUserDirectoryTree(root string, userID uint64, uid, gid int, apply bool) (userDirectoryAccessReport, error) {
	report := userDirectoryAccessReport{UserID: userID}
	if userID == 0 || uid < 0 || gid < 0 {
		return report, fmt.Errorf("invalid user directory or runtime owner")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return report, err
	}
	rootInfo, err := os.Lstat(abs)
	if err != nil {
		return report, err
	}
	if !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 {
		return report, fmt.Errorf("storage root must be a real directory: %s", abs)
	}
	rootStat, ok := rootInfo.Sys().(*syscall.Stat_t)
	if !ok {
		return report, fmt.Errorf("unable to inspect storage device")
	}
	target := filepath.Join(abs, strconv.FormatUint(userID, 10))
	targetInfo, err := os.Lstat(target)
	if err != nil {
		return report, err
	}
	if !targetInfo.IsDir() || targetInfo.Mode()&os.ModeSymlink != 0 {
		return report, fmt.Errorf("user storage path must be a real directory: %s", target)
	}

	// A read-only first pass checks all directories and mounts BEFORE changes.
	// The second pass revalidates every entry immediately before any mutation.
	scan := func(mutate bool) (userDirectoryAccessReport, error) {
		result := userDirectoryAccessReport{UserID: userID, Applied: mutate}
		err := filepath.WalkDir(target, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return fmt.Errorf("walk user storage %s: %w", path, walkErr)
			}
			if entry.Type()&os.ModeSymlink != 0 {
				result.SymlinksSeen++
				return nil
			}
			if !entry.IsDir() {
				result.RegularFilesSeen++
				return nil
			}
			info, err := entry.Info()
			if err != nil {
				return err
			}
			st, ok := info.Sys().(*syscall.Stat_t)
			if !ok || uint64(st.Dev) != uint64(rootStat.Dev) {
				return fmt.Errorf("nested mount or unknown device under user storage: %s", path)
			}
			result.Directories++
			changeOwner := st.Uid != uint32(uid) || st.Gid != uint32(gid)
			changeMode := info.Mode().Perm()&0o700 != 0o700
			if changeOwner {
				result.OwnerMismatches++
			}
			if changeMode {
				result.ModeMismatches++
			}
			if (changeOwner || changeMode) && len(result.Samples) < 8 {
				rel, err := filepath.Rel(abs, path)
				if err != nil {
					return err
				}
				result.Samples = append(result.Samples, filepath.ToSlash(rel))
			}
			if mutate {
				if changeOwner {
					if err := os.Lchown(path, uid, gid); err != nil {
						return fmt.Errorf("set user directory owner %s: %w", path, err)
					}
				}
				if changeMode {
					if err := os.Chmod(path, info.Mode()|0o700); err != nil {
						return fmt.Errorf("set user directory permissions %s: %w", path, err)
					}
				}
			}
			return nil
		})
		return result, err
	}
	preview, err := scan(false)
	if err != nil || !apply {
		return preview, err
	}
	result, err := scan(true)
	return result, err
}
