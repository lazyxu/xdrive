package synologyui

import (
 "context"
 "encoding/json"
 "errors"
 "io"
 "net/http"
 "strconv"
 "strings"

 "github.com/lazyxu/xdrive/internal/client"
 "github.com/lazyxu/xdrive/internal/localbackupipc"
)

type OwnerClipboardAgent interface {
 OwnerClipboardVault(context.Context)(client.ClipboardVault,error)
 OwnerClipboardCheck(context.Context,client.ClipboardCheck)(client.ClipboardVault,error)
 OwnerClipboardList(context.Context,uint64)(client.ClipboardPage,error)
 OwnerClipboardCreate(context.Context,client.ClipboardWrite)(client.ClipboardItem,error)
 OwnerClipboardDelete(context.Context,uint64)error
 OwnerClipboardClear(context.Context)error
}
func isDSMClipboardRoute(path string) bool {
 switch path {
 case "/v1/cloud-clipboard-capability","/v1/cloud-clipboard-vault",
   "/v1/cloud-clipboard-check","/v1/cloud-clipboard-list",
   "/v1/cloud-clipboard-create","/v1/cloud-clipboard-delete",
   "/v1/cloud-clipboard-clear":return true
 }
 return false
}
func isDSMClipboardWrite(path string) bool {
 switch path {
 case "/v1/cloud-clipboard-check","/v1/cloud-clipboard-create",
 "/v1/cloud-clipboard-delete","/v1/cloud-clipboard-clear":return true
 }
 return false
}
const dsmClipboardBodyMax=128<<10
type dsmClipboardWrite struct {
 OwnerScope string `json:"owner_scope"`
 Nonce string `json:"nonce,omitempty"`
 Ciphertext string `json:"ciphertext,omitempty"`
 Scope string `json:"scope,omitempty"`
 ClientEventID string `json:"client_event_id,omitempty"`
 Kind string `json:"kind,omitempty"`
 ID uint64 `json:"id,omitempty"`
}
func parseDSMClipboardWrite(r *http.Request)(dsmClipboardWrite,error) {
 var v dsmClipboardWrite
 if r.ContentLength<2 || r.ContentLength>dsmClipboardBodyMax{return v,errors.New("invalid Clipboard body length")}
 raw,err:=io.ReadAll(io.LimitReader(r.Body,dsmClipboardBodyMax+1))
 if err!=nil || len(raw)>dsmClipboardBodyMax || int64(len(raw))!=r.ContentLength {
   return v,errors.New("unbounded Clipboard body")
 }
 dec:=json.NewDecoder(strings.NewReader(string(raw)))
 dec.DisallowUnknownFields()
 if err:=dec.Decode(&v);err!=nil{return v,err}
 var tail any
 if err:=dec.Decode(&tail);err!=io.EOF{return v,errors.New("trailing Clipboard input")}
 if len(v.OwnerScope)!=64 || !nasSelectionID.MatchString(v.OwnerScope){
  return v,errors.New("invalid Clipboard Owner scope")
 }
 switch r.URL.Path {
 case "/v1/cloud-clipboard-check":
   if len(v.Nonce)!=16 || len(v.Ciphertext)<20 || len(v.Ciphertext)>256 ||
   v.Scope=="" || len(v.Scope)>512 || v.ID!=0 || v.ClientEventID!="" || v.Kind!="" {
     return v,errors.New("invalid Clipboard encrypted verifier")
   }
 case "/v1/cloud-clipboard-create":
   if len(v.Nonce)!=16 || len(v.Ciphertext)<20 || len(v.Ciphertext)>90000 ||
   len(v.ClientEventID)!=36 || (v.Kind!="text/plain" && v.Kind!="text/uri-list") ||
   v.ID!=0 || v.Scope!="" {return v,errors.New("invalid encrypted Clipboard")}
 case "/v1/cloud-clipboard-delete":
   if v.ID==0 || v.Nonce!="" || v.Ciphertext!="" || v.ClientEventID!="" ||
   v.Scope!="" || v.Kind!="" {return v,errors.New("invalid Clipboard delete")}
 case "/v1/cloud-clipboard-clear":
   if v.ID!=0 || v.Nonce!="" || v.Ciphertext!="" || v.ClientEventID!="" ||
   v.Scope!="" || v.Kind!="" {return v,errors.New("invalid Clipboard clear")}
 default:return v,errors.New("unknown Clipboard mutation")
 }
 return v,nil
}
func serveDSMOwnerClipboard(w http.ResponseWriter,r *http.Request,ctx context.Context,
 agent Agent,key []byte,principal string) {
 operations,ok:=agent.(OwnerClipboardAgent)
 capable,capableOK:=agent.(interface{OwnerClipboardAvailable()bool})
 login,loginOK:=agent.(ServerLoginAgent)
 if !ok || !capableOK || !loginOK || !capable.OwnerClipboardAvailable(){
  http.Error(w,"Owner Clipboard unavailable",http.StatusNotImplemented);return
 }
 before,err:=login.ServerConnection(ctx)
 if err!=nil || !before.Configured || before.MustChangePassword {
  http.Error(w,"Owner Clipboard authorization unavailable",http.StatusServiceUnavailable);return
 }
 var input dsmClipboardWrite
 if isDSMClipboardWrite(r.URL.Path) {
   input,err=parseDSMClipboardWrite(r)
   if err!=nil {http.Error(w,"invalid Owner Clipboard input",http.StatusBadRequest);return}
   expected:=dsmOwnerScope(key,principal,r.Header.Get("Cookie"),r.Host,before.Server,before.Username)
   if expected=="" || expected!=input.OwnerScope {
     http.Error(w,"Clipboard Owner changed",http.StatusConflict);return
   }
   quota,ok:=agent.(OwnerQuotaReader)
   if !ok {http.Error(w,"Owner proof unavailable",http.StatusNotImplemented);return}
   value,quotaErr:=quota.OwnerQuota(ctx)
   if quotaErr!=nil || !localbackupipc.ValidateOwnerQuota(value) {
     http.Error(w,"Owner proof invalid",http.StatusServiceUnavailable);return
   }
 }
 var output any
 switch r.URL.Path {
 case "/v1/cloud-clipboard-capability":output=map[string]bool{"available":true}
 case "/v1/cloud-clipboard-vault":output,err=operations.OwnerClipboardVault(ctx)
 case "/v1/cloud-clipboard-check":
  output,err=operations.OwnerClipboardCheck(ctx,client.ClipboardCheck{
   Nonce:input.Nonce,Ciphertext:input.Ciphertext,Scope:input.Scope,
  })
 case "/v1/cloud-clipboard-list":
  raw:=r.URL.Query().Get("before")
  after:=uint64(0)
  if raw!="" {
   after,err=strconv.ParseUint(raw,10,64)
   if err!=nil || after==0 {http.Error(w,"invalid Clipboard cursor",http.StatusBadRequest);return}
  }
  output,err=operations.OwnerClipboardList(ctx,after)
 case "/v1/cloud-clipboard-create":
  output,err=operations.OwnerClipboardCreate(ctx,client.ClipboardWrite{
   ClientEventID:input.ClientEventID,Kind:input.Kind,Nonce:input.Nonce,Ciphertext:input.Ciphertext,
  })
 case "/v1/cloud-clipboard-delete":
  err=operations.OwnerClipboardDelete(ctx,input.ID)
  output=map[string]bool{"deleted":err==nil}
 case "/v1/cloud-clipboard-clear":
  err=operations.OwnerClipboardClear(ctx)
  output=map[string]bool{"cleared":err==nil}
 default:http.NotFound(w,r);return
 }
 if err!=nil {http.Error(w,"Owner Clipboard request not confirmed",http.StatusConflict);return}
 after,err:=login.ServerConnection(ctx)
 if err!=nil || !after.Configured || after.MustChangePassword ||
    before.Server!=after.Server || before.Username!=after.Username {
   http.Error(w,"Clipboard Owner changed during operation",http.StatusConflict);return
 }
 sendJSON(w,output)
}
