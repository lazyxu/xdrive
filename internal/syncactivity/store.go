// Package syncactivity stores durable, account-scoped receipts for sync runs.
// It does not infer file changes from an Agent's coarse "sync normal" status.
package syncactivity

import (
 "context"
 "database/sql"
 "errors"
 "fmt"
 "os"
 "path/filepath"
 "strings"
 "time"

 _ "modernc.org/sqlite"
)

var (
 ErrNotFound = errors.New("sync activity run not found")
 ErrTerminal = errors.New("sync activity run is already terminal")
 ErrReceiptConflict = errors.New("sync activity item ID was reused with different contents")
 ErrIncomplete = errors.New("sync activity has failed or conflicted items")
)

const (
 StatusRunning = "running"
 StatusCompleted = "completed"
 StatusPartial = "partial"
 StatusFailed = "failed"
 StatusCancelled = "cancelled"
 StatusInterrupted = "interrupted"
)

type Stats struct {
 Items int64
 Successful int64
 Created int64
 Updated int64
 Deleted int64
 Moved int64
 Renamed int64
 Uploaded int64
 Downloaded int64
 Skipped int64
 Failed int64
 Conflicted int64
 // A nil value is "not measured", not zero network traffic.
 TransferredBytes *int64
}

type Run struct {
 ID string
 Engine string
 Trigger string
 StartedAt time.Time
 FinishedAt *time.Time
 Status string
 Outcome string
 DetailComplete bool
 DetailsExpired bool
 Stats Stats
}

type Item struct {
 RunID string
 ID string
 Action string
 Direction string
 Status string
 OldPath string
 NewPath string
 LogicalBytes *int64
 TransferredBytes *int64
 ErrorCode string
 ErrorMessage string
 AppliedAt time.Time
}

type RunCursor struct { StartedAt time.Time; ID string }
type ItemCursor struct { AppliedAt time.Time; ID string }

type Store struct {
 db *sql.DB
 path string
 owner string
}

const runColumns = "run_id, engine, trigger, started_at, finished_at, status, outcome, detail_complete, details_expired, item_count, successful_count, created_count, updated_count, deleted_count, moved_count, renamed_count, uploaded_count, downloaded_count, skipped_count, failed_count, conflict_count, transferred_bytes"
const itemColumns = "run_id, item_id, action, direction, status, old_path, new_path, logical_bytes, transferred_bytes, error_code, error_message, applied_at"

