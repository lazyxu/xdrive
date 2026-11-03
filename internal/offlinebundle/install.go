package offlinebundle

// The Go installer uses the exact same authenticated installer assets,
// Docker image identities and rollback transaction as existing Share/CLI
// updates. It never downloads scripts or pulls Docker images during activation.
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type InstallOptions struct {
	Directory string
	Workdir string
	Home string
	Components []string
	NoStart bool
	EnableMedia bool
	EnableAI bool
	UpdateSource string
	BackupFileData bool
}

type InstalledComponent struct {
	Fingerprint string `json:"fingerprint"`
	SHA256 string `json:"sha256"`
	BuildCommit string `json:"build_commit"`
}
type InstalledState struct {
	Schema int `json:"schema"`
	SourceCommit string `json:"source_commit"`
	Contracts map[string]int `json:"contracts"`
	Installed map[string]InstalledComponent `json:"installed"`
	ActiveRefs map[string]string `json:"active_refs"`
}

var pinnedPostgres = regexp.MustCompile("^xdrive/offline-postgres:sha-[a-f0-9]{12}$")
var profileNames = map[string]bool{"media-worker":true, "photo-intelligence":true, "caddy-rescue":true}

func readEnvironment(home string)(map[string]string,error){
	out:=map[string]string{}
	for _,name:=range []string{filepath.Join(home,"config",".env"),filepath.Join(home,".env")} {
		f,_,err:=SafeFile(name)
		if errors.Is(err,os.ErrNotExist){continue}
		if err!=nil {return nil,err}
		data,readErr:=io.ReadAll(io.LimitReader(f,(1<<20)+1))
		closeErr:=f.Close()
		if readErr!=nil{return nil,readErr}
		if closeErr!=nil{return nil,closeErr}
		if len(data)>1<<20{return nil,fail("configuration exceeds offline read limit")}
		for _,line:=range strings.Split(string(data),"\n"){
			key,v,ok:=strings.Cut(line,"=")
			if !ok||key==""{continue}
			out[key]=strings.Trim(strings.TrimSpace(v),`"`)
		}
		break
	}
	return out,nil
}
func selectedSet(selection []string)map[string]bool{
	m:=make(map[string]bool,len(selection))
	for _,x:=range selection{m[x]=true}
	return m
}
func activeProfiles(env map[string]string,enableMedia,enableAI bool)(map[string]bool,error){
	result:=map[string]bool{}
	for _,value:=range []string{env["COMPOSE_PROFILES"],os.Getenv("COMPOSE_PROFILES")}{
		for _,name:=range strings.Split(value,","){
			name=strings.TrimSpace(name)
			if name==""{continue}
			if !profileNames[name]{return nil,fail("unsupported Compose profile")}
			result[name]=true
		}
	}
	if enableMedia {result["media-worker"]=true}
	if enableAI {result["photo-intelligence"]=true}
	return result,nil
}
func existingState(home string)(InstalledState,error){
	filename:=filepath.Join(home,"state","offline-installed.json")
	f,info,err:=SafeFile(filename)
	if errors.Is(err,os.ErrNotExist){return InstalledState{},nil}
	if err!=nil{return InstalledState{},err}
	defer f.Close()
	if info.Size()>1<<20{return InstalledState{},fail("offline installed state too large")}
	data,err:=io.ReadAll(io.LimitReader(f,1<<20+1));if err!=nil{return InstalledState{},err}
	if err:=rejectDuplicateKeys(data);err!=nil{return InstalledState{},err}
	var state InstalledState
	if err:=json.Unmarshal(data,&state);err!=nil||state.Schema!=1{
		return InstalledState{},fail("invalid previously installed offline state")
	}
	return state,nil
}
func validateContracts(home string,m *Manifest,sel map[string]bool,profiles map[string]bool)(InstalledState,error){
	state,err:=existingState(home);if err!=nil{return state,err}
	env,err:=readEnvironment(home);if err!=nil{return state,err}
	rules:=[]struct{
		Profile,Component,RefKey string
		Keys []string
	}{
		{"media-worker","media-worker","XD_MEDIA_WORKER_IMAGE",[]string{"media_worker_api"}},
		{"photo-intelligence","ai-runtime","XD_PHOTO_FACE_IMAGE",[]string{"photo_intelligence_api","model_runtime_api"}},
	}
	for _,rule:=range rules{
		if !profiles[rule.Profile]||sel[rule.Component] {continue}
		if state.Contracts==nil||state.ActiveRefs==nil{return state,fail("enabled %s compatibility state is unknown",rule.Profile)}
		wantRef:=env[rule.RefKey]
		if wantRef==""||state.ActiveRefs[rule.Profile]!=wantRef{
			return state,fail("enabled %s image identity is unverified; supply component package",rule.Profile)
		}
		for _,k:=range rule.Keys{
			if state.Contracts[k]==0||m.Contracts[k]==0||state.Contracts[k]!=m.Contracts[k]{
				return state,fail("enabled %s compatibility differs; supply component package",rule.Profile)
			}
		}
	}
	return state,nil
}
func docker(ctx context.Context,args ...string)(string,error){
	command:=exec.CommandContext(ctx,"docker",args...)
	command.Stdin=nil
	output,err:=command.CombinedOutput()
	if err!=nil{return "",fail("Docker %s failed: %v",args[0],err)}
	return strings.TrimSpace(string(output)),nil
}
func copyTree(source,target string)error{
	return filepath.WalkDir(source,func(file string,entry os.DirEntry,err error)error{
		if err!=nil{return err}
		relative,err:=filepath.Rel(source,file);if err!=nil{return err}
		dest:=filepath.Join(target,relative)
		if entry.Type()&os.ModeSymlink!=0{return fail("model runtime tree contains symlink")}
		if entry.IsDir(){return os.MkdirAll(dest,0700)}
		info,err:=entry.Info();if err!=nil{return err}
		if !info.Mode().IsRegular(){return fail("model runtime has non-regular member")}
		input,err:=os.Open(file);if err!=nil{return err}
		defer input.Close()
		output,err:=os.OpenFile(dest,os.O_CREATE|os.O_EXCL|os.O_WRONLY,0600)
		if err!=nil{return err}
		_,copyErr:=io.Copy(output,input)
		closeErr:=output.Close()
		if copyErr!=nil{return copyErr}
		return closeErr
	})
}
func assemblePhotoRuntime(ctx context.Context,root string,m *Manifest)(string,error){
	runtime:=m.Images["ai-runtime"].Ref
	target:="xdrive/offline-photo-face:"+m.SourceCommit[:12]
	buildDir:=filepath.Join(root,"photo-build")
	if err:=os.Mkdir(buildDir,0700);err!=nil{return "",err}
	for _,part:=range []string{"models","licenses"}{
		source:=filepath.Join(root,"ai-models",part)
		if s,err:=os.Stat(source);err!=nil||!s.IsDir(){return "",fail("AI model directory missing")}
		if err:=copyTree(source,filepath.Join(buildDir,part));err!=nil{return "",err}
	}
	content:=fmt.Sprintf("FROM %s\nCOPY --chown=65532:65532 models/ /models/\nCOPY --chown=65532:65532 licenses/ /licenses/\nUSER 65532:65532\n",runtime)
	if err:=os.WriteFile(filepath.Join(buildDir,"Dockerfile"),[]byte(content),0600);err!=nil{return "",err}
	if _,err:=docker(ctx,"build","--pull=false","--network=none","-t",target,buildDir);err!=nil{return "",err}
	return target,nil
}
func allowExistingPostgresImage(ctx context.Context,m *Manifest)error{
	img:=m.Images["postgres"]
	actual,err:=docker(ctx,"image","inspect","--format","{{.Id}}",img.Ref)
	if err!=nil{return fail("PostgreSQL package not supplied and pinned image unavailable")}
	if actual!=img.ID{return fail("cached PostgreSQL image identity differs; supply package")}
	return nil
}
func checkExistingPostgresSetting(home string,m *Manifest)error{
	env,err:=readEnvironment(home);if err!=nil{return err}
	ref:=env["XD_POSTGRES_IMAGE"]
	if ref!=""&&ref!=m.Images["postgres"].Ref&&ref!="postgres:17-alpine"&&!pinnedPostgres.MatchString(ref){
		return fail("custom PostgreSQL image requires separate migration plan")
	}
	return nil
}
func envMap()map[string]string{
	out:=map[string]string{}
	for _,entry:=range os.Environ(){
		name,value,found:=strings.Cut(entry,"=")
		if found{out[name]=value}
	}
	return out
}
func processEnv(values map[string]string)[]string{
	keys:=make([]string,0,len(values))
	for key:=range values{keys=append(keys,key)}
	sort.Strings(keys)
	result:=make([]string,0,len(keys))
	for _,key:=range keys{result=append(result,key+"="+values[key])}
	return result
}
func setInstallEnvironment(env map[string]string,root,home string,m *Manifest,selected,profiles map[string]bool,opts InstallOptions,photoRef string){
	for _,key:=range []string{"XD_SERVER_IMAGE","XD_CADDY_IMAGE","XD_POSTGRES_IMAGE","XD_WEB_IMAGE",
		"XD_MEDIA_WORKER_IMAGE","XD_PHOTO_FACE_IMAGE","XD_CADDY_RESCUE_IMAGE",
		"XD_SOURCE_REF","XD_IMAGE_TAG","XD_IMAGE_REGISTRY","XD_BUILT_CHANNEL",
		"XD_BUILT_COMMIT","XD_BUILT_SOURCE","XD_OFFLINE_SERVER_IMAGE",
		"XD_OFFLINE_CADDY_IMAGE","XD_OFFLINE_POSTGRES_IMAGE",
		"XD_OFFLINE_MEDIA_IMAGE","XD_OFFLINE_PHOTO_IMAGE","XD_OFFLINE_UPDATE_SOURCE"}{
		delete(env,key)
	}
	env["XD_OFFLINE_ASSET_DIR"]=filepath.Join(root,"app","assets")
	env["XD_INSTALL_SOURCE"]=m.Source
	env["XD_INSTALL_CHANNEL"]=m.Channel
	env["XD_CONFIG_DIR"]=home
	env["XD_OFFLINE_NO_PULL"]="1"
	env["XD_POSTGRES_IMAGE"]=m.Images["postgres"].Ref
	for _,key:=range []string{"server","caddy","postgres"}{
		env["XD_OFFLINE_"+strings.ToUpper(key)+"_IMAGE"]=m.Images[key].Ref
	}
	if selected["media-worker"]{env["XD_OFFLINE_MEDIA_IMAGE"]=m.Images["media-worker"].Ref}
	if photoRef!=""{env["XD_OFFLINE_PHOTO_IMAGE"]=photoRef}
	if opts.UpdateSource!=""{env["XD_OFFLINE_UPDATE_SOURCE"]=opts.UpdateSource}
	if opts.NoStart{env["XD_INSTALL_NO_START"]="1"}else{delete(env,"XD_INSTALL_NO_START")}
	list:=make([]string,0,len(profiles))
	for name:=range profiles{list=append(list,name)}
	sort.Strings(list)
	env["COMPOSE_PROFILES"]=strings.Join(list,",")
}
func writeInstalledState(home string,old InstalledState,m *Manifest,selection []string)error{
	stateDir:=filepath.Join(home,"state")
	if info,err:=os.Lstat(stateDir);err!=nil||!info.IsDir()||info.Mode()&os.ModeSymlink!=0{
		return fail("offline state directory unavailable or unsafe")
	}
	state:=InstalledState{Schema:1,SourceCommit:m.SourceCommit,Contracts:m.Contracts,
		Installed:old.Installed,ActiveRefs:map[string]string{}}
	if state.Installed==nil{state.Installed=map[string]InstalledComponent{}}
	for _,component:=range selection{
		p:=m.Packages[component]
		state.Installed[component]=InstalledComponent{Fingerprint:m.Fingerprints[component],
			SHA256:p.SHA256,BuildCommit:p.BuiltFromCommit}
	}
	env,err:=readEnvironment(home);if err!=nil{return err}
	if ref:=env["XD_MEDIA_WORKER_IMAGE"];ref!=""{state.ActiveRefs["media-worker"]=ref}
	if ref:=env["XD_PHOTO_FACE_IMAGE"];ref!=""{state.ActiveRefs["photo-intelligence"]=ref}
	data,err:=json.Marshal(state);if err!=nil{return err}
	f,err:=os.CreateTemp(stateDir,".offline-installed-");if err!=nil{return err}
	defer os.Remove(f.Name())
	if err:=f.Chmod(0600);err!=nil{f.Close();return err}
	if _,err:=f.Write(append(data,'\n'));err!=nil{f.Close();return err}
	if err:=f.Sync();err!=nil{f.Close();return err}
	if err:=f.Close();err!=nil{return err}
	return os.Rename(f.Name(),filepath.Join(stateDir,"offline-installed.json"))
}

