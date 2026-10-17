package api

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const baiduGeoconvServerAKReadTimeout = 2 * time.Second

// currentBaiduGeoconvServerAK is a PRIVATE credential callback for a future
// independently licensed Geoconv dispatcher. It is not wired to any caller,
// HTTP route, Agent IPC, JSAPI loader, scheduled worker or startup path.
// Only the existing Server Static/Web-Service AK can satisfy this callback;
// the separate encrypted JSAPI Browser AK must never be used for Geoconv.
//
// An AK is not a Baidu account entitlement. The existing source/consent,
// per-account permission, fleet/Owner lease and quota checks remain mandatory
// before a trusted dispatcher could invoke this function. Nothing here permits
// provider egress or changes JSAPI4 runtime_enabled=false.
func (s *Server) currentBaiduGeoconvServerAK(ctx context.Context, ownerID uint64) (string, error) {
	denied := errBaiduGeoconvDispatchUnavailable
	if s == nil || s.DB == nil || ctx == nil || ctx.Err() != nil ||
		ownerID == 0 || ownerID > baiduGeoconvQuotaMaxOwnerID {
		return "", denied
	}
	readCtx, cancel := context.WithTimeout(ctx, baiduGeoconvServerAKReadTimeout)
	defer cancel()

	// The current authenticated Owner must be enabled both before and after
	// decrypting the current Server credential. Never log user/secret records,
	// SQL predicates, returned errors or the credential itself.
	activeOwner := func() bool {
		var owner meta.User
		err := s.DB.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)}).
			WithContext(readCtx).
			Select("id", "session_version", "disabled_at", "must_change_password").
			Where("id = ? AND disabled_at IS NULL AND must_change_password = ? AND session_version > 0", ownerID, false).
			Take(&owner).Error
		return err == nil && readCtx.Err() == nil && owner.ID == ownerID &&
			owner.SessionVersion > 0 && owner.DisabledAt == nil && !owner.MustChangePassword
	}
	if !activeOwner() {
		return "", denied
	}

	// effectiveBaiduMapConfig reads the saved AEAD ciphertext on EVERY call,
	// falling back only to the trusted Server deployment setting if no saved
	// Server row exists. A disabled or cleared saved row must not fall back.
	cfg, err := s.effectiveBaiduMapConfig(readCtx)
	if err != nil || readCtx.Err() != nil || !cfg.Enabled || !cfg.Configured ||
		!validBaiduMapAK(cfg.AK) || !activeOwner() {
		return "", denied
	}
	return cfg.AK, nil
}
