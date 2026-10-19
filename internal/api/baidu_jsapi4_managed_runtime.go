package api

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/version"
	"gorm.io/gorm"
)

// The signing identity and Cookie key are auto-generated exactly once by
// EnsureBaiduJSAPI4InternalKeys. Read them from the protected database with
// a repeatable snapshot, validate the independent public-key fingerprint,
// and clear decrypted bytes after each private use. No AK is read here.
func (s *Server) loadBaiduJSAPI4ManagedMaterials(ctx context.Context) (ed25519.PrivateKey, []byte, uint64, error) {
	denied := errBaiduJSAPIResourceDenied
	if s == nil || s.DB == nil || s.ConnectorSecrets == nil || ctx == nil || ctx.Err() != nil {
		return nil, nil, 0, denied
	}
	readCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	var anchor meta.InternalServiceKeyAnchor
	var rows []meta.AdminServiceSecret
	err := s.DB.WithContext(readCtx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("name = ?", managedJSAPI4AnchorName).Take(&anchor).Error; err != nil {
			return err
		}
		return tx.Where("name IN ?", []string{managedJSAPI4SignName, managedJSAPI4CookieName}).Find(&rows).Error
	}, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil || anchor.Revision == 0 || len(anchor.Fingerprint) != sha256.Size || len(rows) != 2 {
		return nil, nil, 0, denied
	}
	found := make(map[string]meta.AdminServiceSecret, 2)
	for _, row := range rows {
		if !row.Enabled || row.KeyVersion == 0 || row.Revision == 0 || len(row.Ciphertext) == 0 {
			return nil, nil, 0, denied
		}
		found[row.Name] = row
	}
	sign, okSign := found[managedJSAPI4SignName]
	cookieRecord, okCookie := found[managedJSAPI4CookieName]
	if !okSign || !okCookie {
		return nil, nil, 0, denied
	}
	private, err := s.ConnectorSecrets.Open(managedJSAPI4SignAADID, managedJSAPI4SignKind,
		sign.KeyVersion, sign.Ciphertext)
	if err != nil || len(private) != ed25519.PrivateKeySize {
		clear(private)
		return nil, nil, 0, denied
	}
	derived := ed25519.NewKeyFromSeed(private[:ed25519.SeedSize])
	defer clear(derived)
	fingerprint := sha256.Sum256(private[ed25519.SeedSize:])
	if subtle.ConstantTimeCompare(private, derived) != 1 ||
		subtle.ConstantTimeCompare(fingerprint[:], anchor.Fingerprint) != 1 {
		clear(private)
		return nil, nil, 0, denied
	}
	cookie, err := s.ConnectorSecrets.Open(managedJSAPI4CookieAADID, managedJSAPI4CookieKind,
		cookieRecord.KeyVersion, cookieRecord.Ciphertext)
	var zero [32]byte
	if err != nil || len(cookie) != 32 || subtle.ConstantTimeCompare(cookie, zero[:]) == 1 {
		clear(private)
		clear(cookie)
		return nil, nil, 0, denied
	}
	return ed25519.PrivateKey(private), cookie, anchor.Revision, nil
}

// Admin release-readiness now reports the actual auto-managed identity,
// rather than demanding a nonexistent, hand-configured second public key.
func (s *Server) baiduJSAPI4ManagedSignerReady() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	private, cookie, _, err := s.loadBaiduJSAPI4ManagedMaterials(ctx)
	clear(private)
	clear(cookie)
	return err == nil
}

