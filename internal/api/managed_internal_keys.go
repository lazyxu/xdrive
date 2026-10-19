package api

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// This is an INSTANCE-OWNED signing identity, not the independently audited
// JSAPI4 operator release trust root. Creating it must never authorize JSAPI,
// mint a map session, alter Browser/Server AK, or approve an upstream resource.
const (
	managedJSAPI4AnchorName            = "baidu-jsapi4-instance-v1"
	managedJSAPI4SignName              = "internal:baidu-jsapi4-sign-v1"
	managedJSAPI4CookieName            = "internal:baidu-jsapi4-cookie-v1"
	managedJSAPI4SignKind              = "xdrive-internal-jsapi4-ed25519-v1"
	managedJSAPI4CookieKind            = "xdrive-internal-jsapi4-cookie-v1"
	managedJSAPI4SignAADID      uint64 = 213101
	managedJSAPI4CookieAADID    uint64 = 213102
	managedJSAPI4LockNamespace  int32  = 2131
	managedJSAPI4LockIdentifier int32  = 20261019
)

var errManagedInternalKeysUnavailable = errors.New("internal service keys unavailable or require recovery")

// EnsureBaiduJSAPI4InternalKeys is the first phase of automatic internal-key
// management. It runs only on the trusted Server, with an existing protected
// ConnectorSecrets root and migrated PostgreSQL tables. A transaction-scoped
// advisory lock makes simultaneous replicas share ONE initial identity.
// A separate durable non-secret anchor prevents regeneration after partial
// or full secret-row loss. A wholly erased installation database still needs
// an independently preserved host/install anchor; that disaster-recovery gate
// remains a separate follow-up, not a claim this database alone can prove.
func (s *Server) EnsureBaiduJSAPI4InternalKeys(ctx context.Context) error {
	if s == nil || ctx == nil || ctx.Err() != nil || s.DB == nil || s.ConnectorSecrets == nil {
		return errManagedInternalKeysUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(
			"SELECT pg_advisory_xact_lock(?, ?)",
			managedJSAPI4LockNamespace, managedJSAPI4LockIdentifier,
		).Error; err != nil {
			return errManagedInternalKeysUnavailable
		}

		var anchor meta.InternalServiceKeyAnchor
		readErr := tx.Where("name = ?", managedJSAPI4AnchorName).Take(&anchor).Error
		if readErr != nil && !errors.Is(readErr, gorm.ErrRecordNotFound) {
			return errManagedInternalKeysUnavailable
		}

		var keys []meta.AdminServiceSecret
		if err := tx.Where("name IN ?", []string{
			managedJSAPI4SignName, managedJSAPI4CookieName,
		}).Find(&keys).Error; err != nil {
			return errManagedInternalKeysUnavailable
		}
		if errors.Is(readErr, gorm.ErrRecordNotFound) {
			if len(keys) != 0 {
				// Never silently replace an orphaned existing identity.
				return errManagedInternalKeysUnavailable
			}
			return s.createBaiduJSAPI4InternalKeysTx(tx)
		}
		if anchor.Revision == 0 || len(anchor.Fingerprint) != sha256.Size || len(keys) != 2 {
			return errManagedInternalKeysUnavailable
		}
		byName := make(map[string]meta.AdminServiceSecret, len(keys))
		for _, key := range keys {
			if !key.Enabled || key.KeyVersion == 0 || key.Revision == 0 ||
				len(key.Ciphertext) == 0 {
				return errManagedInternalKeysUnavailable
			}
			byName[key.Name] = key
		}
		sign, okSign := byName[managedJSAPI4SignName]
		cookie, okCookie := byName[managedJSAPI4CookieName]
		if !okSign || !okCookie {
			return errManagedInternalKeysUnavailable
		}
		private, err := s.ConnectorSecrets.Open(
			managedJSAPI4SignAADID, managedJSAPI4SignKind,
			sign.KeyVersion, sign.Ciphertext,
		)
		if err != nil {
			return errManagedInternalKeysUnavailable
		}
		defer clear(private)
		if len(private) != ed25519.PrivateKeySize {
			return errManagedInternalKeysUnavailable
		}
		derived := ed25519.NewKeyFromSeed(private[:ed25519.SeedSize])
		defer clear(derived)
		digest := sha256.Sum256(private[ed25519.SeedSize:])
		if subtle.ConstantTimeCompare(derived, private) != 1 ||
			subtle.ConstantTimeCompare(digest[:], anchor.Fingerprint) != 1 {
			return errManagedInternalKeysUnavailable
		}

		cookiePlain, err := s.ConnectorSecrets.Open(
			managedJSAPI4CookieAADID, managedJSAPI4CookieKind,
			cookie.KeyVersion, cookie.Ciphertext,
		)
		if err != nil {
			return errManagedInternalKeysUnavailable
		}
		defer clear(cookiePlain)
		var empty [32]byte
		if len(cookiePlain) != len(empty) ||
			subtle.ConstantTimeCompare(cookiePlain, empty[:]) == 1 {
			return errManagedInternalKeysUnavailable
		}
		return nil
	})
	if err != nil {
		return errManagedInternalKeysUnavailable
	}
	return nil
}

func (s *Server) createBaiduJSAPI4InternalKeysTx(tx *gorm.DB) error {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return errManagedInternalKeysUnavailable
	}
	defer clear(private)
	cookie := make([]byte, 32)
	defer clear(cookie)
	if _, err := rand.Read(cookie); err != nil {
		return errManagedInternalKeysUnavailable
	}
	for _, part := range []struct {
		name string
		kind string
		aad  uint64
		raw  []byte
	}{
		{managedJSAPI4SignName, managedJSAPI4SignKind, managedJSAPI4SignAADID, private},
		{managedJSAPI4CookieName, managedJSAPI4CookieKind, managedJSAPI4CookieAADID, cookie},
	} {
		version, ciphertext, err := s.ConnectorSecrets.Seal(part.aad, part.kind, part.raw)
		if err != nil {
			return errManagedInternalKeysUnavailable
		}
		row := meta.AdminServiceSecret{
			Name: part.name, Enabled: true, Revision: 1,
			KeyVersion: version, Ciphertext: ciphertext,
		}
		if err := tx.Create(&row).Error; err != nil {
			return errManagedInternalKeysUnavailable
		}
	}
	fingerprint := sha256.Sum256(public)
	anchor := meta.InternalServiceKeyAnchor{
		Name: managedJSAPI4AnchorName, Revision: 1,
		Fingerprint: append([]byte(nil), fingerprint[:]...),
	}
	if err := tx.Create(&anchor).Error; err != nil {
		return errManagedInternalKeysUnavailable
	}
	return nil
}
