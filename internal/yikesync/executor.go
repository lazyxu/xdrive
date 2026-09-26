package yikesync

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"path"
	"strconv"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"github.com/lazyxu/xdrive/internal/yike"
)

type DownloadRemote interface {
	DownloadFileLink(context.Context, int64) (yike.DownloadLink, error)
	DownloadAlbumFileLink(context.Context, int64, yike.AlbumFile) (yike.DownloadLink, error)
	OpenDownload(context.Context, yike.DownloadLink, int64) (io.ReadCloser, error)
}

type ExecutionAPI interface {
	List(context.Context, uint64) ([]client.Node, error)
	CreateDir(context.Context, uint64, string) (client.Node, error)
	RenameMove(context.Context, uint64, uint64, *string, *uint64) (client.Node, error)
	UploadStreamResumableResult(context.Context, uint64, string, int64, string, client.UploadStreamOpen, client.UploadProgress) (client.UploadResult, error)
	OverwriteStreamResumableResult(context.Context, uint64, uint64, int64, string, client.UploadStreamOpen, client.UploadProgress) (client.UploadResult, error)
}

type TransferRef struct {
	OwnUK     int64
	OwnerUK   int64
	File      yike.File
	AlbumFile *yike.AlbumFile
}

type Executor struct {
	Remote       DownloadRemote
	API          ExecutionAPI
	TargetNodeID uint64
	Heartbeat    func(context.Context) error
	dirCache     map[string]client.Node
}

func NewExecutor(remote DownloadRemote, api ExecutionAPI, targetNodeID uint64) *Executor {
	return &Executor{
		Remote: remote, API: api, TargetNodeID: targetNodeID,
		dirCache: map[string]client.Node{"": {ID: targetNodeID, Type: meta.NodeTypeDir}},
	}
}

func (e *Executor) Execute(ctx context.Context, plan client.SourcePlan, item sourcepkg.DiscoveredItem, ref TransferRef) (client.SourceCommit, error) {
	if e == nil || e.Remote == nil || e.API == nil || e.TargetNodeID == 0 {
		return client.SourceCommit{}, fmt.Errorf("Yike executor is not configured")
	}
	action := sourcepkg.PlanAction(plan.Action)
	commit := client.SourceCommit{
		ExternalID: item.ExternalID, Action: string(action), Kind: item.Kind, Path: item.Path,
		Size: item.Size, ModifiedAt: item.ModifiedAt, RemoteRevision: item.RemoteRevision,
	}
	if item.Kind != meta.SourceItemKindFile {
		return client.SourceCommit{}, fmt.Errorf("Yike executor only supports files")
	}

	var (
		node  client.Node
		hash  string
		bytes int64
		err   error
	)
	switch action {
	case sourcepkg.ActionCreate:
		parent, name, existing, destErr := e.destination(ctx, item.Path, 0)
		if destErr != nil {
			return client.SourceCommit{}, destErr
		}
		if existing != nil {
			return client.SourceCommit{}, fmt.Errorf("destination %q already exists", item.Path)
		}
		result, uploadErr := e.API.UploadStreamResumableResult(
			ctx, parent.ID, name, item.Size, resumeKey(item),
			e.open(ref), e.progress(ctx),
		)
		if uploadErr != nil {
			return client.SourceCommit{}, uploadErr
		}
		node, hash, bytes = result.Node, result.SHA256, result.TransferredBytes

	case sourcepkg.ActionUpdate:
		if plan.NodeID == nil || plan.NodeRevision == 0 {
			return client.SourceCommit{}, fmt.Errorf("Yike update is missing node identity")
		}
		result, uploadErr := e.API.OverwriteStreamResumableResult(
			ctx, *plan.NodeID, plan.NodeRevision, item.Size, resumeKey(item),
			e.open(ref), e.progress(ctx),
		)
		if uploadErr != nil {
			return client.SourceCommit{}, uploadErr
		}
		node, hash, bytes = result.Node, result.SHA256, result.TransferredBytes

	case sourcepkg.ActionMove:
		if plan.NodeID == nil || plan.NodeRevision == 0 {
			return client.SourceCommit{}, fmt.Errorf("Yike move is missing node identity")
		}
		node, err = e.moveNodeToPath(ctx, *plan.NodeID, plan.NodeRevision, item.Path)
		if err != nil {
			return client.SourceCommit{}, err
		}
		hash = node.SHA256

	case sourcepkg.ActionMoveUpdate:
		if plan.NodeID == nil || plan.NodeRevision == 0 {
			return client.SourceCommit{}, fmt.Errorf("Yike move/update is missing node identity")
		}
		node, err = e.moveNodeToPath(ctx, *plan.NodeID, plan.NodeRevision, item.Path)
		if err != nil {
			return client.SourceCommit{}, err
		}
		result, uploadErr := e.API.OverwriteStreamResumableResult(
			ctx, node.ID, node.Revision, item.Size, resumeKey(item),
			e.open(ref), e.progress(ctx),
		)
		if uploadErr != nil {
			return client.SourceCommit{}, uploadErr
		}
		node, hash, bytes = result.Node, result.SHA256, result.TransferredBytes

	default:
		return client.SourceCommit{}, fmt.Errorf("unsupported Yike execution action %q", action)
	}
	if strings.TrimSpace(hash) == "" {
		hash = node.SHA256
	}
	commit.NodeID = node.ID
	commit.NodeRevision = node.Revision
	commit.SHA256 = hash
	commit.TransferredBytes = bytes
	commit.Transferred = bytes > 0
	return commit, nil
}

