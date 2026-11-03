package api

import (
 "context"
 "errors"
 "fmt"
 "strings"
 "time"

 "github.com/lazyxu/xdrive/internal/meta"
 "gorm.io/gorm"
 "gorm.io/gorm/clause"
)

var errManagedMigrationBlocked = errors.New("managed Source requires migration review")

type managedMigrationNode struct {
 ID uint64
 ParentID *uint64
 Name string
 Type string
 Revision uint64
 Depth int
 Cycle bool
}

func loadManagedMigrationTree(tx *gorm.DB, uid, rootID uint64) (map[uint64]managedMigrationNode, map[uint64][]uint64, error) {
 var rows []managedMigrationNode
 err := tx.Raw(
  "WITH RECURSIVE tree AS ("+
  " SELECT id,parent_id,name,type,revision,ARRAY[id]::bigint[] AS seen, false AS cycle,0 AS depth"+
  " FROM xd_nodes WHERE id = ? AND owner_id = ? AND deleted_at IS NULL"+
  " UNION ALL SELECT n.id,n.parent_id,n.name,n.type,n.revision,tree.seen || n.id,"+
  " n.id = ANY(tree.seen),tree.depth+1 FROM xd_nodes n JOIN tree ON n.parent_id=tree.id"+
  " WHERE n.owner_id=? AND n.deleted_at IS NULL AND tree.depth<255 AND NOT tree.cycle"+
  ") SELECT id,parent_id,name,type,revision,cycle,depth FROM tree",
  rootID, uid, uid,
 ).Scan(&rows).Error
 if err != nil { return nil,nil,err }
 if len(rows)==0 || len(rows)>250000 { return nil,nil,errManagedMigrationBlocked }
 nodes:=make(map[uint64]managedMigrationNode,len(rows))
 children:=make(map[uint64][]uint64)
 for _,n:=range rows {
  if n.Cycle || n.Depth>=255 || n.Revision==0 || n.Name=="" { return nil,nil,errManagedMigrationBlocked }
  if _,dup:=nodes[n.ID];dup { return nil,nil,errManagedMigrationBlocked }
  nodes[n.ID]=n
  if n.ParentID!=nil { children[*n.ParentID]=append(children[*n.ParentID],n.ID) }
 }
 return nodes,children,nil
}

func managedMigrationRelativePath(nodes map[uint64]managedMigrationNode, nodeID, rootID uint64) (string,error) {
 if nodeID==rootID { return "",nil }
 names:=[]string{}
 for depth:=0;depth<255;depth++ {
  n,ok:=nodes[nodeID]
  if !ok || n.ParentID==nil { return "",errManagedMigrationBlocked }
  names=append(names,n.Name)
  if *n.ParentID==rootID {
   for i,j:=0,len(names)-1;i<j;i,j=i+1,j-1 { names[i],names[j]=names[j],names[i] }
   return strings.Join(names,"/"),nil
  }
  nodeID=*n.ParentID
 }
 return "",errManagedMigrationBlocked
}

func managedMigrationOwnership(tx *gorm.DB, source meta.Source, nodes map[uint64]managedMigrationNode, rootID uint64) (map[uint64]bool,int,error) {
 var items []meta.SourceItem
 if err:=tx.Where("source_id=?",source.ID).Find(&items).Error;err!=nil { return nil,0,err }
 owned:=map[uint64]bool{rootID:true}
 claimed:=map[uint64]bool{}
 for _,item:=range items {
  if item.NodeID==nil { continue }
  id:=*item.NodeID
  n,found:=nodes[id]
  if !found {
   if item.State==meta.SourceItemStateSynced { return nil,0,errManagedMigrationBlocked }
   continue
  }
  expectedType:=meta.NodeTypeFile
  if item.Kind==meta.SourceItemKindDirectory { expectedType=meta.NodeTypeDir }
  if claimed[id] || item.NodeRevision==0 || n.Revision!=item.NodeRevision || n.Type!=expectedType {
   return nil,0,errManagedMigrationBlocked
  }
  actual,err:=managedMigrationRelativePath(nodes,id,rootID)
  if err!=nil || actual!=item.Path { return nil,0,errManagedMigrationBlocked }
  claimed[id]=true
  for cursor,depth:=id,0;cursor!=rootID;depth++ {
   if depth>=255 { return nil,0,errManagedMigrationBlocked }
   owned[cursor]=true
   parent:=nodes[cursor].ParentID
   if parent==nil { return nil,0,errManagedMigrationBlocked }
   cursor=*parent
  }
 }
 return owned,len(claimed),nil
}

