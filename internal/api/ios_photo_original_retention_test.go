package api

import (
    "archive/zip"
    "bytes"
    "context"
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "fmt"
    "hash/crc32"
    "os"
    "path/filepath"
    "strings"
    "testing"

    "github.com/google/uuid"
    "github.com/lazyxu/xdrive/internal/storage"
)

func TestIOSPhotoOriginalHoldRejectsHistoricalAndUnboundInputs(t *testing.T) {
    good := iosPhotoHoldRequest{
        NodeID: 7, NodeRevision: 1, SessionID: uuid.NewString(),
        SHA256: strings.Repeat("a", 64), ByteSize: 200, Kind: "image",
    }
    if !validIOSPhotoHoldRequest(good) { t.Fatal("valid current original declined") }
    cases := []struct{ name string; modify func(*iosPhotoHoldRequest) }{
        {"missing node", func(v *iosPhotoHoldRequest){v.NodeID = 0}},
        {"zero revision", func(v *iosPhotoHoldRequest){v.NodeRevision = 0}},
        {"unknown ACK", func(v *iosPhotoHoldRequest){v.SessionID = ""}},
        {"invalid digest", func(v *iosPhotoHoldRequest){v.SHA256 = "123"}},
        {"negative bytes", func(v *iosPhotoHoldRequest){v.ByteSize = -1}},
        {"oversized", func(v *iosPhotoHoldRequest){v.ByteSize = iosPhotoHoldMaximumBytes+1}},
        {"unrecognized role", func(v *iosPhotoHoldRequest){v.Kind = "preview"}},
    }
    for _, item := range cases {
        t.Run(item.name,func(t *testing.T){
            v:=good
            item.modify(&v)
            if validIOSPhotoHoldRequest(v) { t.Fatal("unsafe hold request accepted") }
        })
    }
}

func makeIOSPhotoTestZip(t *testing.T, extra bool, missingMotion bool) ([]byte, bool) {
    t.Helper()
    parts:=[]struct{role,path string; data []byte}{
        {"still", "media/still.heic", []byte("still original")},
        {"motion","media/motion.mov", []byte("motion original")},
    }
    buf:=bytes.NewBuffer(nil)
    writer:=zip.NewWriter(buf)
    resources:=make([]map[string]any,0,2)
    for _,p:=range parts {
        if missingMotion && p.role=="motion" {continue}
        header:=&zip.FileHeader{Name:p.path,Method:zip.Store}
        w,err:=writer.CreateHeader(header)
        if err!=nil{t.Fatal(err)}
        if _,err=w.Write(p.data);err!=nil{t.Fatal(err)}
        resources=append(resources,map[string]any{
            "role":p.role,"path":p.path,"originalFilename":p.path,
            "bytes":len(p.data),"crc32":fmt.Sprintf("%08x",crc32.ChecksumIEEE(p.data)),
        })
    }
    manifest,err:=json.Marshal(map[string]any{
        "format":"xdrive-live-originals","version":1,"resources":resources,
    })
    if err!=nil{t.Fatal(err)}
    w,err:=writer.CreateHeader(&zip.FileHeader{Name:"manifest.json",Method:zip.Store})
    if err!=nil{t.Fatal(err)}
    if _,err=w.Write(manifest);err!=nil{t.Fatal(err)}
    if extra {
        unexpected,err:=writer.CreateHeader(&zip.FileHeader{Name:"extra.txt",Method:zip.Store})
        if err!=nil{t.Fatal(err)}
        if _,err=unexpected.Write([]byte("not original"));err!=nil{t.Fatal(err)}
    }
    if err:=writer.Close();err!=nil{t.Fatal(err)}
    return buf.Bytes(),!missingMotion&&!extra
}

func TestIOSPhotoLivePairPhysicalManifest(t *testing.T) {
    for _,sample:=range []struct{
        name string; extra,missing bool
    }{
        {"full original pair",false,false},
        {"unexpected additional ZIP member",true,false},
        {"missing motion",false,true},
    }{
        t.Run(sample.name,func(t *testing.T){
            b,want:=makeIOSPhotoTestZip(t,sample.extra,sample.missing)
            name:=filepath.Join(t.TempDir(),"live-original.zip")
            if err:=os.WriteFile(name,b,0600);err!=nil{t.Fatal(err)}
            file,err:=os.Open(name)
            if err!=nil{t.Fatal(err)}
            defer file.Close()
            if got:=verifyIOSPhotoLivePairZIP(context.Background(),file,int64(len(b)));got!=want{
                t.Fatalf("ZIP pair: got=%v expected=%v",got,want)
            }
        })
    }
}

func TestIOSPhotoOriginalRequiresPinnedCASAndExactBytes(t *testing.T) {
    dir:=t.TempDir()
    store,err:=storage.NewLocal(dir)
    if err!=nil{t.Fatal(err)}
    payload:=[]byte("exact current photo original")
    sha:=sha256.Sum256(payload)
    hash:=hex.EncodeToString(sha[:])
    key,err:=storage.ContentAddressedKey(hash)
    if err!=nil{t.Fatal(err)}
    if _,err:=store.Put(context.Background(),key,bytes.NewReader(payload));err!=nil{t.Fatal(err)}
    server:=Server{Store:store}
    release,err:=server.verifyIOSPhotoOriginalPhysical(
        context.Background(),hash,key,int64(len(payload)),"image")
    if err!=nil||release==nil{t.Fatalf("valid pinned physical original denied: %v",err)}
    release()
    if rel,err:=server.verifyIOSPhotoOriginalPhysical(
        context.Background(),strings.Repeat("b",64),key,int64(len(payload)),"image");err==nil{
        if rel!=nil{rel()}
        t.Fatal("wrong SHA gained hold")
    }
    if rel,err:=server.verifyIOSPhotoOriginalPhysical(
        context.Background(),hash,key,int64(len(payload))+1,"image");err==nil{
        if rel!=nil{rel()}
        t.Fatal("wrong size gained hold")
    }
    if rel,err:=server.verifyIOSPhotoOriginalPhysical(
        context.Background(),hash,key,int64(len(payload)),"live");err==nil{
        if rel!=nil{rel()}
        t.Fatal("non-Live bytes granted a Live pair hold")
    }
    // An Open without the local backend's pinned CAS lease is never enough.
}
