package offlinebundle

// Verified Docker image identities are independent of the Docker image store.
// Classic Docker reports a config digest; containerd-backed Docker may report
// the manifest or OCI index digest. All accepted identities must be linked to
// the signed image reference by a bounded, fully hashed archive chain.
import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"context"
)

const (
	maxImageEntries = 4096
	maxImageBytes = int64(16) << 30
	maxJSONEntry = 1 << 20
	maxJSONTotal = 16 << 20
	ociManifest = "application/vnd.oci.image.manifest.v1+json"
	ociIndex = "application/vnd.oci.image.index.v1+json"
	dockerManifest = "application/vnd.docker.distribution.manifest.v2+json"
	dockerIndex = "application/vnd.docker.distribution.manifest.list.v2+json"
)

type imageTarEntry struct {
	Size int64
	Digest string
	Data []byte
	Directory bool
}
type ImageIdentity struct {
	Config string
	Descriptors []string
}
type dockerSaveManifest struct {
	Config string `json:"Config"`
	RepoTags []string `json:"RepoTags"`
	Layers []string `json:"Layers"`
}
type imageConfig struct {
	OS string `json:"os"`
	Architecture string `json:"architecture"`
	Variant string `json:"variant"`
	RootFS struct{
		Type string `json:"type"`
		DiffIDs []string `json:"diff_ids"`
	} `json:"rootfs"`
}
type ociDocument struct{
	SchemaVersion int `json:"schemaVersion"`
	MediaType string `json:"mediaType"`
	Manifests []ociDescriptor `json:"manifests"`
	Config ociDescriptor `json:"config"`
	Layers []ociDescriptor `json:"layers"`
}
type ociDescriptor struct{
	Digest string `json:"digest"`
	MediaType string `json:"mediaType"`
	Size int64 `json:"size"`
	Annotations map[string]string `json:"annotations"`
	Platform *struct{
		OS string `json:"os"`
		Architecture string `json:"architecture"`
		Variant string `json:"variant"`
	} `json:"platform"`
}

func scanImageArchive(filename string)(map[string]imageTarEntry,error){
	f,_,err:=SafeFile(filename);if err!=nil{return nil,err}
	defer f.Close()
	gz,err:=gzip.NewReader(f);if err!=nil{return nil,fail("invalid Docker archive gzip")}
	defer gz.Close()
	t:=tar.NewReader(gz)
	result:=map[string]imageTarEntry{}
	var total int64
	retained:=0
	for{
		h,err:=t.Next()
		if err==io.EOF{break}
		if err!=nil{return nil,fail("invalid Docker archive tar: %v",err)}
		if !SafeMember(h.Name)||len(result)>=maxImageEntries {
			return nil,fail("unsafe or excessive Docker image entries")
		}
		if _,ok:=result[h.Name];ok{return nil,fail("duplicate Docker image member")}
		if h.Size<0||h.Size>maxImageBytes-total-512{return nil,fail("Docker image exceeds byte limit")}
		total+=h.Size+512
		if h.Typeflag==tar.TypeDir{
			if h.Size!=0{return nil,fail("invalid Docker image directory")}
			result[h.Name]=imageTarEntry{Directory:true}
			continue
		}
		if h.Typeflag!=tar.TypeReg&&h.Typeflag!=tar.TypeRegA{
			return nil,fail("unsafe Docker image tar entry type")
		}
		hash:=sha256.New()
		var data []byte
		if h.Size<=maxJSONEntry{
			// Bounded metadata may be indexed later by its content digest.
			// Keep only JSON-like documents, never an unbounded image layer.
			small:=make([]byte,h.Size)
			if _,err:=io.ReadFull(t,small);err!=nil{return nil,err}
			hash.Write(small)
			if trimmed:=bytes.TrimSpace(small);len(trimmed)>0&&(trimmed[0]=='{'||trimmed[0]=='['){
				retained+=len(small)
				if retained>maxJSONTotal{return nil,fail("excessive Docker image JSON metadata")}
				data=small
			}
		}else{
			if _,err:=io.CopyN(hash,t,h.Size);err!=nil{return nil,err}
		}
		result[h.Name]=imageTarEntry{Size:h.Size,Digest:"sha256:"+hex.EncodeToString(hash.Sum(nil)),Data:data}
	}
	if _,err:=io.Copy(io.Discard,gz);err!=nil{return nil,fail("Docker archive gzip checksum mismatch")}
	return result,nil
}
func imageJSON(entries map[string]imageTarEntry,name string,v any)error{
	entry,ok:=entries[name]
	if !ok||entry.Directory||len(entry.Data)==0{return fail("missing or oversized Docker image metadata: %s",name)}
	if err:=rejectDuplicateKeys(entry.Data);err!=nil{return err}
	if err:=json.Unmarshal(entry.Data,v);err!=nil{return fail("invalid Docker image JSON: %s",name)}
	return nil
}
func CanonicalImageReference(reference string)(string,error){
	if !refPattern.MatchString(reference){return "",fail("invalid Docker image reference")}
	parts:=strings.Split(reference,"/")
	if len(parts)==1{return "docker.io/library/"+reference,nil}
	if parts[0]=="docker.io" {
		if len(parts)==2{return "docker.io/library/"+parts[1],nil}
		return reference,nil
	}
	if !strings.ContainsAny(parts[0],".:")&&parts[0]!="localhost"{
		return "docker.io/"+reference,nil
	}
	return reference,nil
}
func imageRefMatches(candidate,expected string)bool{
	got,err:=CanonicalImageReference(candidate)
	return err==nil&&got==expected
}
func imageNameAnnotationsMatch(annotations map[string]string,expected,tag string,top bool)bool{
	if top {
		name:=annotations["io.containerd.image.name"]
		ref:=annotations["org.opencontainers.image.ref.name"]
		if !(imageRefMatches(name,expected) || (strings.ContainsAny(ref,"/:")&&imageRefMatches(ref,expected))){
			return false
		}
	}
	if name,ok:=annotations["io.containerd.image.name"];ok&&!imageRefMatches(name,expected){return false}
	if name,ok:=annotations["org.opencontainers.image.ref.name"];ok&&name!=tag&&!imageRefMatches(name,expected){return false}
	return true
}
func imagePlatformValid(platform *struct{OS string `json:"os"`; Architecture string `json:"architecture"`; Variant string `json:"variant"`})bool{
	return platform==nil || (platform.OS=="linux"&&platform.Architecture=="amd64"&&platform.Variant=="")
}
func in(value string,choices ...string)bool{for _,c:=range choices{if value==c{return true}};return false}

