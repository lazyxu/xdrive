package api
import(
  "encoding/base64"
  "strings"
  "testing"
  "github.com/google/uuid"
  "github.com/lazyxu/xdrive/internal/meta"
)
func TestClipboardTargetedEnvelopeAndFileRefValidation(t *testing.T){
  nonce:=base64.StdEncoding.EncodeToString(make([]byte,12))
  ct:=base64.StdEncoding.EncodeToString(make([]byte,32))
  original:=clipboardWriteRequest{ClientEventID:uuid.NewString(),Kind:"text/plain",Nonce:nonce,Ciphertext:ct}
  if validateClipboardWrite(original)!=nil{t.Fatal("original text rejected")}
  target:=original
  target.TargetDeviceID=uuid.NewString()
  target.EphemeralKey=base64.StdEncoding.EncodeToString([]byte(strings.Repeat("a",32)))
  target.WrappedKey=base64.StdEncoding.EncodeToString([]byte(strings.Repeat("b",60)))
  if validateClipboardWrite(target)!=nil{t.Fatal("target rejected")}
  bad:=[]clipboardWriteRequest{
    func()clipboardWriteRequest{v:=target;v.WrappedKey="";return v}(),
    func()clipboardWriteRequest{v:=target;v.EphemeralKey="";return v}(),
    func()clipboardWriteRequest{v:=target;v.TargetDeviceID="wrong";return v}(),
    func()clipboardWriteRequest{v:=original;v.WrappedKey=target.WrappedKey;return v}(),
    func()clipboardWriteRequest{v:=original;v.NodeID=34;return v}(),
    func()clipboardWriteRequest{v:=original;v.Kind="image/x-xdrive-node-ref";return v}(),
  }
  for _,v:=range bad{if validateClipboardWrite(v)==nil{t.Fatalf("unsafe item accepted: %+v",v)}}
  node:=original;node.Kind="image/x-xdrive-node-ref";node.NodeID=34
  if validateClipboardWrite(node)!=nil{t.Fatal("image Node ref rejected")}
  node.Kind="application/x-xdrive-node-ref"
  if validateClipboardWrite(node)!=nil{t.Fatal("file Node ref rejected")}
  if clipboardValidPublicKey("") || clipboardValidPublicKey(base64.StdEncoding.EncodeToString(make([]byte,32))){
    t.Fatal("invalid X25519 key accepted")
  }
  if !clipboardValidPublicKey(target.EphemeralKey){t.Fatal("valid key rejected")}
  record:=meta.ClipboardItem{Kind:original.Kind,Nonce:nonce,Ciphertext:ct}
  if !clipboardSameItem(record,original)||clipboardSameItem(record,target){t.Fatal("idempotency confused target")}
}
