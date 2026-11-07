package api

import (
	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// Revalidate the live UploadSession writer before physical chunk staging.
// SourceID is never sufficient: iOS/Android require their exact scoped device
// proof; local-folder operations, Pull SourceRuns and ordinary uploads are
// admitted by their separate SQL-backed permissions. No retired DSM writer
// can borrow an Owner JWT to finish an old session.
func (s *Server) verifyPushUploadSession(c *gin.Context, session meta.UploadSession) error {
	if c == nil || c.Request == nil {
		return errManagedSourceWriteDenied
	}
	return s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		return s.requireUploadSessionReadAuthorityTx(c.Request.Context(), tx, c, session)
	})
}