// Only the current Server build, compiled reviewed policy, trusted HTTPS
// origin, saved Browser AK revision and durable release epoch can form scope.
// No HTTP/Renderer parameters, synthetic licence flags or client GPS enter.
func (s *Server) currentBaiduJSAPI4ManagedScope(ctx context.Context, epoch uint64) (baidumapjsapi.JSAPI4ReleaseScope, error) {
	var zero baidumapjsapi.JSAPI4ReleaseScope
	if s == nil || ctx == nil || ctx.Err() != nil || epoch == 0 {
		return zero, errBaiduJSAPIResourceDenied
	}
	policy, complete := baidumapjsapi.JSAPI4ApprovedPolicySHA256()
	if !complete {
		return zero, errBaiduJSAPIResourceDenied
	}
	if _, err := baidumapjsapi.TrustedProxyBase(s.AllowedOrigin); err != nil {
		return zero, errBaiduJSAPIResourceDenied
	}
	build := strings.TrimSpace(version.Commit)
	if len(build) != 40 && len(build) != 64 {
		return zero, errBaiduJSAPIResourceDenied
	}
	if _, err := hex.DecodeString(build); err != nil {
		return zero, errBaiduJSAPIResourceDenied
	}
	cfg, err := s.baiduJSAPIDesired(ctx)
	if err != nil || !cfg.DesiredEnabled || !cfg.Configured || cfg.Revision == 0 {
		return zero, errBaiduJSAPIResourceDenied
	}
	return baidumapjsapi.JSAPI4ReleaseScope{
		ServerBuildSHA256:    sha256.Sum256([]byte(build)),
		ResourcePolicySHA256: policy,
		TrustedOriginSHA256:  sha256.Sum256([]byte(s.AllowedOrigin)),
		BrowserAKRevision:    cfg.Revision,
		ReleaseEpoch:         epoch,
	}, nil
}

func (s *Server) verifyBaiduJSAPI4ManagedRelease(ctx context.Context,
	proof baidumapjsapi.JSAPI4ReleaseAttestation,
	expected baidumapjsapi.JSAPI4ReleaseScope, cookieKey []byte) error {
	if !baidumapjsapi.JSAPI4ChildInventoryComplete() {
		return errBaiduJSAPIResourceDenied
	}
	private, actualCookie, epoch, err := s.loadBaiduJSAPI4ManagedMaterials(ctx)
	if err != nil {
		return errBaiduJSAPIResourceDenied
	}
	defer clear(private)
	defer clear(actualCookie)
	if len(cookieKey) != 32 || subtle.ConstantTimeCompare(cookieKey, actualCookie) != 1 {
		return errBaiduJSAPIResourceDenied
	}
	current, err := s.currentBaiduJSAPI4ManagedScope(ctx, epoch)
	if err != nil || current != expected {
		return errBaiduJSAPIResourceDenied
	}
	if baidumapjsapi.VerifyManagedJSAPI4ProductionRelease(
		proof, expected, ed25519.PublicKey(private[ed25519.SeedSize:]), time.Now().UTC()) != nil {
		return errBaiduJSAPIResourceDenied
	}
	return nil
}

// A protected Server-side renewal signs and installs only a COMPLETE,
// source-reviewed Baidu child policy. This is never "approve all" and does
// not fetch provider JS or expose an operator signing key via Admin API.
func (s *Server) RefreshBaiduJSAPI4ManagedRelease(ctx context.Context) error {
	if s == nil || ctx == nil || ctx.Err() != nil {
		return errBaiduJSAPIResourceDenied
	}
	if !baidumapjsapi.JSAPI4ChildInventoryComplete() {
		s.ClearBaiduJSAPI4OperatorRelease()
		return errBaiduJSAPIResourceDenied
	}
	private, cookie, epoch, err := s.loadBaiduJSAPI4ManagedMaterials(ctx)
	if err != nil {
		s.ClearBaiduJSAPI4OperatorRelease()
		return errBaiduJSAPIResourceDenied
	}
	defer clear(private)
	defer clear(cookie)
	scope, err := s.currentBaiduJSAPI4ManagedScope(ctx, epoch)
	if err != nil {
		s.ClearBaiduJSAPI4OperatorRelease()
		return errBaiduJSAPIResourceDenied
	}
	proof, err := baidumapjsapi.SignManagedJSAPI4Release(private, scope, time.Now().UTC())
	if err != nil || s.InstallBaiduJSAPI4OperatorRelease(ctx, cookie, proof, scope) != nil {
		s.ClearBaiduJSAPI4OperatorRelease()
		return errBaiduJSAPIResourceDenied
	}
	return nil
}

// Renewal reuses the same authority pointer for unchanged origin, policy
// and AK revision so map navigation does not flicker every minute.
func (s *Server) StartBaiduJSAPI4ManagedRelease(ctx context.Context) {
	if s == nil || ctx == nil || ctx.Err() != nil {
		return
	}
	_ = s.RefreshBaiduJSAPI4ManagedRelease(ctx)
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		defer s.ClearBaiduJSAPI4OperatorRelease()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_ = s.RefreshBaiduJSAPI4ManagedRelease(ctx)
			}
		}
	}()
}