// Install executes NO downloaded script before archive/member and image
// identity checks. The rendered, signed App installer still owns rollback.
func Install(ctx context.Context,m *Manifest,opts InstallOptions)error{
	selection:=selectedSet(opts.Components)
	if !selection["app"]{return fail("offline install requires App package")}
	if selection["ai-runtime"]!=selection["ai-models"]{
		return fail("AI Runtime and AI Models must be installed together")
	}
	if opts.UpdateSource!=""{
		if opts.UpdateSource!="xdrive"||m.Source!="github"||m.Channel!="master"{
			return fail("Share update preference requires verified GitHub master release")
		}
		if _,ok:=m.Packages["app"].Members["assets/scripts/xdrive-share-update.py"];!ok{
			return fail("Share helper is missing from App package")
		}
	}
	if opts.EnableMedia&&!selection["media-worker"]{return fail("enable-media requires Media Worker package")}
	if opts.EnableAI&&!selection["ai-runtime"]{return fail("enable-ai requires AI runtime and model packages")}
	if _,err:=exec.LookPath("docker");err!=nil{return fail("Docker must be installed")}
	if _,err:=exec.LookPath("bash");err!=nil{return fail("bash must be installed")}
	if _,err:=docker(ctx,"info");err!=nil{return err}
	if !selection["postgres"] {
		if err:=allowExistingPostgresImage(ctx,m);err!=nil{return err}
	}
	home:=opts.Home
	if home==""{
		base,err:=os.UserHomeDir();if err!=nil{return err}
		home=filepath.Join(base,".xd")
	}
	if err:=checkExistingPostgresSetting(home,m);err!=nil{return err}
	currentEnv,err:=readEnvironment(home);if err!=nil{return err}
	profiles,err:=activeProfiles(currentEnv,opts.EnableMedia,opts.EnableAI)
	if err!=nil{return err}
	old,err:=validateContracts(home,m,selection,profiles);if err!=nil{return err}
	root,err:=os.MkdirTemp(opts.Workdir,"xdrive-offline-")
	if err!=nil{return err}
	defer os.RemoveAll(root)
	snapshot:=filepath.Join(root,"snapshot")
	if err:=SnapshotSelection(opts.Directory,snapshot,m,opts.Components);err!=nil{return err}
	// All further reads target the private, SHA-256 bound snapshot.
	if err:=VerifySelection(snapshot,m,opts.Components,root);err!=nil{return err}
	for key,owner:=range imageMembers{
		if !selection[owner.Component]{continue}
		archive:=filepath.Join(root,owner.Component,filepath.FromSlash(owner.Member))
		if err:=LoadVerifiedImage(ctx,archive,m.Images[key]);err!=nil{return err}
	}
	photoRef:=""
	if selection["ai-runtime"]{
		photoRef,err=assemblePhotoRuntime(ctx,root,m)
		if err!=nil{return err}
	}
	installer:=filepath.Join(root,"app","assets","xdrive-server-install.sh")
	if f,_,err:=SafeFile(installer);err!=nil{return fail("verified App installer unavailable")}else{f.Close()}
	env:=envMap()
	setInstallEnvironment(env,root,home,m,selection,profiles,opts,photoRef)
	args:=[]string{installer,"--source",m.Source,"--channel",m.Channel}
	if opts.BackupFileData{args=append(args,"--backup-file-data")}
	command:=exec.CommandContext(ctx,"bash",args...)
	command.Env=processEnv(env)
	command.Stdin=os.Stdin
	command.Stdout=os.Stdout
	command.Stderr=os.Stderr
	fmt.Println("[offline] activating verified local release via xDrive transactional installer")
	if err:=command.Run();err!=nil{return fail("transactional host installer failed: %v",err)}
	if !opts.NoStart{
		if err:=writeInstalledState(home,old,m,opts.Components);err!=nil{return err}
	}
	return nil
}
