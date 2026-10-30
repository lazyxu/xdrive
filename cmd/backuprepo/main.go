// xdrive-backup-repo manages a local repository of immutable CAS objects.
// It deliberately has no cloud backend, no chunking, and no compression.
package main

import (
	"archive/tar"
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const casRoot = ".xdrive-blobs/sha256"

type entry struct {
	hash string
	size int64
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "xdrive-backup-repo:", err)
		os.Exit(1)
	}
}
func run(args []string) error {
	return runWithReportWriter(args, os.Stdout)
}

func runWithReportWriter(args []string, reportOutput io.Writer) error {
	if len(args) == 0 {
		return errors.New("usage: xdrive-backup-repo estimate|capture|verify|restore|retention-plan|prune|delete-snapshot|preview-delete-snapshot [flags]")
	}
	cmd := args[0]
	f := flag.NewFlagSet(cmd, flag.ContinueOnError)
	repo := f.String("repo", "", "absolute repository root")
	snapshot := f.String("snapshot", "", "snapshot directory basename")
	source := f.String("source", "", "xDrive storage root for capture")
	target := f.String("target", "", "empty restore destination")
	ownerUID := f.Int("owner-uid", -1, "host owner UID of newly created repository entries")
	ownerGID := f.Int("owner-gid", -1, "host owner GID of newly created repository entries")
	keepLast := f.Int("keep-last", 7, "retain at least this many newest v2 generations (read-only plan or explicit prune)")
	casMode := f.String("mode", "fast", "retention-plan CAS audit: fast (size only) or deep (all SHA-256)")
	confirmed := f.Bool("yes", false, "explicitly confirm destructive manual prune")
	jsonReport := f.Bool("json", false, "output bounded actual verification statistics (verify only)")
	if err := f.Parse(args[1:]); err != nil {
		return err
	}
	noSnapshot := cmd == "estimate" || cmd == "retention-plan" || cmd == "prune"
	if f.NArg() != 0 || *repo == "" || (!noSnapshot && *snapshot == "") || (noSnapshot && *snapshot != "") {
		return fmt.Errorf("usage: %s --repo PATH --snapshot NAME [--source PATH|--target PATH]; estimate requires --repo and --source only", cmd)
	}
	if !noSnapshot {
		nameOK := safeName(*snapshot)
		if cmd == "capture" && strings.HasSuffix(*snapshot, ".partial") {
			nameOK = safeName(strings.TrimSuffix(*snapshot, ".partial"))
		}
		if filepath.IsAbs(*snapshot) || !nameOK {
			return fmt.Errorf("invalid snapshot name %q", *snapshot)
		}
	}
	root, err := filepath.Abs(*repo)
	if err != nil {
		return err
	}
	snap := filepath.Join(root, "snapshots", *snapshot)
	keepLastPassed, modePassed, yesPassed, jsonPassed := false, false, false, false
	f.Visit(func(flag *flag.Flag) {
		switch flag.Name {
		case "keep-last":
			keepLastPassed = true
		case "mode":
			modePassed = true
		case "yes":
			yesPassed = true
		case "json":
			jsonPassed = true
		}
	})
	if cmd != "retention-plan" && cmd != "prune" && cmd != "delete-snapshot" &&
		cmd != "preview-delete-snapshot" && (keepLastPassed || modePassed || yesPassed) {
		return errors.New("--keep-last, --mode and --yes require the matching retention/prune subcommand")
	}
	if cmd == "retention-plan" && yesPassed {
		return errors.New("retention-plan does not support --yes")
	}
	if cmd == "prune" && (modePassed || !keepLastPassed || !*confirmed) {
		return errors.New("prune requires explicit --keep-last N --yes, without --mode")
	}
	if cmd == "delete-snapshot" && (keepLastPassed || modePassed || !*confirmed) {
		return errors.New("delete-snapshot requires an exact --snapshot NAME and --yes, without --keep-last or --mode")
	}
	if cmd == "preview-delete-snapshot" && (keepLastPassed || yesPassed) {
		return errors.New("preview-delete-snapshot is read-only and accepts only --repo, --snapshot and --mode")
	}
	if cmd != "verify" && jsonPassed {
		return errors.New("--json is available only for verify")
	}
	switch cmd {
	case "estimate":
		if *source == "" || *target != "" || *ownerUID != -1 || *ownerGID != -1 {
			return errors.New("estimate requires --source and --repo only")
		}
		bytes, err := estimateIncrementalBytes(*source, root)
		if err != nil {
			return err
		}
		fmt.Println(bytes)
		return nil
	case "retention-plan":
		if *source != "" || *target != "" || *ownerUID != -1 || *ownerGID != -1 {
			return errors.New("retention-plan only accepts --repo, --keep-last and --mode")
		}
		if *casMode != "fast" && *casMode != "deep" {
			return errors.New("retention-plan --mode must be fast or deep")
		}
		result, err := planRetentionWithMode(root, *keepLast, *casMode)
		if err != nil {
			return err
		}
		return writeRetentionPlan(result)
	case "prune":
		if *source != "" || *target != "" || *ownerUID != -1 || *ownerGID != -1 {
			return errors.New("prune only accepts --repo, --keep-last and --yes")
		}
		result, err := pruneRepository(root, *keepLast)
		if err != nil {
			return err
		}
		return writePruneReport(result)
	case "delete-snapshot":
		if *source != "" || *target != "" || *ownerUID != -1 || *ownerGID != -1 {
			return errors.New("delete-snapshot only accepts --repo, --snapshot and --yes")
		}
		if !canonicalPruneSnapshotName(*snapshot) {
			return errors.New("delete-snapshot requires a canonical committed v2 generation name")
		}
		result, err := pruneSelectedSnapshot(root, *snapshot)
		if err != nil {
			return err
		}
		return writePruneReport(result)
	case "preview-delete-snapshot":
		if *source != "" || *target != "" || *ownerUID != -1 || *ownerGID != -1 {
			return errors.New("preview-delete-snapshot accepts only --repo, --snapshot and --mode")
		}
		result, err := planSelectedPrune(root, *snapshot, *casMode)
		if err != nil {
			return err
		}
		return writeSelectedPrunePlan(reportOutput, result)
	case "capture":
		if *source == "" || *target != "" {
			return errors.New("capture requires --source only")
		}
		if (*ownerUID == -1) != (*ownerGID == -1) {
			return errors.New("owner UID and GID must both be supplied")
		}
		return captureWithOwner(*source, root, snap, *ownerUID, *ownerGID)
	case "verify":
		if *source != "" || *target != "" {
			return errors.New("verify accepts neither --source nor --target")
		}
		if *jsonReport {
			report, verifyErr := verifyWithReport(root, snap, true)
			if err := writeVerificationReport(reportOutput, report); err != nil {
				return err
			}
			return verifyErr
		}
		_, err := verify(root, snap, true)
		return err
	case "restore":
		if *target == "" || *source != "" {
			return errors.New("restore requires --target only")
		}
		return restore(root, snap, *target)
	default:
		return fmt.Errorf("unknown action %q", cmd)
	}
}
func safeName(name string) bool {
	if name == "." || name == ".." || strings.HasPrefix(name, ".") || strings.ContainsAny(name, "/\\\x00") {
		return false
	}
	for _, r := range name {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
			return false
		}
	}
	return true
}
func shaValid(s string) bool {
	if len(s) != 64 {
		return false
	}
	for _, c := range s {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}
func objectPath(repo, hash string) string {
	return filepath.Join(repo, "objects", "sha256", hash[:2], hash)
}
func regularFile(path string) (os.FileInfo, error) {
	st, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !st.Mode().IsRegular() {
		return nil, fmt.Errorf("non-regular file %q", path)
	}
	return st, nil
}

// requireRepositoryDirs rejects symlinks, files, and special nodes anywhere
// in a repository-owned directory path. Missing directories are permitted
// during read-only preflight and before the first object is published.
func requireRepositoryDirs(paths ...string) error {
	for _, path := range paths {
		st, err := os.Lstat(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if !st.IsDir() || st.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("non-directory or symlink in backup repository: %s", path)
		}
	}
	return nil
}

func checkRepositoryLayout(repo string) error {
	return requireRepositoryDirs(
		repo, filepath.Join(repo, "snapshots"),
		filepath.Join(repo, "objects"),
		filepath.Join(repo, "objects", "sha256"),
	)
}

func checkObjectBucket(repo, hash string) error {
	return requireRepositoryDirs(filepath.Join(repo, "objects", "sha256", hash[:2]))
}

func syncDirectory(path string) error {
	dir, err := os.Open(path)
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
func createObject(src, repo, hash string, size int64, uid, gid int) (bool, error) {
	if err := checkRepositoryLayout(repo); err != nil {
		return false, err
	}
	if err := checkObjectBucket(repo, hash); err != nil {
		return false, err
	}
	dst := objectPath(repo, hash)
	if st, err := os.Lstat(dst); err == nil {
		if !st.Mode().IsRegular() || st.Size() != size {
			return false, fmt.Errorf("backup CAS object exists with mismatched metadata: %s", hash)
		}
		return false, nil // immutable and verified at its initial publication; verify hashes before restore
	} else if !os.IsNotExist(err) {
		return false, err
	}
	parent := filepath.Dir(dst)
	if err := os.MkdirAll(parent, 0700); err != nil {
		return false, err
	}
	if err := checkObjectBucket(repo, hash); err != nil {
		return false, err
	}
	if uid >= 0 {
		for _, dir := range []string{filepath.Join(repo, "objects"), filepath.Join(repo, "objects", "sha256"), parent} {
			if err := os.Chown(dir, uid, gid); err != nil {
				return false, err
			}
		}
	}
	st, err := regularFile(src)
	if err != nil {
		return false, err
	}
	if st.Size() != size {
		return false, fmt.Errorf("source CAS changed size: %s", hash)
	}
	in, err := os.Open(src)
	if err != nil {
		return false, err
	}
	defer in.Close()
	temp, err := os.CreateTemp(parent, ".cas-new-")
	if err != nil {
		return false, err
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	hashWriter := sha256.New()
	n, copyErr := io.Copy(io.MultiWriter(temp, hashWriter), in)
	if copyErr == nil {
		copyErr = temp.Sync()
	}
	if e := temp.Close(); copyErr == nil {
		copyErr = e
	}
	if copyErr != nil {
		return false, copyErr
	}
	if n != size || hex.EncodeToString(hashWriter.Sum(nil)) != hash {
		return false, fmt.Errorf("source CAS digest or size mismatch: %s", hash)
	}
	// Linking a same-directory temp is an atomic no-overwrite publication.
	if err := os.Link(tempName, dst); err != nil {
		if st, e := regularFile(dst); e == nil && st.Size() == size {
			return false, nil
		}
		return false, fmt.Errorf("publish CAS %s: %w", hash, err)
	}
	if uid >= 0 {
		if err := os.Chown(dst, uid, gid); err != nil {
			return false, err
		}
	}
	if err := syncDirectory(parent); err != nil {
		return false, err
	}
	return true, nil
}
func encodeTarLegacy(root, outPath string) (err error) {
	f, err := os.OpenFile(outPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			os.Remove(outPath)
		}
	}()
	writer := tar.NewWriter(f)
	walkErr := filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, e := filepath.Rel(root, path)
		if e != nil {
			return e
		}
		if rel == "." {
			return nil
		}
		slash := filepath.ToSlash(rel)
		if slash == casRoot {
			return filepath.SkipDir
		}
		if slash == ".xdrive-media" && d.IsDir() {
			// This exact root-level derived cache is disposable, unlike user data.
			return filepath.SkipDir
		}
		if d.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink unsupported in incremental backup: %s (use legacy tar)", slash)
		}
		info, e := d.Info()
		if e != nil {
			return e
		}
		if !info.Mode().IsRegular() && !info.IsDir() {
			return fmt.Errorf("unsupported file mode in legacy storage: %s", slash)
		}
		header, e := tar.FileInfoHeader(info, "")
		if e != nil {
			return e
		}
		header.Name = slash
		if info.IsDir() {
			header.Name += "/"
		}
		if e = writer.WriteHeader(header); e != nil {
			return e
		}
		if info.Mode().IsRegular() {
			file, e := os.Open(path)
			if e != nil {
				return e
			}
			n, e := io.Copy(writer, file)
			closeErr := file.Close()
			if e != nil {
				return e
			}
			if closeErr != nil {
				return closeErr
			}
			if n != info.Size() {
				return fmt.Errorf("legacy file changed during archive: %s", slash)
			}
		}
		return nil
	})
	if walkErr != nil {
		writer.Close()
		f.Close()
		return walkErr
	}
	if err = writer.Close(); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// estimateIncrementalBytes conservatively counts NEW immutable CAS objects
