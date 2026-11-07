package photoasset

import "gorm.io/gorm"

// InstallContentIdentitySchema removes only the old locator-as-identity
// constraints. Original Node/File/CAS and their deletion policy are untouched.
// Existing rows acquire content keys through the transactional reconciler.
func InstallContentIdentitySchema(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		for _, statement := range []string{
			`ALTER TABLE xd_photo_assets DROP CONSTRAINT IF EXISTS fk_xd_photo_assets_primary_node`,
			`DROP INDEX IF EXISTS idx_xd_photo_assets_owner_primary`,
			`CREATE OR REPLACE FUNCTION xd_photo_content_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
			BEGIN
			 IF OLD.content_key <> '' AND (NEW.content_key <> OLD.content_key OR NEW.owner_id <> OLD.owner_id OR NEW.content_manifest <> OLD.content_manifest) THEN
			  RAISE EXCEPTION 'photo content identity is immutable';
			 END IF;
			 IF NEW.content_key <> '' AND NEW.evidence_key <> NEW.content_key THEN
			  RAISE EXCEPTION 'photo content identity cannot be rewritten by a legacy locator writer';
			 END IF;
			 RETURN NEW;
			END $$`,
			`DROP TRIGGER IF EXISTS xd_photo_content_identity_immutable ON xd_photo_assets`,
			`CREATE TRIGGER xd_photo_content_identity_immutable BEFORE UPDATE ON xd_photo_assets FOR EACH ROW EXECUTE FUNCTION xd_photo_content_identity_immutable()`,
		} {
			if err := tx.Exec(statement).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
