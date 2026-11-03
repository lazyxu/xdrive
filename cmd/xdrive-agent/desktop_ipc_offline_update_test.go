package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

const testOfflineID = "0123456789abcdef0123456789abcdef"
const testOfflineName = "xdrive-app-aaaaaaaaaaaa.tar.gz"

type fakeOfflineUpdateIPC struct {
	*fakeDesktopIPCController
	calls []string
	lastChunk []byte
	lastIndex uint32
	lastManifest string
	lastBinary string
	lastBackup bool
}

func (f *fakeOfflineUpdateIPC) CloudOfflineImportList(context.Context) (client.OfflineImportList, error) {
	f.calls = append(f.calls, "list")
	return client.OfflineImportList{Items: []client.OfflineImportSummary{{ID: testOfflineID}}}, nil
}
func (f *fakeOfflineUpdateIPC) CloudOfflineImportCreate(context.Context) (client.OfflineImportCreated, error) {
	f.calls = append(f.calls, "create")
	return client.OfflineImportCreated{ID: testOfflineID, ChunkBytes: client.OfflineImportChunkBytes}, nil
}
func (f *fakeOfflineUpdateIPC) CloudOfflineImportGet(_ context.Context, id string) (client.OfflineImportStatus, error) {
	f.calls = append(f.calls, "get:"+id)
	return client.OfflineImportStatus{ID: id, ChunkBytes: client.OfflineImportChunkBytes}, nil
}
func (f *fakeOfflineUpdateIPC) CloudOfflineImportRegister(_ context.Context, id,name string,size int64,digest string) error {
	f.calls = append(f.calls, fmt.Sprintf("register:%s:%s:%d:%s",id,name,size,digest))
	return nil
}
func (f *fakeOfflineUpdateIPC) CloudOfflineImportChunk(_ context.Context,id,name string,index uint32,data []byte,digest string) error {
	f.calls = append(f.calls, fmt.Sprintf("chunk:%s:%s:%d:%s",id,name,index,digest))
	f.lastChunk = append([]byte(nil),data...)
	f.lastIndex = index
	return nil
}
func (f *fakeOfflineUpdateIPC) CloudOfflineImportFinalize(_ context.Context,id,name string) (client.OfflineImportFinalized,error) {
	f.calls = append(f.calls, "finalize:"+id+":"+name)
	return client.OfflineImportFinalized{Name:name,State:"ready"},nil
}
func (f *fakeOfflineUpdateIPC) CloudOfflineImportDelete(_ context.Context,id string) error {
	f.calls = append(f.calls,"delete:"+id)
	return nil
}
func (f *fakeOfflineUpdateIPC) CloudStartOfflineServerUpdate(_ context.Context,id,manifest,binary string,backup bool) (client.ServerUpdateState,error) {
	f.calls = append(f.calls,"activate:"+id)
	f.lastManifest = manifest
	f.lastBinary = binary
	f.lastBackup = backup
	return client.ServerUpdateState{Supported:true,State:"queued",Source:"offline",Channel:"master"},nil
}

func TestDesktopIPCOfflineImportRejectsUnsafeTargetsWithoutControllerCall(t *testing.T){
	f:=&fakeOfflineUpdateIPC{fakeDesktopIPCController:&fakeDesktopIPCController{}}
	h:=newDesktopIPCHandler(f,"secret",func(){})
	for _,tc:=range []struct{method,path,body string}{
		{"GET","/v1/server-offline-imports/traversal",""},
		{"DELETE","/v1/server-offline-imports/..",""},
		{"GET","/v1/server-offline-imports/FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",""},
		{"POST","/v1/server-offline-imports/"+testOfflineID+"/files/evil.sh",`{"name":"evil.sh","size":12}`},
		{"POST","/v1/server-offline-imports/"+testOfflineID+"/files/manifest.json",`{"name":"manifest.json","size":-1}`},
		{"POST","/v1/server-offline-imports/"+testOfflineID+"/files/manifest.json",`{"name":"other.json","size":12}`},
		{"POST","/v1/server-offline-imports/"+testOfflineID+"/files/manifest.json",`{"name":"manifest.json","size":10,"command":"docker exec"}`},
		{"POST","/v1/server-offline-imports/"+testOfflineID+"/activate",`{"trusted_manifest_sha256":"bad","trusted_installer_sha256":"bad"}`},
	}{
		t.Run(tc.path+"/"+tc.body,func(t *testing.T){
			res:=desktopIPCRequest(t,h,tc.method,tc.path,tc.body)
			if res.Code<400 {t.Fatalf("unsafe input accepted: %d %s",res.Code,res.Body.String())}
		})
	}
	if len(f.calls)!=0{t.Fatalf("unsafe input reached controller: %+v",f.calls)}
}