// and the per-snapshot legacy.tar payload without mutating either filesystem.
// Existing size-matched CAS is reused; hash verification precedes restore.
func estimateIncrementalBytes(source, repo string) (int64, error) {
	if err := checkRepositoryLayout(repo); err != nil {
		return 0, err
	}
	src, err := filepath.Abs(source)
	if err != nil {
		return 0, err
	}
	if src == repo || strings.HasPrefix(repo, src+string(os.PathSeparator)) ||
		strings.HasPrefix(src, repo+string(os.PathSeparator)) {
		return 0, errors.New("repository and source cannot nest inside each other")
	}
	if st, err := os.Stat(src); err != nil || !st.IsDir() {
		return 0, fmt.Errorf("source must be an accessible directory: %w", err)
	}
	var needed int64
	const maxInt64 = int64(^uint64(0) >> 1)
	add := func(n int64) error {
		if n < 0 || needed > maxInt64-n {
			return errors.New("incremental size estimate overflow")
		}
		needed += n
		return nil
	}
	err = filepath.WalkDir(src, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == src {
			return nil
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		slash := filepath.ToSlash(rel)
		if slash == ".xdrive-media" && d.IsDir() {
			// Align space preflight with legacy.tar without walking caches.
			return filepath.SkipDir
		}
		if d.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink unsupported in incremental backup: %s", slash)
		}
		if slash == casRoot {
			return nil
		}
		if strings.HasPrefix(slash, casRoot+"/") {
			if d.IsDir() || strings.HasPrefix(d.Name(), ".xdrive-upload-") {
				return nil
			}
			parts := strings.Split(strings.TrimPrefix(slash, casRoot+"/"), "/")
			if len(parts) != 2 || !shaValid(parts[1]) || parts[0] != parts[1][:2] {
				return fmt.Errorf("unrecognized CAS path %q", slash)
			}
			st, err := d.Info()
			if err != nil {
				return err
			}
			if !st.Mode().IsRegular() {
				return fmt.Errorf("non-regular source CAS file %q", slash)
			}
			if err := checkObjectBucket(repo, parts[1]); err != nil {
				return err
			}
			existing, err := os.Lstat(objectPath(repo, parts[1]))
			if os.IsNotExist(err) {
				return add(st.Size())
			}
			if err != nil {
				return err
			}
			if !existing.Mode().IsRegular() || existing.Size() != st.Size() {
				return fmt.Errorf("backup CAS object exists with mismatched metadata: %s", parts[1])
			}
			return nil
		}
		// The legacy archive is created every time; padding and metadata
		// reserves avoid underestimating small-file-heavy directories.
		if d.IsDir() {
			return add(1024)
		}
		st, err := d.Info()
		if err != nil {
			return err
		}
		if !st.Mode().IsRegular() {
			return fmt.Errorf("unsupported file mode in legacy storage: %s", slash)
		}
		if err := add(st.Size()); err != nil {
			return err
		}
		return add(2048)
	})
	return needed, err
}

