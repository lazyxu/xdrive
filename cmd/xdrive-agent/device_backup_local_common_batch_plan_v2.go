package main

import (
	"errors"
	"path"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpushcommon"
)

// Every prior entry must have a current, independently authenticated ORIGINAL
// Server SQL receipt. No local JSON state authorizes an overwrite by itself.
type localCommonVerifiedOriginal struct {
	Plan    localpushcommon.Plan
	Receipt client.LocalPushCommonUploadReceipt
}

var errLocalCommonBatchConflict = errors.New("local Push file requires original Operation reconciliation")

func localCommonReceiptMatchesPlan(p localpushcommon.Plan, r client.LocalPushCommonUploadReceipt) bool {
	if p.Validate() != nil || !r.Committed || r.State != "committed" ||
		r.SourceID != p.SourceID || r.Revision != p.SourceRevision ||
		r.OperationID != p.OperationID || r.NodeID == 0 ||
		r.ContentSHA256 != p.ContentSHA256 || r.Size != p.Size {
		return false
	}
	if p.Target.NodeID == 0 {
		return r.NodeRevision == 1 && p.Target.ParentID > 0
	}
	return r.NodeID == p.Target.NodeID &&
		r.NodeRevision == p.Target.ExpectedRevision+1
}

// decideLocalCommonRootFile uses only private planned Operations, authenticated
// immutable SQL receipts and a CURRENT cloud Node. It rejects preexisting
// unrelated files and external cloud mutations rather than overwriting them.
// "skip" is only a per-file content decision, NEVER backup_complete.
func decideLocalCommonRootFile(relativePath, sha string, size int64, sourceID,
	sourceRevision, targetParentID uint64, current *client.Node,
	originals []localCommonVerifiedOriginal,
) (localpushcommon.Target, bool, error) {
	var empty localpushcommon.Target
	deny := errLocalCommonBatchConflict
	if relativePath == "" || size < 0 || len(sha) != 64 ||
		sourceID == 0 || sourceRevision == 0 || targetParentID == 0 {
		return empty, false, deny
	}
	if current != nil &&
		(current.ID == 0 || current.Type != "file" ||
			current.ParentID == nil || *current.ParentID != targetParentID ||
			current.Name != path.Base(relativePath) || current.Revision == 0 ||
			current.DeletedAt != nil) {
		return empty, false, deny
	}
	var newest client.LocalPushCommonUploadReceipt
	var pending *localpushcommon.Plan
	var firstNodeID uint64
	committed := make(map[uint64]client.LocalPushCommonUploadReceipt)
	for _, original := range originals {
		p, r := original.Plan, original.Receipt
		if p.Validate() != nil || p.SourceID != sourceID ||
			p.SourceRevision != sourceRevision || p.RelativePath != relativePath ||
			r.SourceID != p.SourceID || r.Revision != p.SourceRevision ||
			r.OperationID != p.OperationID {
			return empty, false, deny
		}
		switch r.State {
		case "reserved", "bound":
			if pending != nil || r.Committed || r.NodeID != 0 ||
				r.NodeRevision != 0 || r.ContentSHA256 != "" {
				return empty, false, deny
			}
			held := p
			pending = &held
		case "committed":
			if !localCommonReceiptMatchesPlan(p, r) ||
				(p.Target.NodeID == 0 &&
					(p.Target.ParentID != targetParentID || p.Target.Name != path.Base(relativePath))) {
				return empty, false, deny
			}
			if firstNodeID == 0 {
				firstNodeID = r.NodeID
			} else if firstNodeID != r.NodeID {
				return empty, false, deny
			}
			if _, exists := committed[r.NodeRevision]; exists {
				return empty, false, deny
			}
			committed[r.NodeRevision] = r
			if r.NodeRevision > newest.NodeRevision {
				newest = r
			}
		default:
			return empty, false, deny
		}
	}
	// Revisions must form the complete original committed sequence. A gap
	// or a local operation whose result changed Node identity is not proof.
	// Revisions are distinct and positive, each <= newest. If their
	// count equals newest revision, they must form the full 1..N chain.
	// Never loop over an attacker-controlled uint64 Node revision.
	if newest.NodeRevision != uint64(len(committed)) {
		return empty, false, deny
	}
	if newest.NodeRevision == 0 {
		if current != nil {
			return empty, false, deny // unrelated remote file; never claim ownership
		}
		if pending != nil {
			if pending.Target.ParentID != targetParentID ||
				pending.Target.NodeID != 0 || pending.Target.Name != path.Base(relativePath) ||
				pending.ContentSHA256 != sha || pending.Size != size {
				return empty, false, deny
			}
			return pending.Target, false, nil
		}
		return localpushcommon.Target{ParentID: targetParentID, Name: path.Base(relativePath)}, false, nil
	}
	if current == nil || current.ID != newest.NodeID ||
		current.Revision != newest.NodeRevision ||
		current.SHA256 != newest.ContentSHA256 || current.Size != newest.Size {
		return empty, false, deny
	}
	if pending != nil {
		if pending.Target.ParentID != 0 ||
			pending.Target.NodeID != newest.NodeID ||
			pending.Target.ExpectedRevision != newest.NodeRevision ||
			pending.ContentSHA256 != sha || pending.Size != size {
			return empty, false, deny
		}
		return pending.Target, false, nil
	}
	if sha == newest.ContentSHA256 && size == newest.Size {
		return empty, true, nil
	}
	return localpushcommon.Target{
		NodeID: newest.NodeID, ExpectedRevision: newest.NodeRevision,
	}, false, nil
}
