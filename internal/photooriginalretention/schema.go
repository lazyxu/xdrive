package photooriginalretention

import "gorm.io/gorm"

// InstallSchema runs only after AutoMigrate has created the two hold tables.
// The holds are immutable: no ordinary API may shorten the promise after an
// iPhone original is deleted, including trash cleanup or a CAS GC race.
// Each trigger uses indexed hold/ancestor lookups and fails closed even for a
// future direct SQL writer bypassing the ordinary managed-Source guard.
func InstallSchema(db *gorm.DB) error {
    statements := []string{
`CREATE OR REPLACE FUNCTION xd_ios_photo_hold_guard_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE protected_node boolean;
BEGIN
    IF TG_TABLE_NAME = 'xd_ios_photo_original_holds'
       OR TG_TABLE_NAME = 'xd_ios_photo_original_hold_ancestors' THEN
        RAISE EXCEPTION 'immutable iOS original retention promise'
            USING ERRCODE = '23514';
    END IF;

    IF TG_TABLE_NAME = 'xd_nodes' THEN
        SELECT EXISTS (SELECT 1 FROM xd_ios_photo_original_hold_ancestors a
                       WHERE a.node_id = OLD.id) INTO protected_node;
        IF protected_node THEN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'retained iOS original ancestor cannot be deleted'
                    USING ERRCODE = '23514';
            END IF;
            IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
               OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
               OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
               OR NEW.type IS DISTINCT FROM OLD.type
               OR NEW.name IS DISTINCT FROM OLD.name
               OR (EXISTS (SELECT 1 FROM xd_ios_photo_original_holds h
                           WHERE h.node_id = OLD.id)
                   AND NEW.revision IS DISTINCT FROM OLD.revision) THEN
                RAISE EXCEPTION 'retained iOS original ancestry is immutable'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'xd_files' OR TG_TABLE_NAME = 'xd_file_versions' THEN
        IF EXISTS (SELECT 1 FROM xd_ios_photo_original_holds h
                   WHERE h.node_id = OLD.node_id) THEN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'retained iOS original file cannot be deleted'
                    USING ERRCODE = '23514';
            END IF;
            IF NEW.node_id IS DISTINCT FROM OLD.node_id
               OR NEW.sha256 IS DISTINCT FROM OLD.sha256
               OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
               OR NEW.size IS DISTINCT FROM OLD.size THEN
                RAISE EXCEPTION 'retained iOS original file cannot be replaced'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'xd_content_blobs' THEN
        IF EXISTS (SELECT 1 FROM xd_ios_photo_original_holds h
                   WHERE h.sha256 = OLD.sha256) THEN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'retained iOS original CAS cannot be deleted'
                    USING ERRCODE = '23514';
            END IF;
            IF NEW.sha256 IS DISTINCT FROM OLD.sha256
               OR NEW.size IS DISTINCT FROM OLD.size
               OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
               OR NEW.state IS DISTINCT FROM 'ready'
               OR NEW.ref_count < 1 THEN
                RAISE EXCEPTION 'retained iOS original CAS must remain ready'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'xd_sources' THEN
        IF EXISTS (SELECT 1 FROM xd_ios_photo_original_holds h
                   WHERE h.source_id = OLD.id) THEN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'retained iOS original Source cannot be deleted'
                    USING ERRCODE = '23514';
            END IF;
            IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
               OR NEW.target_node_id IS DISTINCT FROM OLD.target_node_id
               OR NEW.device_id IS DISTINCT FROM OLD.device_id
               OR NEW.kind IS DISTINCT FROM OLD.kind
               OR NEW.direction IS DISTINCT FROM OLD.direction
               OR NEW.target_managed IS DISTINCT FROM OLD.target_managed
               OR NEW.sync_mode IS DISTINCT FROM OLD.sync_mode
               OR NEW.name IS DISTINCT FROM OLD.name
               OR NEW.status IS DISTINCT FROM OLD.status
               OR NEW.revision IS DISTINCT FROM OLD.revision THEN
                RAISE EXCEPTION 'retained iOS original Source binding immutable'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    RETURN OLD;
END;
$$`,
`DROP TRIGGER IF EXISTS xd_ios_photo_guard_nodes ON xd_nodes`,
`CREATE TRIGGER xd_ios_photo_guard_nodes BEFORE UPDATE OR DELETE ON xd_nodes
  FOR EACH ROW EXECUTE FUNCTION xd_ios_photo_hold_guard_v1()`,
`DROP TRIGGER IF EXISTS xd_ios_photo_guard_files ON xd_files`,
`CREATE TRIGGER xd_ios_photo_guard_files BEFORE UPDATE OR DELETE ON xd_files
  FOR EACH ROW EXECUTE FUNCTION xd_ios_photo_hold_guard_v1()`,
`DROP TRIGGER IF EXISTS xd_ios_photo_guard_file_versions ON xd_file_versions`,
`CREATE TRIGGER xd_ios_photo_guard_file_versions BEFORE UPDATE OR DELETE ON xd_file_versions
  FOR EACH ROW EXECUTE FUNCTION xd_ios_photo_hold_guard_v1()`,
`DROP TRIGGER IF EXISTS xd_ios_photo_guard_blobs ON xd_content_blobs`,
`CREATE TRIGGER xd_ios_photo_guard_blobs BEFORE UPDATE OR DELETE ON xd_content_blobs
  FOR EACH ROW EXECUTE FUNCTION xd_ios_photo_hold_guard_v1()`,
`DROP TRIGGER IF EXISTS xd_ios_photo_guard_sources ON xd_sources`,
`CREATE TRIGGER xd_ios_photo_guard_sources BEFORE UPDATE OR DELETE ON xd_sources
  FOR EACH ROW EXECUTE FUNCTION xd_ios_photo_hold_guard_v1()`,
`DROP TRIGGER IF EXISTS xd_ios_photo_guard_holds ON xd_ios_photo_original_holds`,
`CREATE TRIGGER xd_ios_photo_guard_holds BEFORE UPDATE OR DELETE ON xd_ios_photo_original_holds
  FOR EACH ROW EXECUTE FUNCTION xd_ios_photo_hold_guard_v1()`,
`DROP TRIGGER IF EXISTS xd_ios_photo_guard_ancestors ON xd_ios_photo_original_hold_ancestors`,
`CREATE TRIGGER xd_ios_photo_guard_ancestors BEFORE UPDATE OR DELETE ON xd_ios_photo_original_hold_ancestors
  FOR EACH ROW EXECUTE FUNCTION xd_ios_photo_hold_guard_v1()`,
    }
    return db.Transaction(func(tx *gorm.DB) error {
        for _, stmt := range statements {
            if err := tx.Exec(stmt).Error; err != nil {
                return err
            }
        }
        return nil
    })
}
