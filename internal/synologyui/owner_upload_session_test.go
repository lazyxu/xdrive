package synologyui

import (
  "fmt"
  "net/http"
  "net/http/httptest"
  "strings"
  "testing"
)

func TestDSMOwnerChunkUploadStrictValidation(t *testing.T) {
  owner:=strings.Repeat("a",64)
  id:="f6cfbf4d-4dda-4992-92a8-b7c502a6809a"
  create:=func(path,body string)error{
    req:=httptest.NewRequest(http.MethodPost,"https://nas.example/v1/"+path,strings.NewReader(body))
    _,err:=parseDSMOwnerLargeUpload(req)
    return err
  }
  good:=fmt.Sprintf(`{"owner_scope":%q,"parent_id":7,"name":"photo.mov","size":8388608}`,owner)
  if err:=create("cloud-upload-start",good);err!=nil{t.Fatal(err)}
  negative:=map[string]string{
    "missing-owner":strings.Replace(good,owner,"",1),
    "small-upload":strings.Replace(good,"8388608","1024",1),
    "old-crypto-payload":strings.TrimSuffix(good,"}")+`,"vault":"old"}`,
    "invalid-name":strings.Replace(good,"photo.mov","../x",1),
  }
  for name,payload:=range negative{
    t.Run(name,func(t *testing.T){if create("cloud-upload-start",payload)==nil{t.Fatal("unsafe upload admitted")}})
  }
  finish:=fmt.Sprintf(`{"owner_scope":%q,"parent_id":7,"name":"photo.mov","size":8388608,"id":%q}`,owner,id)
  if err:=create("cloud-upload-finish",finish);err!=nil{t.Fatal(err)}
  if err:=create("cloud-upload-abort",fmt.Sprintf(`{"owner_scope":%q,"id":%q}`,owner,id));err!=nil{t.Fatal(err)}
  if create("cloud-upload-part",fmt.Sprintf(`{"owner_scope":%q,"id":%q,"index":0,"sha256":"bad","data":"AA=="}`,owner,id))==nil{
    t.Fatal("invalid chunk digest accepted")
  }
  if !isDSMOwnerLargeUploadPath("/v1/cloud-upload-part")||
    isDSMOwnerLargeUploadPath("/v1/cloud-upload-generic") {t.Fatal("unsafe route")}
}