func (e *Executor) progress(ctx context.Context) client.UploadProgress {
	if e.Heartbeat == nil {
		return nil
	}
	return func(_, _ int64) {
		_ = e.Heartbeat(ctx)
	}
}

func (e *Executor) open(ref TransferRef) client.UploadStreamOpen {
	return func(ctx context.Context, offset int64) (io.ReadCloser, error) {
		var (
			link yike.DownloadLink
			err  error
		)
		if ref.AlbumFile != nil {
			link, err = e.Remote.DownloadAlbumFileLink(ctx, ref.OwnUK, *ref.AlbumFile)
		} else {
			link, err = e.Remote.DownloadFileLink(ctx, ref.File.FSID)
		}
		if err != nil {
			return nil, err
		}
		return e.Remote.OpenDownload(ctx, link, offset)
	}
}

func executionAction(action sourcepkg.PlanAction) bool {
	switch action {
	case sourcepkg.ActionCreate, sourcepkg.ActionUpdate, sourcepkg.ActionMove, sourcepkg.ActionMoveUpdate:
		return true
	default:
		return false
	}
}

func resumeKey(item sourcepkg.DiscoveredItem) string {
	modified := int64(0)
	if item.ModifiedAt != nil {
		modified = item.ModifiedAt.UTC().UnixNano()
	}
	value := item.ExternalID + "\x00" + strconv.FormatInt(item.Size, 10) + "\x00" +
		strconv.FormatInt(modified, 10) + "\x00" + item.RemoteRevision
	sum := sha256.Sum256([]byte(value))
	return "yike:" + hex.EncodeToString(sum[:])
}

func (e *Executor) moveNodeToPath(ctx context.Context, nodeID, revision uint64, relativePath string) (client.Node, error) {
	parent, name, existing, err := e.destination(ctx, relativePath, nodeID)
	if err != nil {
		return client.Node{}, err
	}
	if existing != nil {
		if existing.ID != nodeID {
			return client.Node{}, fmt.Errorf("destination %q is occupied", relativePath)
		}
		return *existing, nil
	}
	return e.API.RenameMove(ctx, nodeID, revision, &name, &parent.ID)
}

func (e *Executor) destination(ctx context.Context, relativePath string, nodeID uint64) (client.Node, string, *client.Node, error) {
	clean, err := sourcepkg.NormalizeRelativePath(relativePath)
	if err != nil {
		return client.Node{}, "", nil, err
	}
	parentPath := path.Dir(clean)
	if parentPath == "." {
		parentPath = ""
	}
	name := path.Base(clean)
	if err := meta.ValidateName(name); err != nil {
		return client.Node{}, "", nil, err
	}
	parent, err := e.ensureDirectory(ctx, parentPath)
	if err != nil {
		return client.Node{}, "", nil, err
	}
	children, err := e.API.List(ctx, parent.ID)
	if err != nil {
		return client.Node{}, "", nil, err
	}
	for i := range children {
		child := children[i]
		if child.Name == name {
			copy := child
			return parent, name, &copy, nil
		}
		if strings.EqualFold(child.Name, name) {
			if nodeID != 0 && child.ID == nodeID {
				return parent, name, nil, nil
			}
			return client.Node{}, "", nil, fmt.Errorf("destination %q conflicts with existing name %q", relativePath, child.Name)
		}
	}
	return parent, name, nil, nil
}

func (e *Executor) ensureDirectory(ctx context.Context, relativePath string) (client.Node, error) {
	relativePath = strings.Trim(strings.ReplaceAll(strings.TrimSpace(relativePath), "\\", "/"), "/")
	if relativePath == "" {
		return e.dirCache[""], nil
	}
	clean, err := sourcepkg.NormalizeRelativePath(relativePath)
	if err != nil {
		return client.Node{}, err
	}
	if node, ok := e.dirCache[clean]; ok {
		return node, nil
	}
	current := e.dirCache[""]
	currentPath := ""
	for _, segment := range strings.Split(clean, "/") {
		nextPath := segment
		if currentPath != "" {
			nextPath = currentPath + "/" + segment
		}
		if cached, ok := e.dirCache[nextPath]; ok {
			current, currentPath = cached, nextPath
			continue
		}
		children, err := e.API.List(ctx, current.ID)
		if err != nil {
			return client.Node{}, err
		}
		var found *client.Node
		for i := range children {
			if children[i].Name == segment {
				if children[i].Type != meta.NodeTypeDir {
					return client.Node{}, fmt.Errorf("directory path %q collides with a file", nextPath)
				}
				copy := children[i]
				found = &copy
				break
			}
			if strings.EqualFold(children[i].Name, segment) {
				return client.Node{}, fmt.Errorf("directory path %q conflicts with existing name %q", nextPath, children[i].Name)
			}
		}
		if found != nil {
			current = *found
		} else {
			current, err = e.API.CreateDir(ctx, current.ID, segment)
			if err != nil {
				return client.Node{}, err
			}
		}
		e.dirCache[nextPath] = current
		currentPath = nextPath
	}
	return current, nil
}