// Open never follows a preexisting symlink at the chosen database path.
// Agent callers must derive the path from their verified Server/Owner identity.
func Open(path, owner string) (*Store, error) {
 if strings.TrimSpace(path) == "" || strings.TrimSpace(owner) == "" {
  return nil, errors.New("sync activity path and owner are required")
 }
 if info, err := os.Lstat(path); err == nil {
  if !info.Mode().IsRegular() {
   return nil, errors.New("sync activity database must be an ordinary file")
  }
 } else if !errors.Is(err, os.ErrNotExist) {
  return nil, err
 }
 dir := filepath.Dir(path)
 if err := os.MkdirAll(dir, 0700); err != nil { return nil, err }
 db, err := sql.Open("sqlite", path)
 if err != nil { return nil, err }
 db.SetMaxOpenConns(1)
 db.SetMaxIdleConns(1)
 fail := func(err error) (*Store, error) { _ = db.Close(); return nil, err }
 ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
 defer cancel()
 for _, q := range []string{
  "PRAGMA busy_timeout=5000",
  "PRAGMA journal_mode=WAL",
  "PRAGMA synchronous=FULL",
  "PRAGMA foreign_keys=ON",
  "CREATE TABLE IF NOT EXISTS activity_owner (singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner TEXT NOT NULL, version INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS sync_runs (run_id TEXT PRIMARY KEY, engine TEXT NOT NULL, trigger TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, status TEXT NOT NULL, outcome TEXT NOT NULL DEFAULT 'unknown', detail_complete INTEGER NOT NULL DEFAULT 0, details_expired INTEGER NOT NULL DEFAULT 0, item_count INTEGER NOT NULL DEFAULT 0, successful_count INTEGER NOT NULL DEFAULT 0, created_count INTEGER NOT NULL DEFAULT 0, updated_count INTEGER NOT NULL DEFAULT 0, deleted_count INTEGER NOT NULL DEFAULT 0, moved_count INTEGER NOT NULL DEFAULT 0, renamed_count INTEGER NOT NULL DEFAULT 0, uploaded_count INTEGER NOT NULL DEFAULT 0, downloaded_count INTEGER NOT NULL DEFAULT 0, skipped_count INTEGER NOT NULL DEFAULT 0, failed_count INTEGER NOT NULL DEFAULT 0, conflict_count INTEGER NOT NULL DEFAULT 0, transferred_bytes INTEGER)",
  "CREATE INDEX IF NOT EXISTS idx_sync_runs_recent ON sync_runs(started_at DESC, run_id DESC)",
  "CREATE TABLE IF NOT EXISTS sync_items (run_id TEXT NOT NULL REFERENCES sync_runs(run_id) ON DELETE CASCADE, item_id TEXT NOT NULL, action TEXT NOT NULL, direction TEXT NOT NULL, status TEXT NOT NULL, old_path TEXT NOT NULL, new_path TEXT NOT NULL, logical_bytes INTEGER, transferred_bytes INTEGER, error_code TEXT NOT NULL, error_message TEXT NOT NULL, applied_at INTEGER NOT NULL, PRIMARY KEY(run_id, item_id))",
  "CREATE INDEX IF NOT EXISTS idx_sync_items_recent ON sync_items(run_id, applied_at DESC, item_id DESC)",
 } {
  if _, err := db.ExecContext(ctx, q); err != nil { return fail(fmt.Errorf("sync activity setup: %w", err)) }
 }
 // This identity seal prevents an old account's rows being opened as another.
 if _, err := db.ExecContext(ctx, "INSERT OR IGNORE INTO activity_owner(singleton,owner,version) VALUES (1,?,1)", owner); err != nil {
  return fail(err)
 }
 var storedOwner string
 var version int
 if err := db.QueryRowContext(ctx, "SELECT owner,version FROM activity_owner WHERE singleton=1").Scan(&storedOwner,&version); err != nil {
  return fail(err)
 }
 if version != 1 || storedOwner != owner { return fail(errors.New("sync activity owner/version mismatch")) }
 // We cannot prove the outcome of an attempt that was still running at crash.
 if _, err := db.ExecContext(ctx, "UPDATE sync_runs SET status=?, outcome='unknown', detail_complete=0, finished_at=? WHERE status=?", StatusInterrupted, time.Now().UTC().UnixNano(), StatusRunning); err != nil {
  return fail(err)
 }
 if err := os.Chmod(path, 0600); err != nil { return fail(err) }
 return &Store{db:db, path:path, owner:owner}, nil
}

func (s *Store) Close() error { return s.db.Close() }
func (s *Store) Path() string { return s.path }

func validID(v string) bool { return len(v)>0 && len(v)<=128 && strings.TrimSpace(v)==v && !strings.ContainsRune(v, 0) }
func validStatus(v string) bool {
 switch v { case StatusCompleted,StatusPartial,StatusFailed,StatusCancelled,StatusInterrupted: return true }
 return false
}

// Begin is idempotent for identical receipts, but rejects an ID collision.
func (s *Store) Begin(ctx context.Context, r Run) error {
 if !validID(r.ID) || !validID(r.Engine) || !validID(r.Trigger) {
  return errors.New("invalid sync activity run identity")
 }
 if r.StartedAt.IsZero() { r.StartedAt=time.Now().UTC() }
 _,err:=s.db.ExecContext(ctx, "INSERT OR IGNORE INTO sync_runs(run_id,engine,trigger,started_at,status) VALUES(?,?,?,?,?)",r.ID,r.Engine,r.Trigger,r.StartedAt.UnixNano(),StatusRunning)
 if err!=nil { return err }
 var engine,trigger string
 var started int64
 if err:=s.db.QueryRowContext(ctx,"SELECT engine,trigger,started_at FROM sync_runs WHERE run_id=?",r.ID).Scan(&engine,&trigger,&started);err!=nil{return err}
 if engine!=r.Engine || trigger!=r.Trigger || started!=r.StartedAt.UnixNano(){return ErrReceiptConflict}
 return nil
}

