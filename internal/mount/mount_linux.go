//go:build linux

package mount

import (
	"context"
	"errors"
	"io"
	"os"
	"sync"
	"syscall"

	"github.com/hanwen/go-fuse/v2/fs"
	"github.com/hanwen/go-fuse/v2/fuse"
	"github.com/lazyxu/xdrive/internal/client"
)

type linuxNode struct {
	fs.Inode
	cli  *client.Client
	node client.Node
}

func runPlatform(ctx context.Context, cli *client.Client, mountpoint string) error {
	root, err := cli.Root(ctx)
	if err != nil {
		return err
	}
	rootNode := &linuxNode{cli: cli, node: root}
	server, err := fs.Mount(mountpoint, rootNode, &fs.Options{MountOptions: fuse.MountOptions{FsName: "xdrive", Name: "xDrive"}})
	if err != nil {
		return err
	}
	go func() { <-ctx.Done(); _ = server.Unmount() }()
	server.Wait()
	if ctx.Err() != nil {
		return nil
	}
	return nil
}

func (n *linuxNode) stableAttr() fs.StableAttr {
	mode := uint32(syscall.S_IFREG)
	if n.node.Type == "dir" {
		mode = syscall.S_IFDIR
	}
	return fs.StableAttr{Mode: mode, Ino: n.node.ID}
}

func (n *linuxNode) Getattr(ctx context.Context, fh fs.FileHandle, out *fuse.AttrOut) syscall.Errno {
	out.Ino = n.node.ID
	if n.node.Type == "dir" {
		out.Mode = syscall.S_IFDIR | 0o755
		out.Nlink = 2
	} else {
		out.Mode = syscall.S_IFREG | 0o644
		out.Size = uint64(n.node.Size)
		out.Nlink = 1
	}
	if !n.node.UpdatedAt.IsZero() {
		out.SetTimes(nil, &n.node.UpdatedAt, nil)
	}
	return 0
}

func (n *linuxNode) Lookup(ctx context.Context, name string, out *fuse.EntryOut) (*fs.Inode, syscall.Errno) {
	children, err := n.cli.List(ctx, n.node.ID)
	if err != nil {
		return nil, errno(err)
	}
	for _, child := range children {
		if child.Name != name {
			continue
		}
		cn := &linuxNode{cli: n.cli, node: child}
		inode := n.NewInode(ctx, cn, cn.stableAttr())
		fillEntry(out, child)
		return inode, 0
	}
	return nil, syscall.ENOENT
}

func (n *linuxNode) Readdir(ctx context.Context) (fs.DirStream, syscall.Errno) {
	children, err := n.cli.List(ctx, n.node.ID)
	if err != nil {
		return nil, errno(err)
	}
	entries := make([]fuse.DirEntry, 0, len(children))
	for _, child := range children {
		mode := uint32(syscall.S_IFREG)
		if child.Type == "dir" {
			mode = syscall.S_IFDIR
		}
		entries = append(entries, fuse.DirEntry{Name: child.Name, Mode: mode, Ino: child.ID})
	}
	return fs.NewListDirStream(entries), 0
}

func (n *linuxNode) Mkdir(ctx context.Context, name string, mode uint32, out *fuse.EntryOut) (*fs.Inode, syscall.Errno) {
	created, err := n.cli.CreateDir(ctx, n.node.ID, name)
	if err != nil {
		return nil, errno(err)
	}
	cn := &linuxNode{cli: n.cli, node: created}
	fillEntry(out, created)
	return n.NewInode(ctx, cn, cn.stableAttr()), 0
}

func (n *linuxNode) Create(ctx context.Context, name string, flags uint32, mode uint32, out *fuse.EntryOut) (*fs.Inode, fs.FileHandle, uint32, syscall.Errno) {
	created, err := n.cli.Upload(ctx, n.node.ID, name, emptyReader{})
	if err != nil {
		return nil, nil, 0, errno(err)
	}
	cn := &linuxNode{cli: n.cli, node: created}
	h, err := newLinuxHandle(ctx, n.cli, created, flags, true)
	if err != nil {
		return nil, nil, 0, errno(err)
	}
	fillEntry(out, created)
	return n.NewInode(ctx, cn, cn.stableAttr()), h, fuse.FOPEN_KEEP_CACHE, 0
}

