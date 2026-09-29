package pullsync

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
)

type ExecutionAPI interface {
	List(context.Context, uint64) ([]client.Node, error)
	CreateDir(context.Context, uint64, string) (client.Node, error)
	RenameMove(context.Context, uint64, uint64, *string, *uint64) (client.Node, error)
	UploadStreamResumableDigestResult(context.Context, uint64, string, int64, string, string, client.UploadStreamOpen, client.UploadProgress) (client.UploadResult, error)
	OverwriteStreamResumableDigestResult(context.Context, uint64, uint64, int64, string, string, client.UploadStreamOpen, client.UploadProgress) (client.UploadResult, error)
}

type OpenFunc[Ref any] func(context.Context, Ref, int64) (io.ReadCloser, error)
type MD5Func[Ref any] func(Ref) string

type Executor[Ref any] struct {
	API          ExecutionAPI
	TargetNodeID uint64
	ResumePrefix string
	Open         OpenFunc[Ref]
	MD5          MD5Func[Ref]
	Heartbeat    func(context.Context) error
	Progress     func(context.Context, string, int64, int64) error
	dirCache     map[string]client.Node
}

func NewExecutor[Ref any](
	api ExecutionAPI,
	targetNodeID uint64,
	resumePrefix string,
	open OpenFunc[Ref],
	md5 MD5Func[Ref],
) *Executor[Ref] {
	return &Executor[Ref]{
		API: api, TargetNodeID: targetNodeID,
		ResumePrefix: strings.TrimSpace(resumePrefix),
		Open:         open, MD5: md5,
		dirCache: map[string]client.Node{"": {ID: targetNodeID, Type: meta.NodeTypeDir}},
	}
}

func (e *Executor[Ref]) Execute(
	ctx context.Context,
	plan client.SourcePlan,
	item sourcepkg.DiscoveredItem,
	ref Ref,
) (client.SourceCommit, error) {
	if e == nil || e.API == nil || e.TargetNodeID == 0 || e.Open == nil {
		return client.SourceCommit{}, fmt.Errorf("pull transfer executor is not configured")
	}
	action := sourcepkg.PlanAction(plan.Action)
	commit := client.SourceCommit{
		ExternalID: item.ExternalID, Action: string(action), Kind: item.Kind, Path: item.Path,
		Size: item.Size, ModifiedAt: item.ModifiedAt, RemoteRevision: item.RemoteRevision,
	}
	if item.Kind != meta.SourceItemKindFile {
		return client.SourceCommit{}, fmt.Errorf("pull transfer executor only supports files")
	}

	md5Digest := ""
	if e.MD5 != nil {
		md5Digest = strings.TrimSpace(e.MD5(ref))
	}

	var (
		node        client.Node
		hash        string
		transferred int64
		err         error
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
		result, uploadErr := e.API.UploadStreamResumableDigestResult(
			ctx, parent.ID, name, item.Size, md5Digest, e.resumeKey(item),
			e.open(ref), e.progress(ctx, item.Path),
		)
		if uploadErr != nil {
			return client.SourceCommit{}, uploadErr
		}
		node, hash, transferred = result.Node, result.SHA256, result.TransferredBytes

	case sourcepkg.ActionUpdate:
		if plan.NodeID == nil || plan.NodeRevision == 0 {
			return client.SourceCommit{}, fmt.Errorf("pull update is missing node identity")
		}
		result, uploadErr := e.API.OverwriteStreamResumableDigestResult(
			ctx, *plan.NodeID, plan.NodeRevision, item.Size, md5Digest, e.resumeKey(item),
			e.open(ref), e.progress(ctx, item.Path),
		)
		if uploadErr != nil {
			return client.SourceCommit{}, uploadErr
		}
		node, hash, transferred = result.Node, result.SHA256, result.TransferredBytes

	case sourcepkg.ActionMove:
		if plan.NodeID == nil || plan.NodeRevision == 0 {
			return client.SourceCommit{}, fmt.Errorf("pull move is missing node identity")
		}
		node, err = e.moveNodeToPath(ctx, *plan.NodeID, plan.NodeRevision, item.Path)
		if err != nil {
			return client.SourceCommit{}, err
		}
		hash = node.SHA256

	case sourcepkg.ActionMoveUpdate:
		if plan.NodeID == nil || plan.NodeRevision == 0 {
			return client.SourceCommit{}, fmt.Errorf("pull move/update is missing node identity")
		}
		node, err = e.moveNodeToPath(ctx, *plan.NodeID, plan.NodeRevision, item.Path)
		if err != nil {
			return client.SourceCommit{}, err
		}
		result, uploadErr := e.API.OverwriteStreamResumableDigestResult(
			ctx, node.ID, node.Revision, item.Size, md5Digest, e.resumeKey(item),
			e.open(ref), e.progress(ctx, item.Path),
		)
		if uploadErr != nil {
			return client.SourceCommit{}, uploadErr
		}
		node, hash, transferred = result.Node, result.SHA256, result.TransferredBytes

	default:
		return client.SourceCommit{}, fmt.Errorf("unsupported pull execution action %q", action)
	}
	if strings.TrimSpace(hash) == "" {
		hash = node.SHA256
	}
	commit.NodeID = node.ID
	commit.NodeRevision = node.Revision
	commit.SHA256 = hash
	commit.TransferredBytes = transferred
	commit.Transferred = transferred > 0
	return commit, nil
}

func (e *Executor[Ref]) open(ref Ref) client.UploadStreamOpen {
	return func(ctx context.Context, offset int64) (io.ReadCloser, error) {
		return e.Open(ctx, ref, offset)
	}
}

func (e *Executor[Ref]) progress(ctx context.Context, itemPath string) client.UploadProgress {
	if e.Progress == nil && e.Heartbeat == nil {
		return nil
	}
	return func(done, total int64) {
		if e.Progress != nil {
			_ = e.Progress(ctx, itemPath, done, total)
			return
		}
		_ = e.Heartbeat(ctx)
	}
}

func (e *Executor[Ref]) resumeKey(item sourcepkg.DiscoveredItem) string {
	modified := int64(0)
	if item.ModifiedAt != nil {
		modified = item.ModifiedAt.UTC().UnixNano()
	}
	value := item.ExternalID + "\x00" + strconv.FormatInt(item.Size, 10) + "\x00" +
		strconv.FormatInt(modified, 10) + "\x00" + item.RemoteRevision
	sum := sha256.Sum256([]byte(value))
	prefix := e.ResumePrefix
	if prefix == "" {
		prefix = "pull"
	}
	return prefix + ":" + hex.EncodeToString(sum[:])
}

func (e *Executor[Ref]) moveNodeToPath(ctx context.Context, nodeID, revision uint64, relativePath string) (client.Node, error) {
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

func (e *Executor[Ref]) destination(ctx context.Context, relativePath string, nodeID uint64) (client.Node, string, *client.Node, error) {
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

func (e *Executor[Ref]) ensureDirectory(ctx context.Context, relativePath string) (client.Node, error) {
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
