package localbackupipc

import (
  "context"
  "errors"
  "net/http"

  "github.com/google/uuid"
  "github.com/lazyxu/xdrive/internal/client"
)

type OwnerLargeUploadSession struct {
  ID string `json:"id"`
  Size int64 `json:"size"`
  ChunkSize int64 `json:"chunk_size"`
  ChunkCount int `json:"chunk_count"`
}

func validOwnerLargeUploadSessionID(id string) bool {
  parsed,err:=uuid.Parse(id)
  return err==nil&&parsed.String()==id
}
func (c *Client) requireLargeUpload() error {
  if c==nil||!hasCapability(c.capabilities,"cloud-owner-chunk-upload") {
    return errors.New("owning Agent large upload unavailable")
  }
  return nil
}
func (c *Client) OwnerLargeUploadStart(ctx context.Context, parentID uint64, name string, size int64) (OwnerLargeUploadSession,error) {
  if err:=c.requireLargeUpload();err!=nil {return OwnerLargeUploadSession{},err}
  if !ValidOwnerFileID(parentID)||!ValidOwnerFolderName(name)||size<=4<<20||size>16<<30 {
    return OwnerLargeUploadSession{},errors.New("invalid large upload start")
  }
  var out OwnerLargeUploadSession
  err:=c.request(ctx,http.MethodPost,"/v1/cloud/owner-upload/start",map[string]any{
    "parent_id":parentID,"name":name,"size":size,
  },&out)
  if err!=nil{return OwnerLargeUploadSession{},err}
  if !validOwnerLargeUploadSessionID(out.ID)||out.Size!=size||out.ChunkSize!=4<<20||
    out.ChunkCount!=int((size+out.ChunkSize-1)/out.ChunkSize) {
    return OwnerLargeUploadSession{},errors.New("unverified Owner large upload start")
  }
  return out,nil
}
func (c *Client) OwnerLargeUploadPart(ctx context.Context,id string,index int,digest string,data []byte) (client.UploadPart,error) {
  if err:=c.requireLargeUpload();err!=nil{return client.UploadPart{},err}
  if !validOwnerLargeUploadSessionID(id)||index<0||len(data)==0||len(data)>4<<20 {
    return client.UploadPart{},errors.New("invalid Owner upload part")
  }
  var out client.UploadPart
  err:=c.request(ctx,http.MethodPost,"/v1/cloud/owner-upload/part",map[string]any{
    "id":id,"index":index,"sha256":digest,"data":data,
  },&out)
  if err!=nil{return client.UploadPart{},err}
  if out.Index!=index||out.Size!=int64(len(data))||out.SHA256!=digest{
    return client.UploadPart{},errors.New("unverified Owner upload chunk receipt")
  }
  return out,nil
}
func (c *Client) OwnerLargeUploadFinish(ctx context.Context,id string,parentID uint64,name string,size int64) (OwnerFileNode,error) {
  if err:=c.requireLargeUpload();err!=nil{return OwnerFileNode{},err}
  if !validOwnerLargeUploadSessionID(id)||!ValidOwnerFileID(parentID)||!ValidOwnerFolderName(name)||size<=4<<20{
    return OwnerFileNode{},errors.New("invalid Owner finalize request")
  }
  var raw client.Node
  err:=c.request(ctx,http.MethodPost,"/v1/cloud/owner-upload/finish",map[string]any{"id":id},&raw)
  if err!=nil{return OwnerFileNode{},err}
  projected,err:=ownerFileNode(raw,&parentID)
  if err!=nil||projected.Type!="file"||projected.Name!=name||projected.Size!=size {
    return OwnerFileNode{},errors.New("unverified Owner large upload receipt")
  }
  return projected,nil
}
func (c *Client) OwnerLargeUploadAbort(ctx context.Context,id string) error {
  if err:=c.requireLargeUpload();err!=nil{return err}
  if !validOwnerLargeUploadSessionID(id){return errors.New("invalid upload session")}
  var out struct{Aborted bool `json:"aborted"`}
  if err:=c.request(ctx,http.MethodPost,"/v1/cloud/owner-upload/abort",map[string]any{"id":id},&out);err!=nil{return err}
  if !out.Aborted{return errors.New("Owner upload abort not confirmed")}
  return nil
}
