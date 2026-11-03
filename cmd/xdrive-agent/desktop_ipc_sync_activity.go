package main

import (
 "context"
 "errors"
 "net/http"
 "strconv"
 "strings"
 "time"

 "github.com/lazyxu/xdrive/internal/syncactivity"
)

// Keep this optional for older Agent/controller test doubles. The actual
// Agent owns the account seal and never delegates Owner selection to Renderer.
type desktopIPCSyncActivityReader interface {
 SyncActivityRuns(context.Context,int,*syncactivity.RunCursor)([]syncactivity.Run,error)
 SyncActivityRun(context.Context,string)(syncactivity.Run,error)
 SyncActivityItems(context.Context,string,int,*syncactivity.ItemCursor)([]syncactivity.Item,error)
}

func (h *desktopIPCHandler) syncActivityReader(w http.ResponseWriter) desktopIPCSyncActivityReader {
 provider,ok:=h.ctrl.(desktopIPCSyncActivityReader)
 if !ok {
  writeDesktopIPCError(w,http.StatusNotImplemented,"sync_activity_unavailable","sync history is not supported by this Agent")
  return nil
 }
 return provider
}

func syncActivityPageLimit(r *http.Request)(int,error){
 raw:=strings.TrimSpace(r.URL.Query().Get("limit"))
 if raw=="" {return 50,nil}
 n,err:=strconv.Atoi(raw)
 if err!=nil||n<1||n>50{return 0,errors.New("limit must be between 1 and 50")}
 return n,nil
}

func syncActivityCursorTime(r *http.Request,timeKey,idKey string)(time.Time,string,error){
 raw:=strings.TrimSpace(r.URL.Query().Get(timeKey))
 id:=strings.TrimSpace(r.URL.Query().Get(idKey))
 if raw=="" && id=="" {return time.Time{},"",nil}
 if raw=="" || id=="" || len(id)>128 {return time.Time{},"",errors.New("both cursor fields are required")}
 nano,err:=strconv.ParseInt(raw,10,64)
 if err!=nil || nano<=0 {return time.Time{},"",errors.New("invalid cursor timestamp")}
 return time.Unix(0,nano).UTC(),id,nil
}

func syncActivityReadError(w http.ResponseWriter,err error){
 if errors.Is(err,syncactivity.ErrNotFound) {
  writeDesktopIPCError(w,http.StatusNotFound,"sync_activity_not_found","sync history record was not found")
  return
 }
 writeDesktopIPCError(w,http.StatusServiceUnavailable,"sync_activity_unavailable","sync history is unavailable for the current account")
}

func (h *desktopIPCHandler) syncActivityRuns(w http.ResponseWriter,r *http.Request){
 provider:=h.syncActivityReader(w);if provider==nil{return}
 limit,err:=syncActivityPageLimit(r);if err!=nil{
  writeDesktopIPCError(w,http.StatusBadRequest,"invalid_limit",err.Error());return
 }
 at,id,err:=syncActivityCursorTime(r,"before_started_at","before_run_id")
 if err!=nil{writeDesktopIPCError(w,http.StatusBadRequest,"invalid_cursor",err.Error());return}
 var after *syncactivity.RunCursor
 if id!=""{after=&syncactivity.RunCursor{StartedAt:at,ID:id}}
 runs,err:=provider.SyncActivityRuns(r.Context(),limit,after)
 if err!=nil{syncActivityReadError(w,err);return}
 var next any
 if len(runs)==limit {
  tail:=runs[len(runs)-1]
  next=map[string]any{"before_started_at":tail.StartedAt.UnixNano(),"before_run_id":tail.ID}
 }
 writeDesktopIPCJSON(w,http.StatusOK,map[string]any{"items":runs,"next_cursor":next})
}

func (h *desktopIPCHandler) syncActivityRun(w http.ResponseWriter,r *http.Request){
 provider:=h.syncActivityReader(w);if provider==nil{return}
 id:=strings.TrimSpace(r.URL.Query().Get("run_id"))
 if id=="" || len(id)>128{
  writeDesktopIPCError(w,http.StatusBadRequest,"invalid_run_id","run_id is required and must be bounded");return
 }
 run,err:=provider.SyncActivityRun(r.Context(),id)
 if err!=nil{syncActivityReadError(w,err);return}
 writeDesktopIPCJSON(w,http.StatusOK,run)
}

func (h *desktopIPCHandler) syncActivityItems(w http.ResponseWriter,r *http.Request){
 provider:=h.syncActivityReader(w);if provider==nil{return}
 runID:=strings.TrimSpace(r.URL.Query().Get("run_id"))
 if runID==""||len(runID)>128{
  writeDesktopIPCError(w,http.StatusBadRequest,"invalid_run_id","run_id is required and must be bounded");return
 }
 limit,err:=syncActivityPageLimit(r);if err!=nil{
  writeDesktopIPCError(w,http.StatusBadRequest,"invalid_limit",err.Error());return
 }
 at,id,err:=syncActivityCursorTime(r,"before_applied_at","before_item_id")
 if err!=nil{writeDesktopIPCError(w,http.StatusBadRequest,"invalid_cursor",err.Error());return}
 var after *syncactivity.ItemCursor
 if id!=""{after=&syncactivity.ItemCursor{AppliedAt:at,ID:id}}
 items,err:=provider.SyncActivityItems(r.Context(),runID,limit,after)
 if err!=nil{syncActivityReadError(w,err);return}
 var next any
 if len(items)==limit{
  tail:=items[len(items)-1]
  next=map[string]any{"before_applied_at":tail.AppliedAt.UnixNano(),"before_item_id":tail.ID}
 }
 writeDesktopIPCJSON(w,http.StatusOK,map[string]any{"items":items,"next_cursor":next})
}