func capture(source, repo, snapshot string) error {
	return captureWithOwner(source, repo, snapshot, -1, -1)
}
func captureWithOwner(source, repo, snapshot string, uid, gid int) error {
	src, err := filepath.Abs(source)
	if err != nil {
		return err
	}
	if src == repo || strings.HasPrefix(repo, src+string(os.PathSeparator)) || strings.HasPrefix(src, repo+string(os.PathSeparator)) {
		return errors.New("repository and source cannot nest inside each other")
	}
	if st, err := os.Stat(src); err != nil || !st.IsDir() {
		return fmt.Errorf("source must be an accessible directory: %w", err)
	}
	if st, err := os.Lstat(snapshot); err != nil || !st.IsDir() {
		return errors.New("snapshot staging directory must already exist")
	}
	if err := checkRepositoryLayout(repo); err != nil {
		return err
	}
	objectRoot := filepath.Join(repo, "objects", "sha256")
	if err := os.MkdirAll(objectRoot, 0700); err != nil {
		return err
	}
	if err := checkRepositoryLayout(repo); err != nil {
		return err
	}
	if uid >= 0 {
		for _, dir := range []string{filepath.Join(repo, "objects"), objectRoot} {
			if err := os.Chown(dir, uid, gid); err != nil {
				return err
			}
		}
	}
	indexPath := filepath.Join(snapshot, "objects.index")
	if _, err := os.Lstat(indexPath); err == nil {
		return errors.New("snapshot already has an objects.index")
	}
	index, err := os.OpenFile(indexPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	writer := bufio.NewWriter(index)
	created, reused, total := 0, 0, int64(0)
	pathRoot := filepath.Join(src, filepath.FromSlash(casRoot))
	walkErr := filepath.WalkDir(pathRoot, func(path string, d fs.DirEntry, walkErr error) error {
		if errors.Is(walkErr, os.ErrNotExist) && path == pathRoot {
			return nil
		} // no canonical CAS yet
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		if strings.HasPrefix(d.Name(), ".xdrive-upload-") {
			return nil // incomplete upload staging never belongs to a committed snapshot
		}
		rel, e := filepath.Rel(pathRoot, path)
		if e != nil {
			return e
		}
		elems := strings.Split(filepath.ToSlash(rel), "/")
		if len(elems) != 2 || !shaValid(elems[1]) || elems[0] != elems[1][:2] {
			return fmt.Errorf("unrecognized CAS path %q", rel)
		}
		st, e := regularFile(path)
		if e != nil {
			return e
		}
		added, e := createObject(path, repo, elems[1], st.Size(), uid, gid)
		if e != nil {
			return e
		}
		if added {
			created++
		} else {
			reused++
		}
		total += st.Size()
		_, e = fmt.Fprintf(writer, "%s\t%d\n", elems[1], st.Size())
		return e
	})
	if walkErr != nil {
		index.Close()
		os.Remove(indexPath)
		return walkErr
	}
	if err = writer.Flush(); err != nil {
		index.Close()
		os.Remove(indexPath)
		return err
	}
	if err = index.Sync(); err != nil {
		index.Close()
		os.Remove(indexPath)
		return err
	}
	if err = index.Close(); err != nil {
		os.Remove(indexPath)
		return err
	}
	legacy := filepath.Join(snapshot, "legacy.tar")
	if err = encodeTarLegacy(src, legacy); err != nil {
		return err
	}
	if uid >= 0 {
		if err = os.Chown(indexPath, uid, gid); err != nil {
			return err
		}
		if err = os.Chown(legacy, uid, gid); err != nil {
			return err
		}
	}
	fmt.Fprintf(os.Stderr, "[xDrive] CAS incremental: new=%d reused=%d total=%d bytes\n", created, reused, total)
	return nil
}
func readIndex(snapshot string, fn func(entry) error) error {
	path := filepath.Join(snapshot, "objects.index")
	if _, err := regularFile(path); err != nil {
		return err
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	seen := map[string]bool{}
	for scanner.Scan() {
		line := scanner.Text()
		parts := strings.Split(line, "\t")
		if len(parts) != 2 || !shaValid(parts[0]) {
			return fmt.Errorf("bad objects.index row")
		}
		n, err := strconv.ParseInt(parts[1], 10, 64)
		if err != nil || n < 0 {
			return fmt.Errorf("invalid CAS size in index")
		}
		if seen[parts[0]] {
			return fmt.Errorf("duplicated CAS in index %s", parts[0])
		}
		seen[parts[0]] = true
		if err := fn(entry{parts[0], n}); err != nil {
			return err
		}
	}
	return scanner.Err()
}
func walkLegacyArchive(snapshot string, visitor func(*tar.Header, *tar.Reader) error) error {
	path := filepath.Join(snapshot, "legacy.tar")
	if _, err := regularFile(path); err != nil {
		return err
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	reader := tar.NewReader(f)
	seen := make(map[string]byte)
	hasChildren := make(map[string]bool)
	for {
		h, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}
		clean := filepath.Clean(filepath.FromSlash(h.Name))
		name := filepath.ToSlash(clean)
		if !filepath.IsLocal(clean) || clean == "." || name == casRoot || strings.HasPrefix(name, casRoot+"/") {
			return fmt.Errorf("unsafe legacy archive path %q", h.Name)
		}
		if h.Typeflag != tar.TypeReg && h.Typeflag != tar.TypeRegA && h.Typeflag != tar.TypeDir {
			return fmt.Errorf("unsupported legacy archive entry type %q", h.Name)
		}
		// The source writer only emits canonical relative names. Reject
		// duplicate and noncanonical aliases before any destructive restore.
		if strings.TrimSuffix(h.Name, "/") != name ||
			(h.Typeflag != tar.TypeDir && strings.HasSuffix(h.Name, "/")) ||
			(h.Typeflag == tar.TypeDir && h.Size != 0) {
			return fmt.Errorf("noncanonical legacy archive entry %q", h.Name)
		}
		if _, exists := seen[name]; exists {
			return fmt.Errorf("duplicate legacy archive entry %q", h.Name)
		}
		if h.Typeflag != tar.TypeDir && hasChildren[name] {
			return fmt.Errorf("legacy archive file conflicts with children: %q", h.Name)
		}
		for parent := filepath.Dir(clean); parent != "."; parent = filepath.Dir(parent) {
			parentName := filepath.ToSlash(parent)
			if kind, exists := seen[parentName]; exists && kind != tar.TypeDir {
				return fmt.Errorf("legacy archive path has file ancestor: %q", h.Name)
			}
			hasChildren[parentName] = true
		}
		seen[name] = h.Typeflag
		if err := visitor(h, reader); err != nil {
			return err
		}
	}
	return nil
}
// pathIsWithin checks complete path components, including equality and the
// filesystem root. A string prefix test misses "/" and symlink aliases.
func pathIsWithin(root, path string) bool {
	relative, err := filepath.Rel(root, path)
	return err == nil && relative != ".." &&
		!strings.HasPrefix(relative, ".."+string(os.PathSeparator))
}

func restore(repo, snapshot, target string) error {
	dst, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	st, err := os.Lstat(dst)
	if err != nil {
		return err
	}
	if !st.IsDir() {
		return errors.New("restore target must be an existing directory")
	}
	repoAbs, err := filepath.Abs(repo)
	if err != nil {
		return err
	}
	repoResolved, err := filepath.EvalSymlinks(repoAbs)
	if err != nil {
		return fmt.Errorf("resolve backup repository: %w", err)
	}
	dstResolved, err := filepath.EvalSymlinks(dst)
	if err != nil {
		return fmt.Errorf("resolve restore destination: %w", err)
	}
	// Always enforce disjoint physical paths before the destructive restore.
	// Operating on the resolved destination also avoids traversing an
	// operator-supplied parent alias after the overlap check.
	if pathIsWithin(repoResolved, dstResolved) || pathIsWithin(dstResolved, repoResolved) {
		return errors.New("repository and restore destination cannot nest")
	}
	if _, err = verify(repo, snapshot, true); err != nil {
		return err
	}
	entries, err := os.ReadDir(dstResolved)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if err := os.RemoveAll(filepath.Join(dstResolved, e.Name())); err != nil {
			return err
		}
	}
	if err := walkLegacyArchive(snapshot, func(h *tar.Header, r *tar.Reader) error {
		rel := filepath.Clean(filepath.FromSlash(h.Name))
		dest := filepath.Join(dstResolved, rel)
		if h.Typeflag == tar.TypeDir {
			return os.MkdirAll(dest, 0700)
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0700); err != nil {
			return err
		}
		out, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		n, copyErr := io.CopyN(out, r, h.Size)
		if copyErr == nil && n != h.Size {
			copyErr = errors.New("legacy tar content short")
		}
		if copyErr == nil {
			copyErr = out.Sync()
		}
		if e := out.Close(); copyErr == nil {
			copyErr = e
		}
		if copyErr == nil {
			copyErr = os.Chmod(dest, os.FileMode(h.Mode)&0777)
		}
		return copyErr
	}); err != nil {
		return err
	}
	return readIndex(snapshot, func(e entry) error {
		dest := filepath.Join(dstResolved, filepath.FromSlash(casRoot), e.hash[:2], e.hash)
		if err := os.MkdirAll(filepath.Dir(dest), 0700); err != nil {
			return err
		}
		in, err := os.Open(objectPath(repo, e.hash))
		if err != nil {
			return err
		}
		out, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			in.Close()
			return err
		}
		_, copyErr := io.Copy(out, in)
		if copyErr == nil {
			copyErr = out.Sync()
		}
		if c := out.Close(); copyErr == nil {
			copyErr = c
		}
		if c := in.Close(); copyErr == nil {
			copyErr = c
		}
		return copyErr
	})
}
