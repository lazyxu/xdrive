package api

import (
 "context"
 "errors"
 "fmt"
 "net/url"
 "os"
 "strings"
 "testing"
 "time"

 "github.com/google/uuid"
 "github.com/lazyxu/xdrive/internal/meta"
 "gorm.io/driver/postgres"
 "gorm.io/gorm"
)

func setupManagedMigrationDB(t *testing.T) *gorm.DB {
 t.Helper()
 dsn:=os.Getenv("XD_TEST_DATABASE_URL")
 if dsn=="" {t.Skip("XD_TEST_DATABASE_URL is not set")}
 base,err:=gorm.Open(postgres.Open(dsn),&gorm.Config{})
 if err!=nil {t.Fatal(err)}
 schema:="managed_source_"+strings.ReplaceAll(uuid.NewString(),"-","")
 if err:=base.Exec(fmt.Sprintf("CREATE SCHEMA %q",schema)).Error;err!=nil {t.Fatal(err)}
 t.Cleanup(func(){_ = base.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE",schema)).Error})
 uri,err:=url.Parse(dsn)
 if err!=nil {t.Fatal(err)}
 query:=uri.Query()
 query.Set("search_path",schema)
 uri.RawQuery=query.Encode()
 db,err:=gorm.Open(postgres.Open(uri.String()),&gorm.Config{})
 if err!=nil {t.Fatal(err)}
 for _,model:=range []any{&meta.User{},&meta.Node{},&meta.Source{},&meta.SourceItem{},&meta.ClientDevice{},&meta.LocalSourceBinding{},&meta.SyncRun{},&meta.UploadSession{}} {
  if err:=db.AutoMigrate(model);err!=nil {t.Fatal(err)}
 }
 if err:=db.Exec("CREATE UNIQUE INDEX idx_migrated_owner_root ON xd_nodes(owner_id) WHERE parent_id IS NULL").Error;err!=nil {t.Fatal(err)}
 if err:=db.Exec("CREATE UNIQUE INDEX idx_migrated_parent_name ON xd_nodes(owner_id,parent_id,lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL").Error;err!=nil {t.Fatal(err)}
 return db
}

func fixtureManagedRoot(t *testing.T,db *gorm.DB) (meta.Source,meta.Node,meta.Node) {
 t.Helper()
 user:=meta.User{Username:"managed-"+uuid.NewString(),PasswordHash:"test-only",Role:meta.UserRoleUser}
 if err:=db.Create(&user).Error;err!=nil {t.Fatal(err)}
 root:=meta.Node{OwnerID:user.ID,Name:"root",Type:meta.NodeTypeDir,Revision:1}
 if err:=db.Create(&root).Error;err!=nil {t.Fatal(err)}
 old:=meta.Node{OwnerID:user.ID,ParentID:&root.ID,Name:"Old source",Type:meta.NodeTypeDir,Revision:1}
 if err:=db.Create(&old).Error;err!=nil {t.Fatal(err)}
 source:=meta.Source{OwnerID:user.ID,Name:"NAS files",Kind:"synology_files",Direction:meta.SourceDirectionPull,
  SyncMode:meta.SourceSyncModeBackup,RunMode:meta.SourceRunModeSync,Status:meta.SourceStatusActive,
  TargetNodeID:&old.ID,Revision:1}
 if err:=db.Create(&source).Error;err!=nil {t.Fatal(err)}
 return source,root,old
}

func TestManagedSourceCreationHasStableExclusiveRoot(t *testing.T) {
 db:=setupManagedMigrationDB(t)
 source,_,_:=fixtureManagedRoot(t,db)
 clone:=source
 clone.ID=0
 clone.Name="another folder"
 clone.TargetNodeID=nil
 if err:=db.Create(&clone).Error;err!=nil {t.Fatal(err)}
 err:=db.Transaction(func(tx *gorm.DB)error{return createManagedSourceTargetTx(context.Background(),tx,&clone,nil)})
 if err!=nil {t.Fatal(err)}
 if clone.TargetNodeID==nil {t.Fatal("server did not create target")}
 var node meta.Node
 if err:=db.First(&node,*clone.TargetNodeID).Error;err!=nil {t.Fatal(err)}
 if node.Name!=managedTargetLeaf(clone) {t.Fatalf("leaf %q; expected %q",node.Name,managedTargetLeaf(clone))}
 if strings.Contains(node.Name,"/") {t.Fatalf("invalid path leaf %q",node.Name)}
 if managedTargetLeaf(clone)!=node.Name {t.Fatal("target leaf must be deterministic")}
 clone.Name="new display name"
 if node.Name==managedTargetLeaf(clone) {t.Fatal("renaming Source display label must not be confused with target Node rename")}
 if strings.Contains(node.Name,"new display name") {t.Fatal("target Node changed with display name")}
 _=source
}

func TestManagedSourceMigratesMixedTargetKeepingIDsAndOrdinaryVisible(t *testing.T) {
 db:=setupManagedMigrationDB(t)
 source,oldParent,oldRoot:=fixtureManagedRoot(t,db)
 managed:=meta.Node{OwnerID:source.OwnerID,ParentID:&oldRoot.ID,Name:"photo.jpg",Type:meta.NodeTypeFile,Revision:1}
 ordinary:=meta.Node{OwnerID:source.OwnerID,ParentID:&oldRoot.ID,Name:"unrelated.txt",Type:meta.NodeTypeFile,Revision:1}
 if err:=db.Create(&managed).Error;err!=nil {t.Fatal(err)}
 if err:=db.Create(&ordinary).Error;err!=nil {t.Fatal(err)}
 item:=meta.SourceItem{SourceID:source.ID,ExternalID:"remote:photo",NodeID:&managed.ID,NodeRevision:1,
  Kind:meta.SourceItemKindFile,Path:"photo.jpg",State:meta.SourceItemStateSynced,LastSeenAt:time.Now().UTC()}
 if err:=db.Create(&item).Error;err!=nil {t.Fatal(err)}
 srv:=Server{DB:db}
 if err:=srv.ReconcileManagedSourceTargets(context.Background());err!=nil {t.Fatal(err)}
 var moved,independent meta.Node
 if err:=db.First(&moved,oldRoot.ID).Error;err!=nil {t.Fatal(err)}
 if moved.ParentID==nil || *moved.ParentID==oldParent.ID || moved.Name!=managedTargetLeaf(source) {
  t.Fatalf("old source root not migrated with identity intact: %+v",moved)
 }
 if err:=db.First(&independent,ordinary.ID).Error;err!=nil {t.Fatal(err)}
 if independent.ParentID==nil || *independent.ParentID==oldRoot.ID {
  t.Fatalf("ordinary file was moved into Source managed root: %+v",independent)
 }
 var shadow meta.Node
 if err:=db.Where("parent_id=? AND name=?",oldParent.ID,"Old source").First(&shadow).Error;err!=nil {t.Fatal(err)}
 if *independent.ParentID!=shadow.ID {
  t.Fatalf("ordinary node no longer visible at legacy location: %+v, %+v",independent,shadow)
 }
 var storedItem meta.SourceItem
 if err:=db.First(&storedItem,item.ID).Error;err!=nil {t.Fatal(err)}
 if storedItem.NodeID==nil || *storedItem.NodeID!=managed.ID || storedItem.Path!="photo.jpg" {
  t.Fatalf("SourceItem was replaced instead of moved: %+v",storedItem)
 }
 var currentSource meta.Source
 if err:=db.First(&currentSource,source.ID).Error;err!=nil {t.Fatal(err)}
 if currentSource.TargetNodeID==nil || *currentSource.TargetNodeID!=oldRoot.ID || currentSource.Revision!=2 {
  t.Fatalf("Source identity changed: %+v",currentSource)
 }
 if err:=srv.ReconcileManagedSourceTargets(context.Background());err!=nil {t.Fatal(err)}
 var repeat meta.Source
 if err:=db.First(&repeat,source.ID).Error;err!=nil {t.Fatal(err)}
 if repeat.Revision!=2 || *repeat.TargetNodeID!=oldRoot.ID {t.Fatalf("migration not idempotent: %+v",repeat)}
}

func TestManagedSourceConflictPausesWithoutMovingOldRoot(t *testing.T) {
 db:=setupManagedMigrationDB(t)
 source,parent,root:=fixtureManagedRoot(t,db)
 second:=meta.Source{OwnerID:source.OwnerID,Name:"overlap",Kind:"synology_files",Direction:meta.SourceDirectionPull,
  SyncMode:meta.SourceSyncModeBackup,RunMode:meta.SourceRunModeSync,Status:meta.SourceStatusActive,
  TargetNodeID:&root.ID,Revision:1}
 if err:=db.Create(&second).Error;err!=nil {t.Fatal(err)}
 srv:=Server{DB:db}
 if err:=srv.ReconcileManagedSourceTargets(context.Background());err!=nil {t.Fatal(err)}
 var old meta.Node
 if err:=db.First(&old,root.ID).Error;err!=nil {t.Fatal(err)}
 if old.ParentID==nil || *old.ParentID!=parent.ID {t.Fatalf("ambiguous old target was moved: %+v",old)}
 var paused meta.Source
 if err:=db.First(&paused,source.ID).Error;err!=nil {t.Fatal(err)}
 if paused.Status!=meta.SourceStatusPaused || paused.LastError=="" {t.Fatalf("ambiguous source remains active: %+v",paused)}
}

func TestManagedSourceOrdinaryMutationDenied(t *testing.T) {
 db:=setupManagedMigrationDB(t)
 source,_,root:=fixtureManagedRoot(t,db)
 var user meta.User
 if err:=db.First(&user,source.OwnerID).Error;err!=nil {t.Fatal(err)}
 ctx,cancel:=context.WithTimeout(context.Background(),time.Second*10)
 defer cancel()
 if err:=db.Transaction(func(tx *gorm.DB)error {
  err:=managedSourceRejectDestinationTx(ctx,tx,nil,user.ID,root.ID)
  if !errors.Is(err,errManagedSourceMutation) {t.Fatalf("ordinary user write unexpectedly permitted: %v",err)}
  return nil
 });err!=nil {t.Fatal(err)}
}
