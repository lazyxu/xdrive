package sourceagent

import (
	"context"
	"fmt"
	"os"
	"path"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
)

type ExecutionAPI interface {
	List(context.Context, uint64) ([]client.Node, error)
	CreateDir(context.Context, uint64, string) (client.Node, error)
	RenameMove(context.Context, uint64, uint64, *string, *uint64) (client.Node, error)
	UploadFileResumableResult(context.Context, uint64, string, string, client.UploadProgress) (client.UploadResult, error)
	OverwriteFileResumableResult(context.Context, uint64, uint64, string, client.UploadProgress) (client.UploadResult, error)
}

type Executor struct {
	API          ExecutionAPI
	TargetNodeID uint64
	dirCache     map[string]client.Node
}

func NewExecutor(api ExecutionAPI, targetNodeID uint64) *Executor {
	return &Executor{
		API:          api,
		TargetNodeID: targetNodeID,
		dirCache:     map[string]client.Node{"": {ID: targetNodeID, Type: meta.NodeTypeDir}},
	}
}

func (e *Executor) Execute(
	ctx context.Context,
	plan client.SourcePlan,
	item sourcepkg.DiscoveredItem,
	localPath string,
) (client.SourceCommit, error) {
	if e == nil || e.API == nil || e.TargetNodeID == 0 {
		return client.SourceCommit{}, fmt.Errorf("source executor is not configured")
	}
	action := sourcepkg.PlanAction(plan.Action)
	if !executionAction(action) {
		return client.SourceCommit{}, fmt.Errorf("unsupported source execution action %q", action)
	}
	if err := verifyLocalSnapshot(localPath, item); err != nil {
		return client.SourceCommit{}, err
	}

	commit := client.SourceCommit{
		ExternalID:     item.ExternalID,
		Action:         string(action),
		Kind:           item.Kind,
		Path:           item.Path,
		Size:           item.Size,
		ModifiedAt:     item.ModifiedAt,
		SHA256:         item.SHA256,
		RemoteRevision: item.RemoteRevision,
	}

	switch item.Kind {
	case meta.SourceItemKindDirectory:
		node, err := e.executeDirectory(ctx, plan, item, action)
		if err != nil {
			return client.SourceCommit{}, err
		}
		commit.NodeID = node.ID
		commit.NodeRevision = node.Revision
		return commit, nil

	case meta.SourceItemKindFile:
		node, hash, transferredBytes, err := e.executeFile(ctx, plan, item, localPath, action)
		if err != nil {
			return client.SourceCommit{}, err
		}
		commit.NodeID = node.ID
		commit.NodeRevision = node.Revision
		commit.SHA256 = hash
		commit.TransferredBytes = transferredBytes
		commit.Transferred = transferredBytes > 0
		return commit, nil

	default:
		return client.SourceCommit{}, fmt.Errorf("unsupported source item kind %q", item.Kind)
	}
}

func (e *Executor) executeDirectory(
	ctx context.Context,
	plan client.SourcePlan,
	item sourcepkg.DiscoveredItem,
	action sourcepkg.PlanAction,
) (client.Node, error) {
	switch action {
	case sourcepkg.ActionCreate:
		node, err := e.ensureDirectory(ctx, item.Path)
		if err != nil {
			return client.Node{}, err
		}
		e.dirCache[item.Path] = node
		return node, nil

	case sourcepkg.ActionUpdate:
		if plan.NodeID == nil || plan.NodeRevision == 0 {
			return client.Node{}, fmt.Errorf("directory update is missing node identity")
		}
		return client.Node{ID: *plan.NodeID, Type: meta.NodeTypeDir, Revision: plan.NodeRevision}, nil

	case sourcepkg.ActionMove, sourcepkg.ActionMoveUpdate:
		if plan.NodeID == nil || plan.NodeRevision == 0 {
			return client.Node{}, fmt.Errorf("directory move is missing node identity")
		}
		node, err := e.moveNodeToPath(ctx, *plan.NodeID, plan.NodeRevision, item.Path, meta.NodeTypeDir)
		if err != nil {
			return client.Node{}, err
		}
		e.resetDirCache()
		e.dirCache[item.Path] = node
		return node, nil
	default:
		return client.Node{}, fmt.Errorf("unsupported directory action %q", action)
	}
}

