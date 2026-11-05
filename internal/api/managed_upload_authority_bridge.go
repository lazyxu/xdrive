package api

import (
	"context"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// A Pull worker's signed SourceRun grants and a native Local Push device's
// durable Operation are independent authorities. Never let a generic Owner
// bearer or a mere lp2_ prefix become a managed-tree writer.
func requireSourceRunOrLocalPushTargetTx(
	ctx context.Context, tx *gorm.DB, c *gin.Context, ownerID, nodeID uint64, req uploadInitRequest,
) error {
	if _, photos := currentIOSPhotoManagedUploadScope(c); photos {
		if _, run := currentSourceRunScope(c); run {
			return errManagedSourceWriteDenied
		}
		return requireIOSPhotoManagedUploadTx(ctx, tx, c, ownerID, nodeID, req)
	}
	if req.SourceID != 0 {
		return requireSynologyPushUploadTargetTx(ctx, tx, c, ownerID, nodeID, req)
	}
	if _, scoped := currentSourceRunScope(c); scoped {
		return requireSourceRunOrOrdinaryTargetTx(ctx, tx, c, ownerID, nodeID)
	}
	return requireOrdinaryOrAdmittedLocalPushTargetTx(ctx, tx, ownerID, nodeID, req)
}

func requireSourceRunOrLocalPushFinalizeTx(
	ctx context.Context, tx *gorm.DB, c *gin.Context, session meta.UploadSession, nodeID uint64,
) error {
	if _, photos := currentIOSPhotoManagedUploadScope(c); photos {
		if _, run := currentSourceRunScope(c); run {
			return errManagedSourceWriteDenied
		}
		return requireIOSPhotoManagedFinalizeTx(ctx, tx, c, session, nodeID)
	}
	if session.SourceID != 0 {
		return requireSynologyPushUploadSessionTx(ctx, tx, c, session)
	}
	if _, scoped := currentSourceRunScope(c); scoped {
		return requireSourceRunOrOrdinaryTargetTx(ctx, tx, c, session.OwnerID, nodeID)
	}
	return requireOrdinaryOrBoundLocalPushFinalizeTx(ctx, tx, session, nodeID)
}