func validItem(x Item) bool {
 if !validID(x.RunID) || !validID(x.ID) || len(x.OldPath)>8192 || len(x.NewPath)>8192 || len(x.ErrorCode)>128 || len(x.ErrorMessage)>2048 {return false}
 switch x.Action {case "create","update","delete","move","rename","noop": default:return false}
 switch x.Direction {case "upload","download","local","none":default:return false}
 switch x.Status {case "completed","failed","skipped","conflict":default:return false}
 if x.LogicalBytes!=nil && *x.LogicalBytes<0 || x.TransferredBytes!=nil && *x.TransferredBytes<0 {return false}
 if (x.Action=="rename" || x.Action=="move") && (x.OldPath=="" || x.NewPath==""){return false}
 return true
}

func sameNull(a,b sql.NullInt64) bool { return a.Valid==b.Valid && (!a.Valid || a.Int64==b.Int64) }
func nullInt(v *int64) sql.NullInt64 {
 if v==nil{return sql.NullInt64{}}
 return sql.NullInt64{Int64:*v, Valid:true}
}

func (s *Store) Append(ctx context.Context, x Item) error {
 if !validItem(x) {return errors.New("invalid sync activity item")}
 if x.AppliedAt.IsZero(){x.AppliedAt=time.Now().UTC()}
 tx,err:=s.db.BeginTx(ctx,nil);if err!=nil{return err}
 defer tx.Rollback()
 var status string
 if err:=tx.QueryRowContext(ctx,"SELECT status FROM sync_runs WHERE run_id=?",x.RunID).Scan(&status);err!=nil{
  if errors.Is(err,sql.ErrNoRows){return ErrNotFound};return err
 }
 // A late writer cannot mutate a finished run.
 if status!=StatusRunning{return ErrTerminal}
 res,err:=tx.ExecContext(ctx, "INSERT OR IGNORE INTO sync_items("+itemColumns+") VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
  x.RunID,x.ID,x.Action,x.Direction,x.Status,x.OldPath,x.NewPath,
  nullInt(x.LogicalBytes),nullInt(x.TransferredBytes),x.ErrorCode,x.ErrorMessage,x.AppliedAt.UnixNano())
 if err!=nil{return err}
 count,err:=res.RowsAffected();if err!=nil{return err}
 if count==0 {
  var old Item
  var logical,transfer sql.NullInt64
  var ts int64
  err=tx.QueryRowContext(ctx,"SELECT "+itemColumns+" FROM sync_items WHERE run_id=? AND item_id=?",x.RunID,x.ID).
   Scan(&old.RunID,&old.ID,&old.Action,&old.Direction,&old.Status,&old.OldPath,&old.NewPath,
    &logical,&transfer,&old.ErrorCode,&old.ErrorMessage,&ts)
  if err!=nil{return err}
  if old.Action!=x.Action || old.Direction!=x.Direction || old.Status!=x.Status ||
   old.OldPath!=x.OldPath || old.NewPath!=x.NewPath || old.ErrorCode!=x.ErrorCode ||
   old.ErrorMessage!=x.ErrorMessage || !sameNull(logical,nullInt(x.LogicalBytes)) ||
   !sameNull(transfer,nullInt(x.TransferredBytes)) || ts!=x.AppliedAt.UnixNano() {return ErrReceiptConflict}
  return tx.Commit()
 }
 successful:=x.Status=="completed"
 hit:=func(action string)int64{if successful && x.Action==action{return 1};return 0}
 cnt:=func(ok bool)int64{if ok{return 1};return 0}
 var network sql.NullInt64
 if successful && (x.Direction=="upload" || x.Direction=="download"){network=nullInt(x.TransferredBytes)}
 _,err=tx.ExecContext(ctx,
  "UPDATE sync_runs SET item_count=item_count+1,successful_count=successful_count+?, created_count=created_count+?,updated_count=updated_count+?,deleted_count=deleted_count+?,moved_count=moved_count+?,renamed_count=renamed_count+?,uploaded_count=uploaded_count+?,downloaded_count=downloaded_count+?,skipped_count=skipped_count+?,failed_count=failed_count+?,conflict_count=conflict_count+?,transferred_bytes=CASE WHEN ? IS NULL THEN transferred_bytes ELSE COALESCE(transferred_bytes,0)+? END WHERE run_id=?",
  cnt(successful),hit("create"),hit("update"),hit("delete"),hit("move"),hit("rename"),
  cnt(successful&&x.Direction=="upload"),cnt(successful&&x.Direction=="download"),
  cnt(x.Status=="skipped"),cnt(x.Status=="failed"),cnt(x.Status=="conflict"),
  network,network,x.RunID)
 if err!=nil{return err}
 return tx.Commit()
}

