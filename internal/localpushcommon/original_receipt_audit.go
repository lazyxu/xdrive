package localpushcommon

import (
	"context"

	"github.com/lazyxu/xdrive/internal/client"
)

const maxReadOnlyOriginalsPerFile = 4096

// OriginalReceiptReader is deliberately narrower than DurableTransport.
// A reconciliation caller can only read the ORIGINAL immutable SQL result;
// this interface cannot admit, bind, send bytes or finalize an upload.
type OriginalReceiptReader interface {
	ReadLocalPushCommonUploadReceipt(context.Context, uint64, uint64,
		client.LocalBoundSourceProof, string, string) (client.LocalPushCommonUploadReceipt, error)
}

// VerifiedOriginalReceipt stays in the owning Agent. Neither its Plan nor its
// private SQL receipt may be serialized to Desktop IPC or Web.
type VerifiedOriginalReceipt struct {
	Plan    Plan
	Receipt client.LocalPushCommonUploadReceipt
}

// ReadVerifiedOriginalFileReceipts is a read-only preflight for ONE file's
// previously fsynced private plans. It does not change run checkpoints,
// permit automatic resumption or establish current CAS/whole-Source proof.
//
// All plans are scope-fenced BEFORE any network read; even if one receipt is
// committed, ANY unknown/invalid sibling fails the entire group closed.
// Original read retry is allowed only for transient read transport errors.
// A pending reserved/bound result is exposed as pending, NEVER success.
func ReadVerifiedOriginalFileReceipts(
	ctx context.Context, reader OriginalReceiptReader,
	proof client.LocalBoundSourceProof, sourceID, revision uint64,
	plans []Plan,
) ([]VerifiedOriginalReceipt, error) {
	if ctx == nil || ctx.Err() != nil || reader == nil ||
		sourceID == 0 || revision == 0 || len(plans) > maxReadOnlyOriginalsPerFile {
		return nil, ErrUncertain
	}
	if len(plans) == 0 {
		return nil, nil
	}
	seen := make(map[string]struct{}, len(plans))
	original := plans[0]
	for _, p := range plans {
		if p.Validate() != nil || !validDurableScope(p, proof) ||
			p.SourceID != sourceID || p.SourceRevision != revision ||
			p.Server != original.Server || p.Account != original.Account ||
			p.OwnerSession != original.OwnerSession ||
			p.RelativePath != original.RelativePath {
			return nil, ErrUncertain
		}
		if _, exists := seen[p.OperationID]; exists {
			return nil, ErrUncertain
		}
		seen[p.OperationID] = struct{}{}
		if _, err := p.ResumeKey(); err != nil {
			return nil, ErrUncertain
		}
	}

	result := make([]VerifiedOriginalReceipt, 0, len(plans))
	for _, p := range plans {
		if ctx.Err() != nil {
			return nil, ErrUncertain
		}
		key, err := p.ResumeKey()
		if err != nil {
			return nil, ErrUncertain
		}
		receipt, err := ReadOriginalReceiptWithBackoff(ctx,
			func() (client.LocalPushCommonUploadReceipt, error) {
				return reader.ReadLocalPushCommonUploadReceipt(ctx, sourceID,
					revision, proof, p.OperationID, key)
			})
		if err != nil || ctx.Err() != nil ||
			receipt.SourceID != sourceID || receipt.Revision != revision ||
			receipt.OperationID != p.OperationID {
			return nil, ErrUncertain
		}
		switch receipt.State {
		case "committed":
			if !matchesDurableReceipt(p, receipt) {
				return nil, ErrUncertain
			}
		case "reserved", "bound":
			if receipt.Committed || receipt.NodeID != 0 ||
				receipt.NodeRevision != 0 || receipt.ContentSHA256 != "" {
				return nil, ErrUncertain
			}
		default:
			return nil, ErrUncertain
		}
		result = append(result, VerifiedOriginalReceipt{Plan: p, Receipt: receipt})
	}
	return result, nil
}