func blockedMigrationWork(tx *gorm.DB, source meta.Source, nodes map[uint64]managedMigrationNode) (bool,error) {
 var total int64
 if err:=tx.Model(&meta.SyncRun{}).Where("source_id=? AND status=?",source.ID,meta.SyncRunStatusRunning).Count(&total).Error;err!=nil {return false,err}
 if total!=0 {return true,nil}
 var uploads []meta.UploadSession
 if err:=tx.Select("parent_id","node_id").Where(
  "owner_id=? AND status=? AND expires_at>?",source.OwnerID,meta.UploadStatusActive,time.Now().UTC(),
 ).Find(&uploads).Error;err!=nil {return false,err}
 for _,u:=range uploads {
  if u.NodeID!=nil { if _,ok:=nodes[*u.NodeID];ok {return true,nil} }
  if u.ParentID!=nil { if _,ok:=nodes[*u.ParentID];ok {return true,nil} }
 }
 return false,nil
}

func migrateManagedSourceTx(ctx context.Context,tx *gorm.DB,source meta.Source) error {
 if source.Status==meta.SourceStatusArchived || source.Kind==yikeSourceKind || source.TargetNodeID==nil {return nil}
 if source.ID==0 || source.OwnerID==0 || *source.TargetNodeID==0 {return errManagedMigrationBlocked}
 rootID:=*source.TargetNodeID
 var root meta.Node
 if err:=tx.Clauses(clause.Locking{Strength:"UPDATE"}).Where(
  "id=? AND owner_id=? AND type=? AND deleted_at IS NULL",rootID,source.OwnerID,meta.NodeTypeDir,
 ).First(&root).Error;err!=nil || root.ParentID==nil {return errManagedMigrationBlocked}
 var device *meta.ClientDevice
 if source.Kind==meta.SourceKindLocalFolder && source.Direction==meta.SourceDirectionPush {
  var binding meta.LocalSourceBinding
  if err:=tx.Where("source_id=? AND owner_id=?",source.ID,source.OwnerID).Take(&binding).Error;err!=nil {
   if source.Status==meta.SourceStatusPaused && errors.Is(err,gorm.ErrRecordNotFound) {return nil}
   return errManagedMigrationBlocked
  }
  var bound meta.ClientDevice
  if err:=tx.Where("id=? AND owner_id=?",binding.DeviceID,source.OwnerID).Take(&bound).Error;err!=nil {return errManagedMigrationBlocked}
  device=&bound
 }
 parent,err:=managedTargetParentTx(ctx,tx,source,device)
 if err!=nil {return errManagedMigrationBlocked}
 leaf:=managedTargetLeaf(source)
 already:=*root.ParentID==parent.ID && root.Name==leaf
 nodes,children,err:=loadManagedMigrationTree(tx,source.OwnerID,rootID)
 if err!=nil {return err}
 if _,nested:=nodes[parent.ID];nested {return errManagedMigrationBlocked}
 // Both nested and exact-overlap Source roots must be rejected. The Source
 // roots are authoritative IDs, not matching folder-name strings.
 ownerSource,found,err:=managedSourceForNodeTx(ctx,tx,source.OwnerID,rootID)
 if err!=nil || !found || ownerSource.ID!=source.ID {return errManagedMigrationBlocked}
 var others []meta.Source
 if err:=tx.Where("owner_id=? AND id<>? AND status<>? AND target_node_id IS NOT NULL",
  source.OwnerID,source.ID,meta.SourceStatusArchived).Find(&others).Error;err!=nil {return err}
 for _,other:=range others {
  if other.TargetNodeID!=nil {if _,nested:=nodes[*other.TargetNodeID];nested {return errManagedMigrationBlocked}}
 }
 busy,err:=blockedMigrationWork(tx,source,nodes)
 if err!=nil {return err }
 if busy {return errManagedMigrationBlocked}
 owned,claims,err:=managedMigrationOwnership(tx,source,nodes,rootID)
 if err!=nil {return err}
 var ordinary []uint64
 for id,childrenIDs:=range children {
  if !owned[id] {continue}
  for _,childID:=range childrenIDs {if !owned[childID] {ordinary=append(ordinary,childID)}}
 }
 if already {
  if len(ordinary)!=0 && claims!=0 {return errManagedMigrationBlocked}
  return nil
 }
 var conflict meta.Node
 err=tx.Where("owner_id=? AND parent_id=? AND lower(name)=lower(?) AND deleted_at IS NULL",
  source.OwnerID,parent.ID,leaf).Take(&conflict).Error
 if err==nil && conflict.ID!=root.ID {return errManagedMigrationBlocked}
 if err!=nil && !errors.Is(err,gorm.ErrRecordNotFound) {return err}
 oldParent,oldName:=*root.ParentID,root.Name
 now:=time.Now().UTC()
 if claims==0 {
  // No Source-owned item can be verified. Keep ALL existing Nodes at their
  // original path; bind a brand-new empty managed target instead.
  fresh:=meta.Node{OwnerID:source.OwnerID,ParentID:&parent.ID,Name:leaf,Type:meta.NodeTypeDir,Revision:1}
  if err:=tx.Create(&fresh).Error;err!=nil {return err}
  changed:=tx.Model(&meta.Source{}).Where("id=? AND owner_id=? AND revision=? AND target_node_id=?",
   source.ID,source.OwnerID,source.Revision,rootID).
   Updates(map[string]any{"target_node_id":fresh.ID,"revision":gorm.Expr("revision + 1"),"updated_at":now})
  if changed.Error!=nil {return changed.Error}
  if changed.RowsAffected!=1 {return errManagedMigrationBlocked}
  return nil
 }
 changed:=tx.Model(&meta.Node{}).Where("id=? AND owner_id=? AND revision=? AND deleted_at IS NULL",
  rootID,source.OwnerID,root.Revision).
  Updates(map[string]any{"parent_id":parent.ID,"name":leaf,"revision":gorm.Expr("revision + 1"),"updated_at":now})
 if changed.Error!=nil {return changed.Error}
 if changed.RowsAffected!=1 {return errManagedMigrationBlocked}
 if len(ordinary)!=0 {
  shadow:=meta.Node{OwnerID:source.OwnerID,ParentID:&oldParent,Name:oldName,Type:meta.NodeTypeDir,Revision:1}
  if err:=tx.Create(&shadow).Error;err!=nil {return err}
  mapped:=map[uint64]uint64{rootID:shadow.ID}
  var ensure func(uint64)(uint64,error)
  ensure=func(id uint64)(uint64,error){
   if known,ok:=mapped[id];ok {return known,nil}
   n,ok:=nodes[id]
   if !ok || n.ParentID==nil || !owned[id] || n.Type!=meta.NodeTypeDir {return 0,errManagedMigrationBlocked}
   dest,err:=ensure(*n.ParentID)
   if err!=nil {return 0,err}
   clone:=meta.Node{OwnerID:source.OwnerID,ParentID:&dest,Name:n.Name,Type:meta.NodeTypeDir,Revision:1}
   if err:=tx.Create(&clone).Error;err!=nil {return 0,err}
   mapped[id]=clone.ID
   return clone.ID,nil
  }
  for _,id:=range ordinary {
   n:=nodes[id]
   if n.ParentID==nil {return errManagedMigrationBlocked}
   dest,err:=ensure(*n.ParentID)
   if err!=nil {return err}
   updated:=tx.Model(&meta.Node{}).Where("id=? AND owner_id=? AND revision=? AND deleted_at IS NULL",id,source.OwnerID,n.Revision).
    Updates(map[string]any{"parent_id":dest,"revision":gorm.Expr("revision + 1"),"updated_at":now})
   if updated.Error!=nil {return updated.Error}
   if updated.RowsAffected!=1 {return errManagedMigrationBlocked}
  }
 }
 // Source identity and entire managed subtree survive unchanged. Historical
 // Run.TargetNodeID and SourceItem.Path remain exact provenance records.
 bump:=tx.Model(&meta.Source{}).Where("id=? AND owner_id=? AND revision=?",source.ID,source.OwnerID,source.Revision).
  Updates(map[string]any{"revision":gorm.Expr("revision + 1"),"updated_at":now})
 if bump.Error!=nil {return bump.Error}
 if bump.RowsAffected!=1 {return errManagedMigrationBlocked}
 return ctx.Err()
}