// Finish never turns failed/conflicted committed items into a successful run.
// detailComplete is true only when the caller has covered *all* mutation paths.
func (s *Store) Finish(ctx context.Context, id,status string,detailComplete bool) error {
 if !validID(id) || !validStatus(status){return errors.New("invalid terminal sync activity state")}
 tx,err:=s.db.BeginTx(ctx,nil);if err!=nil{return err}
 defer tx.Rollback()
 var state string
 var success,failed,conflicted,changes int64
 err=tx.QueryRowContext(ctx,
  "SELECT status,successful_count,failed_count,conflict_count,created_count+updated_count+deleted_count+moved_count+renamed_count FROM sync_runs WHERE run_id=?",id).
  Scan(&state,&success,&failed,&conflicted,&changes)
 if errors.Is(err,sql.ErrNoRows){return ErrNotFound}
 if err!=nil{return err}
 if state!=StatusRunning {
  if state==status {return tx.Commit()}
  return ErrTerminal
 }
 if status==StatusCompleted && failed+conflicted>0{return ErrIncomplete}
 if status==StatusPartial && failed+conflicted==0{return ErrIncomplete}
 outcome:="unknown"
 if changes>0 {outcome="changed"} else if detailComplete && status==StatusCompleted {outcome="no_change"}
 if status!=StatusCompleted && status!=StatusPartial {detailComplete=false}
 _,err=tx.ExecContext(ctx,
  "UPDATE sync_runs SET status=?,outcome=?,detail_complete=?,finished_at=? WHERE run_id=? AND status=?",
  status,outcome,detailComplete,time.Now().UTC().UnixNano(),id,StatusRunning)
 if err!=nil{return err}
 return tx.Commit()
}

type rowScanner interface{ Scan(...any)error }
func scanRun(row rowScanner)(Run,error){
 var r Run
 var started int64
 var finished,bytes sql.NullInt64
 var complete,expired int64
 err:=row.Scan(&r.ID,&r.Engine,&r.Trigger,&started,&finished,&r.Status,&r.Outcome,
  &complete,&expired,&r.Stats.Items,&r.Stats.Successful,&r.Stats.Created,&r.Stats.Updated,
  &r.Stats.Deleted,&r.Stats.Moved,&r.Stats.Renamed,&r.Stats.Uploaded,&r.Stats.Downloaded,
  &r.Stats.Skipped,&r.Stats.Failed,&r.Stats.Conflicted,&bytes)
 if err!=nil{return r,err}
 r.StartedAt=time.Unix(0,started).UTC()
 if finished.Valid {f:=time.Unix(0,finished.Int64).UTC();r.FinishedAt=&f}
 r.DetailComplete=complete!=0;r.DetailsExpired=expired!=0
 if bytes.Valid {v:=bytes.Int64;r.Stats.TransferredBytes=&v}
 return r,nil
}

func (s *Store) Get(ctx context.Context,id string)(Run,error){
 r,err:=scanRun(s.db.QueryRowContext(ctx,"SELECT "+runColumns+" FROM sync_runs WHERE run_id=?",id))
 if errors.Is(err,sql.ErrNoRows){return Run{},ErrNotFound}
 return r,err
}

