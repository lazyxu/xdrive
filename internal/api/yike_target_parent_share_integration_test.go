package api

import (
	"context"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func TestYikeCredentialRebindPruneKeepsDirectlySharedLegacyParents(t *testing.T) {
	for _, kind := range []string{"connector", "legacy-root"} {
		t.Run(kind, func(t *testing.T) {
			db, _, owner, _, ownerRoot := setupFilePropertiesTestDB(t)
			if err := db.AutoMigrate(&meta.Share{}); err != nil {
				t.Fatal(err)
			}
			legacy := createFilePropertiesDir(t, db, owner.ID, ownerRoot.ID, yikeLegacyTargetRootName)
			connector := createFilePropertiesDir(t, db, owner.ID, legacy.ID, yikeTargetConnectorName)

			sharedID := connector.ID
			if kind == "legacy-root" {
				sharedID = legacy.ID
			}
			directShare := meta.Share{
				OwnerID: owner.ID, NodeID: sharedID,
				TokenHash: strings.Repeat("a", 64), Access: "read_only",
			}
			if err := db.Create(&directShare).Error; err != nil {
				t.Fatal(err)
			}

			if err := db.Transaction(func(tx *gorm.DB) error {
				return pruneLegacyYikeParentsTx(context.Background(), tx, owner.ID, connector.ID)
			}); err != nil {
				t.Fatal(err)
			}
			var savedShare meta.Share
			var savedConnector, savedLegacy meta.Node
			for _, err := range []error{
				db.First(&savedShare, directShare.ID).Error,
				db.First(&savedConnector, connector.ID).Error,
				db.First(&savedLegacy, legacy.ID).Error,
			} {
				if err != nil {
					t.Fatal(err)
				}
			}
			if savedShare.NodeID != sharedID ||
				savedShare.TokenHash != directShare.TokenHash ||
				savedShare.RevokedAt != nil || savedLegacy.DeletedAt != nil {
				t.Fatalf("legacy parent Share was invalidated: share=%+v parent=%+v", savedShare, savedLegacy)
			}
			if kind == "connector" && savedConnector.DeletedAt != nil {
				t.Fatalf("shared connector was pruned: %+v", savedConnector)
			}
		})
	}
}
