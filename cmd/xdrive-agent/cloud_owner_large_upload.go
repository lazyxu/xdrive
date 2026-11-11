package main

import (
  "bytes"
  "context"
  "crypto/sha256"
  "encoding/hex"
  "errors"
  "fmt"
  "strings"

  "github.com/google/uuid"
  "github.com/lazyxu/xdrive/internal/client"
  "github.com/lazyxu/xdrive/internal/localbackupipc"
  "github.com/lazyxu/xdrive/internal/userconfig"
)

const ownerLargeUploadChunkBytes int64 = 4 << 20
const ownerLargeUploadMaxBytes int64 = 16 << 30

func (c *agentController) ownerLargeUploadClient() (*client.Client, userconfig.Config, error) {
  cli, cfg, err := c.cloudClient()
  if err != nil { return nil, cfg, err }
  if !clipboardCurrentAgentSession(cfg) {
    return nil, cfg, errors.New("Owner upload session changed")
  }
  return cli, cfg, nil
}

func validOwnerUploadSessionID(id string) bool {
  parsed, err := uuid.Parse(id)
  return err == nil && parsed.String() == id
}

func (c *agentController) CloudOwnerLargeUploadStart(
  ctx context.Context, parentID uint64, name string, size int64,
) (localbackupipc.OwnerLargeUploadSession, error) {
  if !localbackupipc.ValidOwnerFileID(parentID) ||
    !localbackupipc.ValidOwnerFolderName(name) || size <= 4<<20 ||
    size > ownerLargeUploadMaxBytes {
    return localbackupipc.OwnerLargeUploadSession{}, errors.New("invalid bounded Owner large upload")
  }
  cli, cfg, err := c.ownerLargeUploadClient()
  if err != nil { return localbackupipc.OwnerLargeUploadSession{}, err }
  sess, err := cli.StartUpload(ctx, client.UploadInit{
    ParentID: &parentID, Name: name, Size: size,
    ChunkSize: ownerLargeUploadChunkBytes, ConflictPolicy: client.UploadConflictPolicyFail,
  })
  if err != nil { return localbackupipc.OwnerLargeUploadSession{}, err }
  if !clipboardCurrentAgentSession(cfg) {
    return localbackupipc.OwnerLargeUploadSession{}, errors.New("Owner changed after upload start")
  }
  out := localbackupipc.OwnerLargeUploadSession{
    ID: sess.ID, Size: sess.Size, ChunkSize: sess.ChunkSize, ChunkCount: sess.ChunkCount,
  }
  if !validOwnerUploadSessionID(out.ID) || sess.ParentID == nil ||
    *sess.ParentID != parentID || sess.Name != name || sess.Status != "active" ||
    out.Size != size || out.ChunkSize != ownerLargeUploadChunkBytes ||
    out.ChunkCount != int((size+ownerLargeUploadChunkBytes-1)/ownerLargeUploadChunkBytes) {
    return localbackupipc.OwnerLargeUploadSession{}, errors.New("unverified Owner upload start")
  }
  return out, nil
}

func (c *agentController) CloudOwnerLargeUploadPart(
  ctx context.Context, id string, index int, digest string, data []byte,
) (client.UploadPart, error) {
  if !validOwnerUploadSessionID(id) || index < 0 || len(data) == 0 ||
    int64(len(data)) > ownerLargeUploadChunkBytes || len(digest) != 64 ||
    strings.ToLower(digest) != digest {
    return client.UploadPart{}, errors.New("invalid bounded upload chunk selector")
  }
  sum := sha256.Sum256(data)
  if hex.EncodeToString(sum[:]) != digest {
    return client.UploadPart{}, errors.New("upload chunk digest mismatch")
  }
  cli, cfg, err := c.ownerLargeUploadClient()
  if err != nil { return client.UploadPart{}, err }
  sess, err := cli.UploadStatus(ctx, id)
  if err != nil || sess.ID != id || sess.Status != "active" ||
    sess.ChunkSize != ownerLargeUploadChunkBytes ||
    index >= sess.ChunkCount || sess.Size <= 4<<20 {
    return client.UploadPart{}, errors.New("Owner upload session not active")
  }
  expected := sess.ChunkSize
  if index == sess.ChunkCount-1 {
    expected = sess.Size-int64(index)*sess.ChunkSize
  }
  if int64(len(data)) != expected {
    return client.UploadPart{}, errors.New("invalid Owner upload chunk size")
  }
  part, err := cli.PutUploadChunk(ctx, id, index, digest, bytes.NewReader(data))
  if err != nil || !clipboardCurrentAgentSession(cfg) {
    return client.UploadPart{}, errors.New("Owner upload chunk not confirmed")
  }
  if part.Index != index || part.Size != expected || part.SHA256 != digest {
    return client.UploadPart{}, errors.New("Owner upload chunk receipt mismatched")
  }
  return part, nil
}

func (c *agentController) CloudOwnerLargeUploadFinish(
  ctx context.Context, id string,
) (client.Node, error) {
  if !validOwnerUploadSessionID(id) { return client.Node{}, errors.New("invalid Owner upload session") }
  cli, cfg, err := c.ownerLargeUploadClient()
  if err != nil { return client.Node{}, err }
  before, err := cli.UploadStatus(ctx, id)
  if err != nil || before.ID != id || before.ParentID == nil ||
    !localbackupipc.ValidOwnerFileID(*before.ParentID) ||
    !localbackupipc.ValidOwnerFolderName(before.Name) ||
    before.Size <= 4<<20 || before.Size > ownerLargeUploadMaxBytes ||
    before.ChunkSize != ownerLargeUploadChunkBytes {
    return client.Node{}, errors.New("invalid Owner upload finalize session")
  }
  var finished client.UploadSession
  if before.Status == "finalized" && before.Result != nil {
    finished = before
  } else if before.Status == "active" {
    finished, err = cli.FinalizeUpload(ctx, id)
    if err != nil { return client.Node{}, err }
  } else {
    return client.Node{}, errors.New("Owner upload session not finalizable")
  }
  if !clipboardCurrentAgentSession(cfg) || finished.ID != id ||
    finished.Status != "finalized" || finished.Result == nil {
    return client.Node{}, errors.New("Owner upload finalization unconfirmed")
  }
  node := *finished.Result
  if node.ParentID == nil || *node.ParentID != *before.ParentID ||
    node.Name != before.Name || node.Size != before.Size ||
    node.Type != "file" || node.Revision == 0 || node.ID == 0 {
    return client.Node{}, errors.New("Owner uploaded CAS Node did not match session")
  }
  return node, nil
}

func (c *agentController) CloudOwnerLargeUploadAbort(ctx context.Context, id string) error {
  if !validOwnerUploadSessionID(id) { return errors.New("invalid Owner upload ID") }
  cli, cfg, err := c.ownerLargeUploadClient()
  if err != nil { return err }
  if err := cli.AbortUpload(ctx, id); err != nil { return err }
  if !clipboardCurrentAgentSession(cfg) { return fmt.Errorf("Owner changed after abort") }
  return nil
}
