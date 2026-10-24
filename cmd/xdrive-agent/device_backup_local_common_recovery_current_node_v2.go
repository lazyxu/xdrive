//go:build linux || windows

package main

import (
	"github.com/lazyxu/xdrive/internal/client"
)

// localCommonHistoricalMatchesCurrentNode verifies ONLY the current cloud
// Node metadata against the same complete original SQL revision chain.
// It does not read physical CAS bytes, hash the present local file, or
// authorize a write, migration, recovery, or whole-Source completion.
//
// This intentionally reuses the manual Runner's proven target decision,
// rather than maintaining a second set of Node/Parent/Revision rules.
func localCommonHistoricalMatchesCurrentNode(
	relativePath string, parentID uint64, current *client.Node,
	originals []localCommonVerifiedOriginal,
) bool {
	if relativePath == "" || parentID == 0 || current == nil ||
		len(originals) == 0 {
		return false
	}
	var newest client.LocalPushCommonUploadReceipt
	var sourceID, sourceRevision uint64
	for _, original := range originals {
		p, r := original.Plan, original.Receipt
		if p.Validate() != nil || r.State != "committed" || !r.Committed ||
			p.RelativePath != relativePath || r.SourceID != p.SourceID ||
			r.Revision != p.SourceRevision || r.OperationID != p.OperationID {
			return false
		}
		if sourceID == 0 {
			sourceID, sourceRevision = p.SourceID, p.SourceRevision
		} else if sourceID != p.SourceID || sourceRevision != p.SourceRevision {
			return false
		}
		if r.NodeRevision > newest.NodeRevision {
			newest = r
		}
	}
	if newest.NodeRevision == 0 {
		return false
	}
	_, skipped, err := decideLocalCommonRootFile(
		relativePath, newest.ContentSHA256, newest.Size,
		sourceID, sourceRevision, parentID, current, originals)
	return err == nil && skipped
}
