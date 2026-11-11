package main

import (
  "context"
  "crypto/sha256"
  "encoding/hex"
  "net/http"
  "strings"

  "github.com/google/uuid"
  "github.com/lazyxu/xdrive/internal/client"
  "github.com/lazyxu/xdrive/internal/localbackupipc"
)

type ownerLargeUploadControl interface {
  CloudOwnerLargeUploadStart(ctx context.Context, parent uint64, name string, size int64) (localbackupipc.OwnerLargeUploadSession, error)
  CloudOwnerLargeUploadPart(ctx context.Context, id string, index int, sha string, bytes []byte) (client.UploadPart, error)
  CloudOwnerLargeUploadFinish(ctx context.Context, id string) (client.Node, error)
  CloudOwnerLargeUploadAbort(ctx context.Context, id string) error
}

func (h *desktopIPCHandler) largeUploadPort(w http.ResponseWriter) (ownerLargeUploadControl, bool) {
  port, ok := h.ctrl.(ownerLargeUploadControl)
  if !ok {
    writeDesktopIPCError(w, http.StatusNotImplemented, "owner_upload_unavailable", "Owner large upload unavailable")
  }
  return port, ok
}

func (h *desktopIPCHandler) cloudOwnerLargeUploadStart(w http.ResponseWriter, r *http.Request) {
  port, ok := h.largeUploadPort(w)
  if !ok { return }
  var input struct {
    ParentID uint64 `json:"parent_id"`
    Name string `json:"name"`
    Size int64 `json:"size"`
  }
  if !decodeDesktopIPCJSONLimit(w,r,&input,2048) { return }
  if !localbackupipc.ValidOwnerFileID(input.ParentID) ||
    !localbackupipc.ValidOwnerFolderName(input.Name) ||
    input.Size <= 4<<20 || input.Size > ownerLargeUploadMaxBytes {
    writeDesktopIPCError(w, http.StatusBadRequest, "invalid_upload", "invalid Owner upload start")
    return
  }
  result, err := port.CloudOwnerLargeUploadStart(r.Context(), input.ParentID, input.Name, input.Size)
  if err != nil {
    writeDesktopIPCControllerError(w,err);return
  }
  writeDesktopIPCJSON(w,http.StatusCreated,result)
}

func (h *desktopIPCHandler) cloudOwnerLargeUploadPart(w http.ResponseWriter, r *http.Request) {
  port, ok := h.largeUploadPort(w)
  if !ok { return }
  var input struct {
    ID string `json:"id"`
    Index int `json:"index"`
    SHA256 string `json:"sha256"`
    Data []byte `json:"data"`
  }
  if r.ContentLength > 6<<20 || r.ContentLength < 2 ||
    !decodeDesktopIPCJSONLimit(w,r,&input,6<<20) { return }
  id, err := uuid.Parse(input.ID)
  if err != nil || id.String() != input.ID || input.Index < 0 ||
    len(input.Data)==0 || len(input.Data)>4<<20 || len(input.SHA256)!=64 ||
    strings.ToLower(input.SHA256)!=input.SHA256 {
    writeDesktopIPCError(w,http.StatusBadRequest,"invalid_upload_chunk","invalid Owner upload chunk")
    return
  }
  digest:=sha256.Sum256(input.Data)
  if hex.EncodeToString(digest[:])!=input.SHA256 {
    writeDesktopIPCError(w,http.StatusBadRequest,"invalid_upload_chunk","Owner upload digest mismatch")
    return
  }
  result, err := port.CloudOwnerLargeUploadPart(r.Context(),input.ID,input.Index,input.SHA256,input.Data)
  if err != nil { writeDesktopIPCControllerError(w,err);return }
  writeDesktopIPCJSON(w,http.StatusOK,result)
}

func (h *desktopIPCHandler) cloudOwnerLargeUploadFinish(w http.ResponseWriter, r *http.Request) {
  port, ok := h.largeUploadPort(w)
  if !ok { return }
  var input struct { ID string `json:"id"` }
  if !decodeDesktopIPCJSONLimit(w,r,&input,1024) { return }
  id,err:=uuid.Parse(input.ID)
  if err!=nil||id.String()!=input.ID {
    writeDesktopIPCError(w,http.StatusBadRequest,"invalid_upload_id","invalid Owner upload ID");return
  }
  node,err:=port.CloudOwnerLargeUploadFinish(r.Context(),input.ID)
  if err!=nil { writeDesktopIPCControllerError(w,err);return }
  writeDesktopIPCJSON(w,http.StatusOK,node)
}

func (h *desktopIPCHandler) cloudOwnerLargeUploadAbort(w http.ResponseWriter, r *http.Request) {
  port, ok := h.largeUploadPort(w)
  if !ok { return }
  var input struct { ID string `json:"id"` }
  if !decodeDesktopIPCJSONLimit(w,r,&input,1024) { return }
  id,err:=uuid.Parse(input.ID)
  if err!=nil||id.String()!=input.ID {
    writeDesktopIPCError(w,http.StatusBadRequest,"invalid_upload_id","invalid Owner upload ID");return
  }
  if err:=port.CloudOwnerLargeUploadAbort(r.Context(),input.ID);err!=nil {
    writeDesktopIPCControllerError(w,err);return
  }
  writeDesktopIPCJSON(w,http.StatusOK,map[string]bool{"aborted":true})
}