func (n *linuxNode) Open(ctx context.Context, flags uint32) (fs.FileHandle, uint32, syscall.Errno) {
	if n.node.Type != "file" {
		return nil, 0, syscall.EISDIR
	}
	h, err := newLinuxHandle(ctx, n.cli, n.node, flags, false)
	if err != nil {
		return nil, 0, errno(err)
	}
	return h, fuse.FOPEN_KEEP_CACHE, 0
}

func (n *linuxNode) Unlink(ctx context.Context, name string) syscall.Errno {
	child, err := n.findChild(ctx, name)
	if err != nil {
		return errno(err)
	}
	if child.Type == "dir" {
		return syscall.EISDIR
	}
	return errno0(n.cli.Delete(ctx, child.ID, child.Revision))
}

func (n *linuxNode) Rmdir(ctx context.Context, name string) syscall.Errno {
	child, err := n.findChild(ctx, name)
	if err != nil {
		return errno(err)
	}
	if child.Type != "dir" {
		return syscall.ENOTDIR
	}
	return errno0(n.cli.Delete(ctx, child.ID, child.Revision))
}

func (n *linuxNode) Rename(ctx context.Context, name string, newParent fs.InodeEmbedder, newName string, flags uint32) syscall.Errno {
	if flags != 0 {
		return syscall.EINVAL
	}
	child, err := n.findChild(ctx, name)
	if err != nil {
		return errno(err)
	}
	target, ok := newParent.(*linuxNode)
	if !ok {
		return syscall.EXDEV
	}
	if _, err := n.cli.RenameMove(ctx, child.ID, child.Revision, &newName, &target.node.ID); err != nil {
		return errno(err)
	}
	return 0
}

func (n *linuxNode) Setattr(ctx context.Context, fh fs.FileHandle, in *fuse.SetAttrIn, out *fuse.AttrOut) syscall.Errno {
	if n.node.Type != "file" {
		return syscall.EISDIR
	}
	if h, ok := fh.(*linuxHandle); ok {
		if size, ok := in.GetSize(); ok {
			if err := h.truncate(int64(size)); err != nil {
				return errno(err)
			}
		}
		return n.Getattr(ctx, fh, out)
	}
	if size, ok := in.GetSize(); ok {
		h, err := newLinuxHandle(ctx, n.cli, n.node, uint32(os.O_RDWR), false)
		if err != nil {
			return errno(err)
		}
		if err := h.truncate(int64(size)); err != nil {
			_ = h.Release(ctx)
			return errno(err)
		}
		if err := h.sync(ctx); err != nil {
			_ = h.Release(ctx)
			return errno(err)
		}
		_ = h.Release(ctx)
		n.node.Size = int64(size)
	}
	return n.Getattr(ctx, fh, out)
}

func (n *linuxNode) findChild(ctx context.Context, name string) (client.Node, error) {
	children, err := n.cli.List(ctx, n.node.ID)
	if err != nil {
		return client.Node{}, err
	}
	for _, child := range children {
		if child.Name == name {
			return child, nil
		}
	}
	return client.Node{}, os.ErrNotExist
}

type linuxHandle struct {
	mu       sync.Mutex
	cli      *client.Client
	node     client.Node
	file     *os.File
	path     string
	dirty    bool
	released bool
}

func newLinuxHandle(ctx context.Context, cli *client.Client, node client.Node, flags uint32, created bool) (*linuxHandle, error) {
	f, err := os.CreateTemp("", "xdrive-fuse-*")
	if err != nil {
		return nil, err
	}
	h := &linuxHandle{cli: cli, node: node, file: f, path: f.Name(), dirty: created}
	if !created && node.Size > 0 {
		if err := cli.DownloadTo(ctx, node.ID, f); err != nil {
			f.Close()
			os.Remove(f.Name())
			return nil, err
		}
		if _, err := f.Seek(0, io.SeekStart); err != nil {
			f.Close()
			os.Remove(f.Name())
			return nil, err
		}
	}
	if flags&uint32(os.O_TRUNC) != 0 {
		if err := f.Truncate(0); err != nil {
			return nil, err
		}
		h.dirty = true
	}
	return h, nil
}

