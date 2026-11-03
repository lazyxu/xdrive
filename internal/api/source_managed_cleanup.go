package api

import (
 "context"
 "crypto/sha256"
 "encoding/hex"
 "errors"
 "fmt"
 "net/http"
 "sort"
 "strconv"
 "strings"
 "time"

 "github.com/gin-gonic/gin"
 "github.com/lazyxu/xdrive/internal/meta"
 "gorm.io/gorm"
 "gorm.io/gorm/clause"
)

// A Source's configuration can be archived without removing bytes. Only
// after archival does the Owner get the separate explicit cloud-only cleanup.
// The preview receipt is a deterministic snapshot of all affected Node IDs
// and revisions; any intervening mutation invalidates confirmation.
type sourceCleanupPreview struct {
 SourceID uint64 `json:"source_id"`
 TargetNodeID uint64 `json:"target_node_id"`
 SourceRevision uint64 `json:"source_revision"`
 FileCount int64 `json:"file_count"`
 DirectoryCount int64 `json:"directory_count"`
 LogicalBytes int64 `json:"logical_bytes"`
 Confirmation string `json:"confirmation"`
}

var errSourceCleanupUnsafe=errors.New("source cleanup requires an exact archived, exclusive target")

func sourceCleanupSnapshotTx(ctx context.Context,tx *gorm.DB,source meta.Source)(sourceCleanupPreview,[]uint64,error){
 empty:=sourceCleanupPreview{}
 if source.Status!=meta.SourceStatusArchived || source.TargetNodeID==nil || *source.TargetNodeID==0 {
  return empty,nil,errSourceCleanupUnsafe
 }
 rootID:=*source.TargetNodeID
 tree,_,err:=loadManagedMigrationTree(tx,source.OwnerID,rootID)
 if err!=nil {return empty,nil,err}
 busy,err:=blockedMigrationWork(tx,source,tree)
 if err!=nil {return empty,nil,err}
 if busy {return empty,nil,errSourceCleanupUnsafe}
 managed,_,err:=managedMigrationOwnership(tx,source,tree,rootID)
 if err!=nil {return empty,nil,errSourceCleanupUnsafe}
 for id:=range tree {if !managed[id] {return empty,nil,errSourceCleanupUnsafe}}
 var others []meta.Source
 if err:=tx.Where("owner_id=? AND id<>? AND status<>? AND target_node_id IS NOT NULL",
  source.OwnerID,source.ID,meta.SourceStatusArchived).Find(&others).Error;err!=nil {return empty,nil,err}
 for _,other:=range others {
  if other.TargetNodeID!=nil {
   if _,isInside:=tree[*other.TargetNodeID];isInside {return empty,nil,errSourceCleanupUnsafe}
  }
 }
 // Any unrelated SourceItem pointing to a node in this tree blocks cleanup
 // even if the other Source was archived. Never infer ownership from path.
 ids:=make([]uint64,0,len(tree))
 for id:=range tree {ids=append(ids,id)}
 sort.Slice(ids,func(i,j int)bool{return ids[i]<ids[j]})
 var foreign int64
 for start:=0;start<len(ids);start+=4000 {
  end:=start+4000
  if end>len(ids){end=len(ids)}
  if err:=tx.Model(&meta.SourceItem{}).Where("node_id IN ? AND source_id <> ?",ids[start:end],source.ID).
   Count(&foreign).Error;err!=nil{return empty,nil,err}
  if foreign!=0 {return empty,nil,errSourceCleanupUnsafe}
 }
 var sizeBytes int64
 var countFiles int64
 for start:=0;start<len(ids);start+=4000 {
  end:=start+4000
  if end>len(ids){end=len(ids)}
  type fileSize struct{ Count int64; Total int64 }
  var result fileSize
  if err:=tx.Model(&meta.File{}).Select("COUNT(*) AS count, COALESCE(SUM(size),0) AS total").
   Where("node_id IN ?",ids[start:end]).Scan(&result).Error;err!=nil{return empty,nil,err}
  countFiles+=result.Count
  sizeBytes+=result.Total
 }
 h:=sha256.New()
 _,_ = fmt.Fprintf(h,"xdrive-source-cleanup-v1/%d/%d/%d/%d",source.OwnerID,source.ID,source.Revision,rootID)
 for _,id:=range ids {
  n:=tree[id]
  _,_ = fmt.Fprintf(h,"/%d:%d:%s",id,n.Revision,n.Type)
 }
 preview:=sourceCleanupPreview{
  SourceID:source.ID,TargetNodeID:rootID,SourceRevision:source.Revision,
  FileCount:countFiles,DirectoryCount:int64(len(ids))-countFiles,LogicalBytes:sizeBytes,
  Confirmation:hex.EncodeToString(h.Sum(nil)),
 }
 return preview,ids,ctx.Err()
}