func (s *Store) List(ctx context.Context,limit int,after *RunCursor)([]Run,error){
 if limit<=0 || limit>50{return nil,errors.New("run page limit must be between 1 and 50")}
 query:="SELECT "+runColumns+" FROM sync_runs"
 args:=[]any{}
 if after!=nil {
  if !validID(after.ID)||after.StartedAt.IsZero(){return nil,errors.New("invalid run cursor")}
  query+=" WHERE (started_at<? OR (started_at=? AND run_id<?))"
  args=append(args,after.StartedAt.UnixNano(),after.StartedAt.UnixNano(),after.ID)
 }
 query+=" ORDER BY started_at DESC,run_id DESC LIMIT ?"
 args=append(args,limit)
 rows,err:=s.db.QueryContext(ctx,query,args...);if err!=nil{return nil,err}
 defer rows.Close()
 out:=make([]Run,0,limit)
 for rows.Next(){r,err:=scanRun(rows);if err!=nil{return nil,err};out=append(out,r)}
 return out,rows.Err()
}

func scanItem(row rowScanner)(Item,error){
 var x Item
 var logical,bytes sql.NullInt64
 var timestamp int64
 err:=row.Scan(&x.RunID,&x.ID,&x.Action,&x.Direction,&x.Status,&x.OldPath,&x.NewPath,
  &logical,&bytes,&x.ErrorCode,&x.ErrorMessage,&timestamp)
 if err!=nil{return x,err}
 if logical.Valid{v:=logical.Int64;x.LogicalBytes=&v}
 if bytes.Valid{v:=bytes.Int64;x.TransferredBytes=&v}
 x.AppliedAt=time.Unix(0,timestamp).UTC()
 return x,nil
}

func (s *Store) Items(ctx context.Context,runID string,limit int,after *ItemCursor)([]Item,error){
 if !validID(runID)||limit<=0||limit>50{return nil,errors.New("invalid item page request")}
 if _,err:=s.Get(ctx,runID);err!=nil{return nil,err}
 query:="SELECT "+itemColumns+" FROM sync_items WHERE run_id=?"
 args:=[]any{runID}
 if after!=nil {
  if !validID(after.ID)||after.AppliedAt.IsZero(){return nil,errors.New("invalid item cursor")}
  query+=" AND (applied_at<? OR (applied_at=? AND item_id<?))"
  args=append(args,after.AppliedAt.UnixNano(),after.AppliedAt.UnixNano(),after.ID)
 }
 query+=" ORDER BY applied_at DESC,item_id DESC LIMIT ?";args=append(args,limit)
 rows,err:=s.db.QueryContext(ctx,query,args...);if err!=nil{return nil,err}
 defer rows.Close()
 out:=make([]Item,0,limit)
 for rows.Next(){x,err:=scanItem(rows);if err!=nil{return nil,err};out=append(out,x)}
 return out,rows.Err()
}

// Prune expires per-file success details before failures, keeping summaries
// separately. It never deletes in-flight runs or changes their stored counts.
func (s *Store) Prune(ctx context.Context,now time.Time)error{
 tx,err:=s.db.BeginTx(ctx,nil);if err!=nil{return err};defer tx.Rollback()
 successBefore:=now.Add(-30*24*time.Hour).UnixNano()
 failureBefore:=now.Add(-90*24*time.Hour).UnixNano()
 summaryBefore:=now.Add(-180*24*time.Hour).UnixNano()
 predicate:="((status IN ('completed','skipped') AND applied_at<?) OR (status NOT IN ('completed','skipped') AND applied_at<?)) AND run_id IN (SELECT run_id FROM sync_runs WHERE status<>'running')"
 if _,err=tx.ExecContext(ctx,"UPDATE sync_runs SET details_expired=1 WHERE run_id IN (SELECT run_id FROM sync_items WHERE "+predicate+")",successBefore,failureBefore);err!=nil{return err}
 if _,err=tx.ExecContext(ctx,"DELETE FROM sync_items WHERE "+predicate,successBefore,failureBefore);err!=nil{return err}
 if _,err=tx.ExecContext(ctx,"DELETE FROM sync_runs WHERE status<>'running' AND finished_at<?",summaryBefore);err!=nil{return err}
 if _,err=tx.ExecContext(ctx,"DELETE FROM sync_runs WHERE run_id IN (SELECT run_id FROM sync_runs WHERE status<>'running' ORDER BY started_at DESC,run_id DESC LIMIT -1 OFFSET 5000)");err!=nil{return err}
 return tx.Commit()
}
