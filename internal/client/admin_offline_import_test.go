package client

import (
	"context"
	"strings"
	"testing"
)

func TestOfflineImportClientRejectsArbitraryHostPaths(t *testing.T) {
	for _,id:=range []string{"../other", "a/b", strings.Repeat("A",32), strings.Repeat("a",31), ""} {
		if _,err:=offlineImportPath(id);err==nil{
			t.Fatalf("untrusted offline Host path accepted: %q",id)
		}
	}
	id:=strings.Repeat("a",32)
	for _,name:=range []string{"../manifest.json","some-file.sh","xdrive-offline.py","xdrive-app-latest.tar.gz","offline.zip",""} {
		if _,err:=offlineFilePath(id,name);err==nil {
			t.Fatalf("untrusted offline filename accepted: %q",name)
		}
	}
	for _,name:=range []string{"manifest.json","xdrive-offline-linux-amd64","delivery.json",
		"xdrive-app-"+strings.Repeat("b",12)+".tar.gz"} {
		if _,err:=offlineFilePath(id,name);err!=nil {
			t.Fatalf("valid offline file rejected %q: %v",name,err)
		}
	}
}

func TestOfflineImportClientRejectsMalformedChunksAndTrustBeforeNetwork(t *testing.T) {
	ctx:=context.Background()
	id:=strings.Repeat("a",32)
	cli:=&Client{}
	validSHA:=strings.Repeat("b",64)
	for _,test:=range []struct{
		name string
		chunk []byte
		index int
		sha string
	}{
		{"no bytes",nil,0,validSHA},
		{"negative index",[]byte("one"),-1,validSHA},
		{"index overflow",[]byte("one"),1<<21,validSHA},
		{"malformed digest",[]byte("one"),0,"../../bad"},
		{"mismatched digest",[]byte("one"),0,validSHA},
		{"oversized chunk",make([]byte,OfflineImportChunkBytes+1),0,validSHA},
	}{
		t.Run(test.name,func(t *testing.T){
			if err:=cli.AdminOfflineImportChunk(ctx,id,"manifest.json",test.index,test.chunk,test.sha);err==nil{
				t.Fatal("malformed offline chunk crossed the client authorization boundary")
			}
		})
	}
	if _,err:=cli.AdminOfflineImportStart(ctx,id,validSHA,"evil",false);err==nil {
		t.Fatal("untrusted Go ELF hash accepted")
	}
	if _,err:=cli.AdminOfflineImportStart(ctx,"/etc",validSHA,validSHA,false);err==nil {
		t.Fatal("untrusted Host path accepted")
	}
	if err:=cli.AdminOfflineImportRegister(ctx,id,"evil.sh",99,"");err==nil{
		t.Fatal("arbitrary installer filename accepted")
	}
}