func (s *Server) previewSourceCloudCleanup(c *gin.Context) {
 id,ok:=parseID(c.Param("id"));if !ok {fail(c,http.StatusBadRequest,"invalid Source");return}
 expected,ok:=expectedRevision(c);if !ok{return}
 var preview sourceCleanupPreview
 err:=s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB)error{
  var source meta.Source
  if err:=tx.Clauses(clause.Locking{Strength:"SHARE"}).Where("id=? AND owner_id=?",id,userID(c)).Take(&source).Error;err!=nil{return err}
  if source.Revision!=expected{return errRevisionConflict}
  var err error
  preview,_,err=sourceCleanupSnapshotTx(c.Request.Context(),tx,source)
  return err
 })
 if err!=nil {
  switch {
  case errors.Is(err,errRevisionConflict),errors.Is(err,errSourceCleanupUnsafe):
   fail(c,http.StatusConflict,"source cleanup preview is unavailable")
  case errors.Is(err,gorm.ErrRecordNotFound):
   fail(c,http.StatusNotFound,"source not found")
  default:
   fail(c,http.StatusInternalServerError,"source cleanup preview failed")
  }
  return
 }
 c.Header("Cache-Control","no-store")
 c.JSON(http.StatusOK,preview)
}

func (s *Server) cleanupSourceCloudFiles(c *gin.Context) {
 id,ok:=parseID(c.Param("id"));if !ok{fail(c,http.StatusBadRequest,"invalid Source");return}
 expected,ok:=expectedRevision(c);if !ok{return}
 var input struct{ Confirmation string `json:"confirmation"` }
 if err:=c.ShouldBindJSON(&input);err!=nil || len(input.Confirmation)!=64 ||
  strings.Trim(input.Confirmation,"0123456789abcdef")!="" {
  fail(c,http.StatusBadRequest,"confirmed cleanup snapshot is required");return
 }
 err:=s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB)error{
  var source meta.Source
  if err:=tx.Clauses(clause.Locking{Strength:"UPDATE"}).Where("id=? AND owner_id=?",id,userID(c)).Take(&source).Error;err!=nil{return err}
  if source.Revision!=expected {return errRevisionConflict}
  preview,ids,err:=sourceCleanupSnapshotTx(c.Request.Context(),tx,source)
  if err!=nil{return err}
  if input.Confirmation!=preview.Confirmation{return errRevisionConflict}
  now:=time.Now().UTC()
  for start:=0;start<len(ids);start+=4000 {
   end:=start+4000
   if end>len(ids) {end=len(ids)}
   if err:=tx.Model(&meta.Share{}).Where("owner_id=? AND node_id IN ? AND revoked_at IS NULL",
    source.OwnerID,ids[start:end]).Update("revoked_at",&now).Error;err!=nil{return err}
  }
  var root meta.Node
  if err:=tx.Where("id=? AND owner_id=? AND deleted_at IS NULL",
   preview.TargetNodeID,source.OwnerID).Take(&root).Error;err!=nil{return err}
  updated,err:=markFileOperationDeleteSubtreeTx(tx,source.OwnerID,root.ID,root.Revision,ids,now)
  if err!=nil{return err}
  if !updated {return errRevisionConflict}
  return nil
 })
 if err!=nil {
  switch {
  case errors.Is(err,errRevisionConflict),errors.Is(err,errSourceCleanupUnsafe):
   fail(c,http.StatusConflict,"source cloud cleanup changed or is unsafe; preview again")
  case errors.Is(err,gorm.ErrRecordNotFound):
   fail(c,http.StatusNotFound,"source not found")
  default:
   fail(c,http.StatusInternalServerError,"source cloud cleanup failed")
  }
  return
 }
 c.Status(http.StatusNoContent)
}

// Use this helper for documentation/tests when deterministic snapshots matter.
func sourceCleanupExpectedRevision(value uint64) string {return strconv.FormatUint(value,10)}
