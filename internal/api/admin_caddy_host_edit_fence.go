package api

import (
	"errors"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// The Host DB reservation is sticky until an independently audited recovery
// flow is implemented. All administrator Caddy changes must fail closed while
// it exists. This read must occur INSIDE the same transaction that holds the
// appropriate desired/credential row lock. It grants no Host Apply capability.
func rejectCaddyHostPendingMutationTx(tx *gorm.DB) error {
	var pending meta.AdminCaddyHostApplyReservation
	err := tx.Clauses(clause.Locking{Strength: "SHARE"}).Select("name").
		Where("name = ?", caddyHostDBReservationName).Take(&pending).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	return errCaddyHostDBReservationBlocked
}

// Acquire the shared cross-replica serialization point BEFORE touching any
// AliDNS row. A LAN-only instance may not have an AliDNS row yet; locking the
// saved HTTPS row first prevents a simultaneous reservation from observing
// an absent credential and accepting a stale Host Plan. The private DB
// reservation takes the same desired -> credentials -> pending order.
func lockCaddyDesiredBeforeAliDNSMutationTx(tx *gorm.DB) error {
	var desired meta.AdminCaddyHTTPSSetting
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("name = ?", caddyHTTPSSettingName).Take(&desired).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	return err
}

// Report only the existence of a durable Host reservation. Never return its
// signed intent fingerprints, operator identity, plans or candidate digests.
// Missing tables or DB errors MUST fail closed instead of showing an editable UI.
func readCaddyHostPendingUnappliedDB(db *gorm.DB) (bool, error) {
	var pending meta.AdminCaddyHostApplyReservation
	err := db.Select("name").Where("name = ?", caddyHostDBReservationName).Take(&pending).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	return err == nil, err
}
