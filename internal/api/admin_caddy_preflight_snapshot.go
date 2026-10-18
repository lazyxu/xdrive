package api

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"errors"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// caddyPreflightSnapshot is a single local database observation of the
// administrator's saved HTTPS intent and encrypted AliDNS metadata. It does
// NOT describe a host-applied revision, an operator-authorized maintenance
// action, an authenticated ingress rescue path or a rollback receipt.
type caddyPreflightSnapshot struct {
	Desired          adminCaddyHTTPSDesired
	Credential       meta.AdminServiceSecret
	CredentialExists bool
}

func (s *Server) readCaddyPreflightSnapshot(ctx context.Context) (caddyPreflightSnapshot, error) {
	var result caddyPreflightSnapshot
	if s == nil || s.DB == nil {
		return result, errors.New("Caddy preflight database unavailable")
	}
	// READ COMMITTED gives each SELECT a distinct snapshot. Bind both
	// independently versioned settings to ONE repeatable-read snapshot,
	// with no table lock or write operation.
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var readErr error
		result.Desired, readErr = readCaddyHTTPSDesiredDB(tx)
		if readErr != nil {
			return readErr
		}
		result.Credential, result.CredentialExists, readErr = readCaddyAliDNSSettingDB(tx)
		return readErr
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return caddyPreflightSnapshot{}, err
	}
	return result, nil
}

// A successful re-read merely reduces stale cross-request observations.
// Configuration can change immediately afterward, so an actual future host
// apply MUST separately revalidate and CAS-fence both revisions at dispatch.
func sameCaddyPreflightSnapshot(first, last caddyPreflightSnapshot) bool {
	return first.Desired.Revision == last.Desired.Revision &&
		first.Desired.Enabled == last.Desired.Enabled &&
		first.Desired.Domain == last.Desired.Domain &&
		first.Desired.LANEnabled == last.Desired.LANEnabled &&
		first.Desired.LANIP == last.Desired.LANIP &&
		first.CredentialExists == last.CredentialExists &&
		first.Credential.Revision == last.Credential.Revision &&
		first.Credential.Enabled == last.Credential.Enabled &&
		first.Credential.KeyVersion == last.Credential.KeyVersion &&
		subtle.ConstantTimeCompare(first.Credential.Ciphertext, last.Credential.Ciphertext) == 1
}