func (h *linuxHandle) Read(ctx context.Context, dest []byte, off int64) (fuse.ReadResult, syscall.Errno) {
	h.mu.Lock()
	defer h.mu.Unlock()
	buf := make([]byte, len(dest))
	n, err := h.file.ReadAt(buf, off)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, errno(err)
	}
	return fuse.ReadResultData(buf[:n]), 0
}

func (h *linuxHandle) Write(ctx context.Context, data []byte, off int64) (uint32, syscall.Errno) {
	h.mu.Lock()
	defer h.mu.Unlock()
	n, err := h.file.WriteAt(data, off)
	if err != nil {
		return uint32(n), errno(err)
	}
	h.dirty = true
	return uint32(n), 0
}

func (h *linuxHandle) Flush(ctx context.Context) syscall.Errno { return errno0(h.sync(ctx)) }

func (h *linuxHandle) Fsync(ctx context.Context, flags uint32) syscall.Errno {
	h.mu.Lock()
	err := h.file.Sync()
	h.mu.Unlock()
	if err != nil {
		return errno(err)
	}
	return errno0(h.sync(ctx))
}

func (h *linuxHandle) Release(ctx context.Context) syscall.Errno {
	h.mu.Lock()
	if h.released {
		h.mu.Unlock()
		return 0
	}
	h.mu.Unlock()
	err := h.sync(ctx)
	h.mu.Lock()
	h.released = true
	closeErr := h.file.Close()
	_ = os.Remove(h.path)
	h.mu.Unlock()
	if err != nil {
		return errno(err)
	}
	return errno0(closeErr)
}

func (h *linuxHandle) truncate(size int64) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if err := h.file.Truncate(size); err != nil {
		return err
	}
	h.dirty = true
	return nil
}

func (h *linuxHandle) sync(ctx context.Context) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if !h.dirty || h.released {
		return nil
	}
	if err := h.file.Sync(); err != nil {
		return err
	}
	updated, err := h.cli.OverwriteFileResumable(ctx, h.node.ID, h.node.Revision, h.path, nil)
	if err != nil {
		if !client.IsRevisionConflict(err) || h.node.ParentID == nil {
			return err
		}
		conflict, uploadErr := h.cli.UploadFileResumable(ctx, *h.node.ParentID, h.path, conflictName(h.node.Name), nil)
		if uploadErr != nil {
			return uploadErr
		}
		h.node = conflict
		h.dirty = false
		return nil
	}
	h.node = updated
	h.dirty = false
	return nil
}

func fillEntry(out *fuse.EntryOut, n client.Node) {
	out.Ino = n.ID
	if n.Type == "dir" {
		out.Mode = syscall.S_IFDIR | 0o755
	} else {
		out.Mode = syscall.S_IFREG | 0o644
		out.Size = uint64(n.Size)
	}
}

func errno(err error) syscall.Errno {
	if err == nil {
		return 0
	}
	var apiErr *client.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.Status {
		case 400:
			return syscall.EINVAL
		case 401, 403:
			return syscall.EACCES
		case 404:
			return syscall.ENOENT
		case 409:
			return syscall.EBUSY
		case 428:
			return syscall.EINVAL
		case 413:
			return syscall.EFBIG
		}
	}
	if errors.Is(err, os.ErrNotExist) {
		return syscall.ENOENT
	}
	return syscall.EIO
}
func errno0(err error) syscall.Errno { return errno(err) }

type emptyReader struct{}

func (emptyReader) Read([]byte) (int, error) { return 0, io.EOF }

var _ fs.NodeLookuper = (*linuxNode)(nil)
var _ fs.NodeReaddirer = (*linuxNode)(nil)
var _ fs.NodeMkdirer = (*linuxNode)(nil)
var _ fs.NodeCreater = (*linuxNode)(nil)
var _ fs.NodeOpener = (*linuxNode)(nil)
var _ fs.NodeUnlinker = (*linuxNode)(nil)
var _ fs.NodeRmdirer = (*linuxNode)(nil)
var _ fs.NodeRenamer = (*linuxNode)(nil)
var _ fs.NodeSetattrer = (*linuxNode)(nil)
var _ fs.FileReader = (*linuxHandle)(nil)
var _ fs.FileWriter = (*linuxHandle)(nil)
var _ fs.FileFlusher = (*linuxHandle)(nil)
var _ fs.FileFsyncer = (*linuxHandle)(nil)
var _ fs.FileReleaser = (*linuxHandle)(nil)
