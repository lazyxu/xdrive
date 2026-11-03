package sourceagent

import (
 "context"
 "fmt"
 "sync"
 "time"

 "github.com/lazyxu/xdrive/internal/client"
)

// RunScopedExecution keeps the source-agent's Owner session only for
// renewing a verified SourceRun grant. All mutable file bytes and Node API
// requests use the short-lived, exact-run bearer. No private Root token or
// Server signing secret is ever exposed to the UI.
type RunScopedExecution struct {
 owner *client.Client
 sourceID uint64
 runID string
 mu sync.Mutex
 writer *client.Client
 expires time.Time
}

func NewRunScopedExecution(owner *client.Client, sourceID uint64, runID string) *RunScopedExecution {
 return &RunScopedExecution{owner:owner,sourceID:sourceID,runID:runID}
}

func (r *RunScopedExecution) scoped(ctx context.Context)(*client.Client,error){
 if r==nil || r.owner==nil || r.sourceID==0 || r.runID=="" {return nil,fmt.Errorf("source writer not configured")}
 r.mu.Lock()
 defer r.mu.Unlock()
 if r.writer!=nil && time.Until(r.expires)>10*time.Minute {return r.writer,nil}
 grant,err:=r.owner.SourceRunWriteGrant(ctx,r.sourceID,r.runID)
 if err!=nil {return nil,err}
 writer:=client.New(r.owner.BaseURL,grant.AccessToken)
 writer.HTTP=r.owner.HTTP
 r.writer=writer
 r.expires=grant.ExpiresAt
 return writer,nil
}

func (r *RunScopedExecution) List(ctx context.Context,parentID uint64)([]client.Node,error){
 c,err:=r.scoped(ctx);if err!=nil{return nil,err}
 return c.List(ctx,parentID)
}
func (r *RunScopedExecution) CreateDir(ctx context.Context,parentID uint64,name string)(client.Node,error){
 c,err:=r.scoped(ctx);if err!=nil{return client.Node{},err}
 return c.CreateDir(ctx,parentID,name)
}
func (r *RunScopedExecution) RenameMove(ctx context.Context,id,revision uint64,name *string,parentID *uint64)(client.Node,error){
 c,err:=r.scoped(ctx);if err!=nil{return client.Node{},err}
 return c.RenameMove(ctx,id,revision,name,parentID)
}
func (r *RunScopedExecution) UploadFileResumableResult(ctx context.Context,parentID uint64,path,name string,progress client.UploadProgress)(client.UploadResult,error){
 c,err:=r.scoped(ctx);if err!=nil{return client.UploadResult{},err}
 return c.UploadFileResumableResult(ctx,parentID,path,name,progress)
}
func (r *RunScopedExecution) OverwriteFileResumableResult(ctx context.Context,nodeID,revision uint64,path string,progress client.UploadProgress)(client.UploadResult,error){
 c,err:=r.scoped(ctx);if err!=nil{return client.UploadResult{},err}
 return c.OverwriteFileResumableResult(ctx,nodeID,revision,path,progress)
}

var _ ExecutionAPI = (*RunScopedExecution)(nil)
