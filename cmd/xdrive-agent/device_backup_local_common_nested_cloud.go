//go:build linux || windows

package main

import (
	"context"
	"path"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
)

// Bounded one-Source-run cache; the Server always locks/revalidates every
// descendant of the authorized Source on Admit, Bind and CAS/SQL Finalize.
const localCommonCloudDirectoryCacheMax = 4096

func localCommonEnsureCloudDirectory(ctx context.Context, api *client.Client,
	sourceID, revision, rootID uint64, proof client.LocalBoundSourceProof,
	relativeDirectory string, cached map[string]uint64,
) (uint64, error) {
	if ctx == nil || ctx.Err() != nil || api == nil ||
		sourceID == 0 || revision == 0 || rootID == 0 ||
		!validLocalCommonBatchPath(relativeDirectory) {
		return 0, errLocalBackupCommonBatchUnavailable
	}
	parent := rootID
	prefix := ""
	for _, component := range strings.Split(relativeDirectory, "/") {
		if prefix == "" {
			prefix = component
		} else {
			prefix += "/" + component
		}
		if cached != nil {
			if id := cached[prefix]; id != 0 {
				parent = id
				continue
			}
		}
		node, err := api.EnsureLocalPushCommonDirectory(
			ctx, sourceID, revision, proof, parent, component)
		if err != nil || node.ID == 0 || node.Type != "dir" ||
			node.Name != component || node.ParentID == nil ||
			*node.ParentID != parent || node.Revision == 0 {
			return 0, errLocalBackupCommonBatchUnavailable
		}
		parent = node.ID
		if cached != nil {
			if len(cached) >= localCommonCloudDirectoryCacheMax {
				clear(cached)
			}
			cached[prefix] = node.ID
		}
	}
	return parent, nil
}

// Resolve a native file's parent; the leaf name is the only name submitted
// to the ordinary /uploads API. Slash-containing "flattened" names are
// forbidden. Every created intermediate folder uses the private owning-
// Device/Root/Source-admitted metadata route above.
func localCommonEnsureCloudParent(ctx context.Context, api *client.Client,
	sourceID, revision, rootID uint64, proof client.LocalBoundSourceProof,
	relativePath string, cached map[string]uint64,
) (uint64, string, error) {
	if ctx == nil || ctx.Err() != nil || rootID == 0 ||
		!validLocalCommonBatchPath(relativePath) {
		return 0, "", errLocalBackupCommonBatchUnavailable
	}
	directory := path.Dir(relativePath)
	if directory == "." {
		return rootID, path.Base(relativePath), nil
	}
	parent, err := localCommonEnsureCloudDirectory(
		ctx, api, sourceID, revision, rootID, proof, directory, cached)
	if err != nil {
		return 0, "", err
	}
	return parent, path.Base(relativePath), nil
}

// A file with any prior persisted Operation must resolve its directory
// through strictly read-only CURRENT Source checks. Never recreate the old
// relative path before reconciling its historical remote Node identity.
func localCommonFindExistingCloudParent(ctx context.Context, api *client.Client,
	sourceID, revision, rootID uint64, proof client.LocalBoundSourceProof,
	relativePath string,
) (uint64, string, error) {
	deny := errLocalBackupCommonBatchUnavailable
	if ctx == nil || ctx.Err() != nil || api == nil || sourceID == 0 ||
		revision == 0 || rootID == 0 || !validLocalCommonBatchPath(relativePath) {
		return 0, "", deny
	}
	leaf := path.Base(relativePath)
	relativeDirectory := path.Dir(relativePath)
	if relativeDirectory == "." {
		return rootID, leaf, nil
	}
	parent := rootID
	for _, component := range strings.Split(relativeDirectory, "/") {
		node, err := api.VerifyLocalPushCommonDirectory(
			ctx, sourceID, revision, proof, parent, component)
		if err != nil || node.ID == 0 || node.Type != "dir" ||
			node.ParentID == nil || *node.ParentID != parent ||
			node.Name != component || node.Revision == 0 {
			return 0, "", deny
		}
		parent = node.ID
	}
	if ctx.Err() != nil {
		return 0, "", deny
	}
	return parent, leaf, nil
}

// Recheck immediately before counting a historical committed file as
// unchanged. Never use the per-run directory cache as current authority.
func localCommonVerifyCloudParent(ctx context.Context, api *client.Client,
	sourceID, revision, rootID uint64, proof client.LocalBoundSourceProof,
	relativePath string, expectedParentID uint64,
) error {
	parent, _, err := localCommonFindExistingCloudParent(
		ctx, api, sourceID, revision, rootID, proof, relativePath)
	if err != nil || parent == 0 || parent != expectedParentID {
		return errLocalBackupCommonBatchUnavailable
	}
	return nil
}

// localCommonVerifyCloudFileUnchanged re-reads the actual CURRENT file, not
// just its parent. An immutable historical SQL COMMIT is not proof that a
// cloud file has stayed at the same Node revision since the first read.
// This is only a per-file incremental skip guard, NOT physical CAS proof.
func localCommonVerifyCloudFileUnchanged(ctx context.Context, api *client.Client,
	parentID uint64, expected *client.Node,
) error {
	if ctx == nil || ctx.Err() != nil || api == nil ||
		parentID == 0 || expected == nil || expected.ID == 0 ||
		expected.ParentID == nil || *expected.ParentID != parentID ||
		expected.Type != "file" || expected.Name == "" ||
		expected.Revision == 0 || expected.DeletedAt != nil {
		return errLocalBackupCommonBatchUnavailable
	}
	current, err := localCommonRootCurrentChild(ctx, api, parentID, expected.Name)
	if err != nil || current == nil ||
		current.ID != expected.ID ||
		current.Revision != expected.Revision ||
		current.Name != expected.Name ||
		current.Type != expected.Type ||
		current.ParentID == nil || *current.ParentID != parentID ||
		current.SHA256 != expected.SHA256 ||
		current.Size != expected.Size ||
		current.DeletedAt != nil {
		return errLocalBackupCommonBatchUnavailable
	}
	return nil
}