// ReconcileManagedSourceTargets is invoked before serving HTTP and starting
// Worker schedules. Every Source uses its own all-or-nothing transaction.
// Ambiguous Source roots are paused; other Sources are not modified.
func (s *Server) ReconcileManagedSourceTargets(ctx context.Context) error {
 if s==nil || s.DB==nil {return errManagedTargetUnavailable}
 var ids []uint64
 if err:=s.DB.WithContext(ctx).Model(&meta.Source{}).Where(
  "status<>? AND kind<>? AND target_node_id IS NOT NULL",meta.SourceStatusArchived,yikeSourceKind,
 ).Order("id ASC").Pluck("id",&ids).Error;err!=nil {return err}
 for _,id:=range ids {
  err:=s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB)error{
   var source meta.Source
   if err:=tx.Clauses(clause.Locking{Strength:"UPDATE"}).Where("id=?",id).Take(&source).Error;err!=nil {return err}
   return migrateManagedSourceTx(ctx,tx,source)
  })
  if err==nil {continue}
  // Keep the old Node, CAS, SourceItem and Run history intact. No single
  // migration failure is grounds for deleting or replacing user bytes.
  pauseErr:=s.DB.WithContext(ctx).Model(&meta.Source{}).
   Where("id=? AND status<>?",id,meta.SourceStatusArchived).
   Updates(map[string]any{
    "status":meta.SourceStatusPaused,"run_requested_at":nil,
    "last_error":"同步目标迁移需要核对来源归属、版本或运行状态；旧文件未被删除或覆盖",
    "revision":gorm.Expr("revision + 1"),"updated_at":time.Now().UTC(),
   }).Error
  if pauseErr!=nil {return fmt.Errorf("pause failed Source %d: %w",id,pauseErr)}
 }
 return nil
}