func TestDesktopIPCOfflineImportFixedBridgeAndChunkHash(t *testing.T){
	f:=&fakeOfflineUpdateIPC{fakeDesktopIPCController:&fakeDesktopIPCController{}}
	h:=newDesktopIPCHandler(f,"secret",func(){})
	for _,tc:=range []struct{method,path,body string; status int}{
		{"GET","/v1/server-offline-imports","",200},
		{"POST","/v1/server-offline-imports","",201},
		{"GET","/v1/server-offline-imports/"+testOfflineID,"",200},
		{"POST","/v1/server-offline-imports/"+testOfflineID+"/files/"+testOfflineName,
			fmt.Sprintf(`{"name":%q,"size":1048576}`,testOfflineName),200},
		{"POST","/v1/server-offline-imports/"+testOfflineID+"/files/"+testOfflineName+"/finalize","",200},
		{"POST","/v1/server-offline-imports/"+testOfflineID+"/activate",
			fmt.Sprintf(`{"trusted_manifest_sha256":%q,"trusted_installer_sha256":%q,"backup_file_data":true}`,
				strings.Repeat("a",64),strings.Repeat("b",64)),202},
		{"DELETE","/v1/server-offline-imports/"+testOfflineID,"",204},
	}{
		res:=desktopIPCRequest(t,h,tc.method,tc.path,tc.body)
		if res.Code!=tc.status{t.Fatalf("%s %s status=%d body=%s",tc.method,tc.path,res.Code,res.Body.String())}
	}
	if f.lastManifest!=strings.Repeat("a",64)||f.lastBinary!=strings.Repeat("b",64)||!f.lastBackup{
		t.Fatal("independent Host trust options lost")
	}
	chunk:=bytes.Repeat([]byte("x"),client.OfflineImportChunkBytes)
	sum:=sha256.Sum256(chunk)
	sha:=hex.EncodeToString(sum[:])
	req:=httptest.NewRequest(http.MethodPut,
		"http://127.0.0.1/v1/server-offline-imports/"+testOfflineID+
			"/files/"+testOfflineName+"/chunks/0",bytes.NewReader(chunk))
	req.RemoteAddr="127.0.0.1:45100"
	req.Header.Set("Authorization","Bearer secret")
	req.Header.Set("Content-Type","application/octet-stream")
	req.Header.Set("X-XDrive-Chunk-SHA256",sha)
	res:=httptest.NewRecorder()
	h.ServeHTTP(res,req)
	if res.Code!=200||len(f.lastChunk)!=len(chunk)||f.lastIndex!=0{
		t.Fatalf("valid chunk status=%d size=%d",res.Code,len(f.lastChunk))
	}
	before:=len(f.calls)
	req=httptest.NewRequest(http.MethodPut,
		"http://127.0.0.1/v1/server-offline-imports/"+testOfflineID+
			"/files/"+testOfflineName+"/chunks/0",bytes.NewReader(chunk))
	req.RemoteAddr="127.0.0.1:45100"
	req.Header.Set("Authorization","Bearer secret")
	req.Header.Set("X-XDrive-Chunk-SHA256",strings.Repeat("0",64))
	res=httptest.NewRecorder()
	h.ServeHTTP(res,req)
	if res.Code!=http.StatusUnprocessableEntity||len(f.calls)!=before{
		t.Fatalf("mismatched SHA reached controller: %d",res.Code)
	}
	tooLarge:=make([]byte,client.OfflineImportChunkBytes+1)
	req=httptest.NewRequest(http.MethodPut,
		"http://127.0.0.1/v1/server-offline-imports/"+testOfflineID+
			"/files/"+testOfflineName+"/chunks/0",bytes.NewReader(tooLarge))
	req.RemoteAddr="127.0.0.1:45100"
	req.Header.Set("Authorization","Bearer secret")
	req.Header.Set("X-XDrive-Chunk-SHA256",sha)
	res=httptest.NewRecorder()
	h.ServeHTTP(res,req)
	if res.Code!=http.StatusBadRequest||len(f.calls)!=before{
		t.Fatalf("oversize chunk reached controller: %d",res.Code)
	}
}

func TestDesktopIPCOfflineImportRequiresAgentCapabilityAndBearer(t *testing.T){
	legacy:=newDesktopIPCHandler(&fakeDesktopIPCController{},"secret",func(){})
	res:=desktopIPCRequest(t,legacy,http.MethodGet,"/v1/server-offline-imports","")
	if res.Code!=http.StatusNotImplemented{t.Fatalf("legacy Agent must fail closed: %d",res.Code)}
	f:=&fakeOfflineUpdateIPC{fakeDesktopIPCController:&fakeDesktopIPCController{}}
	h:=newDesktopIPCHandler(f,"secret",func(){})
	request:=httptest.NewRequest(http.MethodGet,"http://127.0.0.1/v1/server-offline-imports",nil)
	request.RemoteAddr="127.0.0.1:45200"
	res=httptest.NewRecorder()
	h.ServeHTTP(res,request)
	if res.Code!=http.StatusUnauthorized||len(f.calls)!=0{t.Fatalf("missing IPC bearer accepted: %d",res.Code)}
}