func (e *Executor) executeFile(
	ctx context.Context,
	plan client.SourcePlan,
	item sourcepkg.DiscoveredItem,
	localPath string,
	action sourcepkg.PlanAction,
) (client.Node, string, int64, error) {
	switch action {
	case sourcepkg.ActionCreate:
		parent, name, existing, err := e.destination(ctx, item.Path, 0)
		if err != nil {
			return client.Node{}, "", 0, err
		}
		if existing != nil {
			return client.Node{}, "", 0, fmt.Errorf("destination file %q already exists", item.Path)
		}
		result, err := e.API.UploadFileResumableResult(ctx, parent.ID, localPath, name, nil)
		if err != nil {
			return client.Node{}, "", 0, err
		}
		if err := verifyLocalSnapshot(localPath, item); err != nil {
			return client.Node{}, "", 0, err
		}
		return result.Node, result.SHA256, result.TransferredBytes, nil

	case sourcepkg.ActionUpdate:
		if plan.NodeID == nil || plan.NodeRevision == 0 {
			return client.Node{}, "", 0, fmt.Errorf("file update is missing node identity")
		}
		result, err := e.API.OverwriteFileResumableResult(ctx, *plan.NodeID, plan.NodeRevision, localPath, nil)
		if err != nil {
			return client.Node{}, "", 0, err
		}
		if err := verifyLocalSnapshot(localPath, item); err != nil {
			return client.Node{}, "", 0, err
		}
		return result.Node, result.SHA256, result.TransferredBytes, nil

	case sourcepkg.ActionMove:
		if plan.NodeID == nil || plan.NodeRevision == 0 {
			return client.Node{}, "", 0, fmt.Errorf("file move is missing node identity")
		}
		node, err := e.moveNodeToPath(ctx, *plan.NodeID, plan.NodeRevision, item.Path, meta.NodeTypeFile)
		if err != nil {
			return client.Node{}, "", 0, err
		}
		return node, item.SHA256, 0, nil

	case sourcepkg.ActionMoveUpdate:
		if plan.NodeID == nil || plan.NodeRevision == 0 {
			return client.Node{}, "", 0, fmt.Errorf("file move/update is missing node identity")
		}
		node, err := e.moveNodeToPath(ctx, *plan.NodeID, plan.NodeRevision, item.Path, meta.NodeTypeFile)
		if err != nil {
			return client.Node{}, "", 0, err
		}
		result, err := e.API.OverwriteFileResumableResult(ctx, node.ID, node.Revision, localPath, nil)
		if err != nil {
			return client.Node{}, "", 0, err
		}
		if err := verifyLocalSnapshot(localPath, item); err != nil {
			return client.Node{}, "", 0, err
		}
		return result.Node, result.SHA256, result.TransferredBytes, nil

	default:
		return client.Node{}, "", 0, fmt.Errorf("unsupported file action %q", action)
	}
}

func (e *Executor) moveNodeToPath(
	ctx context.Context,
	nodeID, revision uint64,
	relativePath, expectedType string,
) (client.Node, error) {
	parent, name, existing, err := e.destination(ctx, relativePath, nodeID)
	if err != nil {
		return client.Node{}, err
	}
	if existing != nil {
		if existing.ID != nodeID {
			return client.Node{}, fmt.Errorf("destination %q is occupied", relativePath)
		}
		if existing.Type != expectedType {
			return client.Node{}, fmt.Errorf("destination %q has type %q", relativePath, existing.Type)
		}
		return *existing, nil
	}
	return e.API.RenameMove(ctx, nodeID, revision, &name, &parent.ID)
}

func (e *Executor) destination(
	ctx context.Context,
	relativePath string,
	nodeID uint64,
) (client.Node, string, *client.Node, error) {
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
		if node, ok := e.dirCache[""]; ok {
			return node, nil
		}
		node := client.Node{ID: e.TargetNodeID, Type: meta.NodeTypeDir}
		e.dirCache[""] = node
		return node, nil
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
		if err := meta.ValidateName(segment); err != nil {
			return client.Node{}, err
		}
		nextPath := segment
		if currentPath != "" {
			nextPath = currentPath + "/" + segment
		}
		if cached, ok := e.dirCache[nextPath]; ok {
			current = cached
			currentPath = nextPath
			continue
		}
		children, err := e.API.List(ctx, current.ID)
		if err != nil {
			return client.Node{}, err
		}
		var exact *client.Node
		for i := range children {
			child := children[i]
			if child.Name == segment {
				if child.Type != meta.NodeTypeDir {
					return client.Node{}, fmt.Errorf("directory path %q collides with a file", nextPath)
				}
				copy := child
				exact = &copy
				break
			}
			if strings.EqualFold(child.Name, segment) {
				return client.Node{}, fmt.Errorf("directory path %q conflicts with existing name %q", nextPath, child.Name)
			}
		}
		if exact != nil {
			current = *exact
		} else {
			created, err := e.API.CreateDir(ctx, current.ID, segment)
			if err != nil {
				return client.Node{}, err
			}
			current = created
		}
		e.dirCache[nextPath] = current
		currentPath = nextPath
	}
	return current, nil
}

func (e *Executor) resetDirCache() {
	e.dirCache = map[string]client.Node{"": {ID: e.TargetNodeID, Type: meta.NodeTypeDir}}
}

func verifyLocalSnapshot(localPath string, item sourcepkg.DiscoveredItem) error {
	localPath = strings.TrimSpace(localPath)
	if localPath == "" {
		return fmt.Errorf("local source path is missing for %q", item.Path)
	}
	info, err := os.Lstat(localPath)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("local source path %q became a symbolic link", localPath)
	}
	switch item.Kind {
	case meta.SourceItemKindDirectory:
		if !info.IsDir() {
			return fmt.Errorf("local source path %q is no longer a directory", localPath)
		}
	case meta.SourceItemKindFile:
		if !info.Mode().IsRegular() {
			return fmt.Errorf("local source path %q is no longer a regular file", localPath)
		}
		if info.Size() != item.Size {
			return fmt.Errorf("local source file %q changed size after scan", localPath)
		}
		if item.ModifiedAt != nil && !info.ModTime().UTC().Equal(item.ModifiedAt.UTC()) {
			return fmt.Errorf("local source file %q changed mtime after scan", localPath)
		}
	default:
		return fmt.Errorf("unsupported source item kind %q", item.Kind)
	}
	return nil
}

func executionAction(action sourcepkg.PlanAction) bool {
	switch action {
	case sourcepkg.ActionCreate, sourcepkg.ActionUpdate, sourcepkg.ActionMove, sourcepkg.ActionMoveUpdate:
		return true
	default:
		return false
	}
}