func ImageArchiveIdentity(archive string,image Image)(ImageIdentity,error){
	entries,err:=scanImageArchive(archive);if err!=nil{return ImageIdentity{},err}
	var saved []dockerSaveManifest
	if err:=imageJSON(entries,"manifest.json",&saved);err!=nil{return ImageIdentity{},err}
	if len(saved)!=1||len(saved[0].RepoTags)!=1{return ImageIdentity{},fail("ambiguous Docker image manifest")}
	ref,err:=CanonicalImageReference(image.Ref);if err!=nil{return ImageIdentity{},err}
	if !imageRefMatches(saved[0].RepoTags[0],ref) {return ImageIdentity{},fail("Docker archive tag differs from signed reference")}
	savedConfig:=saved[0].Config
	configEntry,ok:=entries[savedConfig]
	if !SafeMember(savedConfig)||!ok||configEntry.Directory{return ImageIdentity{},fail("missing image config")}
	var config imageConfig
	if err:=imageJSON(entries,savedConfig,&config);err!=nil{return ImageIdentity{},err}
	configID:=configEntry.Digest
	if savedConfig!=configID[7:]+".json"&&savedConfig!="blobs/sha256/"+configID[7:]{
		return ImageIdentity{},fail("image config content does not match filename")
	}
	if config.OS!="linux"||config.Architecture!="amd64"||config.Variant!=""{
		return ImageIdentity{},fail("image platform is not linux/amd64")
	}
	layers:=saved[0].Layers
	if config.RootFS.Type!="layers"||len(layers)>128||len(layers)!=len(config.RootFS.DiffIDs){
		return ImageIdentity{},fail("invalid image root filesystem identity")
	}
	for i,name:=range layers{
		if !SafeMember(name)||!imagePattern.MatchString(config.RootFS.DiffIDs[i])||
			entries[name].Digest=="" {return ImageIdentity{},fail("invalid image layer identity")}
	}
	identity:=ImageIdentity{Config:configID}
	_,hasIndex:=entries["index.json"]
	_,hasLayout:=entries["oci-layout"]
	if hasIndex||hasLayout {
		var layout map[string]string
		if err:=imageJSON(entries,"oci-layout",&layout);err!=nil{return ImageIdentity{},err}
		if len(layout)!=1||layout["imageLayoutVersion"]!="1.0.0"{
			return ImageIdentity{},fail("unsupported OCI layout")
		}
		var index ociDocument
		if err:=imageJSON(entries,"index.json",&index);err!=nil{return ImageIdentity{},err}
		tag:=image.Ref
		if i:=strings.LastIndex(tag,":");i>=0{tag=tag[i+1:]}
		manifestReached:=false
		for depth:=0;depth<8;depth++{
			if index.SchemaVersion!=2||!in(index.MediaType,"",ociIndex,dockerIndex)||len(index.Manifests)!=1{
				return ImageIdentity{},fail("ambiguous OCI image index")
			}
			d:=index.Manifests[0]
			if !imageNameAnnotationsMatch(d.Annotations,ref,tag,depth==0){
				return ImageIdentity{},fail("conflicting OCI image name or tag")
			}
			if !imagePlatformValid(d.Platform){return ImageIdentity{},fail("invalid OCI image platform")}
			if !imagePattern.MatchString(d.Digest)||
				!in(d.MediaType,ociManifest,dockerManifest,ociIndex,dockerIndex){
				return ImageIdentity{},fail("invalid OCI image descriptor")
			}
			for _,seen:=range identity.Descriptors{if seen==d.Digest{return ImageIdentity{},fail("cyclic OCI descriptor")}}
			entry,ok:=entries["blobs/sha256/"+d.Digest[7:]]
			if !ok||entry.Directory||entry.Size!=d.Size||entry.Digest!=d.Digest{
				return ImageIdentity{},fail("OCI descriptor content differs")
			}
			var next ociDocument
			if err:=imageJSON(entries,"blobs/sha256/"+d.Digest[7:],&next);err!=nil{return ImageIdentity{},err}
			if next.SchemaVersion!=2||next.MediaType!=d.MediaType{
				return ImageIdentity{},fail("OCI descriptor media type mismatch")
			}
			identity.Descriptors=append(identity.Descriptors,d.Digest)
			if in(d.MediaType,ociIndex,dockerIndex){
				index=next
				continue
			}
			if next.Config.Digest!=configID||next.Config.Size!=configEntry.Size||
				!in(next.Config.MediaType,"application/vnd.oci.image.config.v1+json","application/vnd.docker.container.image.v1+json"){
				return ImageIdentity{},fail("OCI config differs from Docker save")
			}
			if len(next.Layers)!=len(layers){return ImageIdentity{},fail("OCI layer count differs")}
			for i,layer:=range next.Layers{
				entry:=entries[layers[i]]
				if layer.Digest!=entry.Digest||layer.Size!=entry.Size||
					!in(layer.MediaType,"application/vnd.oci.image.layer.v1.tar",
						"application/vnd.oci.image.layer.v1.tar+gzip","application/vnd.docker.image.rootfs.diff.tar.gzip"){
					return ImageIdentity{},fail("OCI layers differ from Docker save")
				}
				if layer.MediaType=="application/vnd.oci.image.layer.v1.tar" &&
					layer.Digest!=config.RootFS.DiffIDs[i] {
					return ImageIdentity{},fail("uncompressed image layer differs")
				}
			}
			manifestReached=true
			break
		}
		if !manifestReached{return ImageIdentity{},fail("OCI descriptor chain too deep")}
	}else{
		for i,name:=range layers{
			if entries[name].Digest!=config.RootFS.DiffIDs[i]{
				return ImageIdentity{},fail("classic Docker layer differs from config rootfs")
			}
		}
	}
	if image.ID!=identity.Config {
		found:=false
		for _,v:=range identity.Descriptors{if v==image.ID{found=true}}
		if !found{return ImageIdentity{},fail("signed image identity is not linked to archive")}
	}
	return identity,nil
}

// LoadVerifiedImage only invokes Docker after verifying the signed archive
// reference, content, platform and possible OCI descriptor chain.
func LoadVerifiedImage(ctx context.Context,archive string,signed Image)error{
	id,err:=ImageArchiveIdentity(archive,signed);if err!=nil{return err}
	run:=func(args ...string)(string,error){
		c:=exec.CommandContext(ctx,"docker",args...)
		c.Stdin=nil
		output,err:=c.CombinedOutput()
		if err!=nil{return "",fail("Docker command failed (%s): %v",args[0],err)}
		return strings.TrimSpace(string(output)),nil
	}
	if _,err:=run("load","-i",archive);err!=nil{return err}
	actual,err:=run("image","inspect","--format","{{.Id}}",signed.Ref)
	if err!=nil{return err}
	if actual!=id.Config{
		found:=false
		for _,v:=range id.Descriptors{if actual==v{found=true}}
		if !found{return fail("imported Docker image identity mismatch: %s",signed.Ref)}
	}
	fmt.Printf("[offline] imported %s\n",signed.Ref)
	return nil
}
