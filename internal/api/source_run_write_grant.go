package api

import (
 "errors"
 "net/http"
 "time"

 "github.com/gin-gonic/gin"
 "github.com/lazyxu/xdrive/internal/meta"
 "gorm.io/gorm"
)

const sourceRunAgentGrantTTL = 12 * time.Hour

type sourceRunWriteGrantDTO struct {
 AccessToken string `json:"access_token"`
 ExpiresAt time.Time `json:"expires_at"`
}

// Legacy Synology Photos source-agent authenticates with an Owner session.
// Preserve that established trust contract, but issue a short-lived,
// SourceRun-scoped writer so its ordinary Node/CAS uploads cannot accidentally
// mutate another Source. Native local_folder Push still requires device/Root
// proofs and must not request grants through this endpoint.
func (s *Server) issueLegacySourceRunWriteGrant(c *gin.Context) {
 sourceID,ok:=parseID(c.Param("id"))
 if !ok {fail(c,http.StatusBadRequest,"invalid source");return}
 runID:=c.Param("runID")
 if runID=="" {fail(c,http.StatusBadRequest,"invalid source run");return}
 if _,scoped:=currentSourceRunScope(c);scoped {
  fail(c,http.StatusForbidden,"scoped writer cannot mint source-run tokens");return
 }
 var source meta.Source
 var run meta.SyncRun
 err:=s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB)error{
  if err:=tx.Where("id=? AND owner_id=? AND kind=? AND direction=? AND status=?",
   sourceID,userID(c),synologySourceKind,meta.SourceDirectionPush,meta.SourceStatusActive).Take(&source).Error;err!=nil{return err}
  if source.TargetNodeID==nil {return errManagedTargetUnavailable}
  if err:=tx.Where("id=? AND source_id=? AND status=? AND mode=? AND cancel_requested_at IS NULL",
   runID,sourceID,meta.SyncRunStatusRunning,meta.SourceRunModeSync).Take(&run).Error;err!=nil{return err}
  if run.TargetNodeID==nil || *run.TargetNodeID!=*source.TargetNodeID || run.SourceRevision!=source.Revision {
   return errManagedSourceMutation
  }
  return nil
 })
 if err!=nil {
  if errors.Is(err,gorm.ErrRecordNotFound) || errors.Is(err,errManagedSourceMutation) {
   fail(c,http.StatusConflict,"active legacy source run grant unavailable")
  } else {
   fail(c,http.StatusInternalServerError,"source run grant check failed")
  }
  return
 }
 userValue,exists:=c.Get("user")
 user,ok:=userValue.(meta.User)
 if !exists || !ok || user.ID==0 {fail(c,http.StatusUnauthorized,"owner required");return}
 token,err:=s.Auth.IssueSourceRunAccessTTL(user.ID,user.SessionVersion,source.ID,run.ID,sourceRunAgentGrantTTL)
 if err!=nil {fail(c,http.StatusInternalServerError,"source run grant unavailable");return}
 c.Header("Cache-Control","no-store")
 c.JSON(http.StatusOK,sourceRunWriteGrantDTO{AccessToken:token,ExpiresAt:time.Now().UTC().Add(sourceRunAgentGrantTTL)})
}
