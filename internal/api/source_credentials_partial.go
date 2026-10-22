package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/synology"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errDSMFieldPatchConflict = errors.New("stored DSM credential changed")

// Merge a partial DSM patch only on the owning Go Server. Plaintext from
// storage is never sent back to the browser as part of a save response.
// The snapshot must be checked under a row lock again during the write.
func (s *Server) mergedDSMFields(ctx context.Context, source meta.Source, input []byte) ([]byte, *meta.SourceCredential, error) {
	if source.Kind != synologySourceKind && source.Kind != synologyFilesSourceKind {
		return input, nil, nil
	}
	var draft synology.Credential
	if err := json.Unmarshal(input, &draft); err != nil {
		return nil, nil, err
	}
	if draft.BaseURL != "" && draft.Username != "" && draft.Password != "" {
		return input, nil, nil
	}
	if draft.BaseURL == "" && draft.Username == "" && draft.Password == "" {
		return nil, nil, errInvalidSourceCredentialTest
	}
	var stored meta.SourceCredential
	if err := s.DB.WithContext(ctx).Where("source_id = ?", source.ID).Take(&stored).Error; err != nil {
		return nil, nil, errDSMFieldPatchConflict
	}
	original, err := s.ConnectorSecrets.Open(source.ID, source.Kind, stored.KeyVersion, stored.Ciphertext)
	if err != nil {
		return nil, nil, err
	}
	var previous synology.Credential
	err = json.Unmarshal(original, &previous)
	clear(original)
	if err != nil || previous.BaseURL == "" || previous.Username == "" || previous.Password == "" {
		return nil, nil, errDSMFieldPatchConflict
	}
	if draft.BaseURL == "" {
		draft.BaseURL = previous.BaseURL
	}
	if draft.Username == "" {
		draft.Username = previous.Username
	}
	if draft.Password == "" {
		draft.Password = previous.Password
	}
	result, err := json.Marshal(draft)
	if err != nil {
		return nil, nil, err
	}
	return result, &stored, nil
}

// Optimistic check closes the gap between remote connection validation and
// the PostgreSQL credential write. Concurrent credential replacement must
// return 409 rather than clobbering the fresh ciphertext.
func lockDSMFieldPatchSnapshot(tx *gorm.DB, sourceID uint64, old *meta.SourceCredential) error {
	if old == nil {
		return nil
	}
	var current meta.SourceCredential
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("source_id = ?", sourceID).Take(&current).Error; err != nil {
		return errDSMFieldPatchConflict
	}
	if current.KeyVersion != old.KeyVersion || !bytes.Equal(current.Ciphertext, old.Ciphertext) {
		return errDSMFieldPatchConflict
	}
	return nil
}
