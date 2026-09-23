//go:build windows

package mount

import (
	"fmt"
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	cldapi                 = windows.NewLazySystemDLL("cldapi.dll")
	procRegisterSyncRoot   = cldapi.NewProc("CfRegisterSyncRoot")
	procUnregisterSyncRoot = cldapi.NewProc("CfUnregisterSyncRoot")
	procConnectSyncRoot    = cldapi.NewProc("CfConnectSyncRoot")
	procDisconnectSyncRoot = cldapi.NewProc("CfDisconnectSyncRoot")
	procCreatePlaceholders      = cldapi.NewProc("CfCreatePlaceholders")
	procExecute                 = cldapi.NewProc("CfExecute")
	procSetPinState             = cldapi.NewProc("CfSetPinState")
	procHydratePlaceholder      = cldapi.NewProc("CfHydratePlaceholder")
	procDehydratePlaceholder    = cldapi.NewProc("CfDehydratePlaceholder")
)

const (
	cfHydrationPolicyFull                    = 2
	cfHydrationModifierAutoDehydrationAllowed = 0x0004
	cfPopulationPolicyAlwaysFull             = 3
	cfRegisterFlagUpdate         = 0x00000001
	cfConnectFlagFullPath        = 0x00000004
	cfPlaceholderMarkInSync      = 0x00000002
	cfPlaceholderSupersede       = 0x00000004
	cfCallbackFetchData          = 0
	cfCallbackNone               = 0xffffffff
	cfOperationTypeTransferData  = 0
	fileAttributeNormal          = 0x00000080
)

type cfHydrationPolicy struct{ Primary, Modifier uint16 }
type cfPopulationPolicy struct{ Primary, Modifier uint16 }

type cfSyncPolicies struct {
	StructSize                  uint32
	Hydration                   cfHydrationPolicy
	Population                  cfPopulationPolicy
	InSyncPolicy                uint32
	HardLinkPolicy              uint32
	PlaceholderManagementPolicy uint32
}

type cfSyncRegistration struct {
	StructSize             uint32
	_                      uint32
	ProviderName           *uint16
	ProviderVersion        *uint16
	SyncRootIdentity       unsafe.Pointer
	SyncRootIdentityLength uint32
	_                      uint32
	FileIdentity           unsafe.Pointer
	FileIdentityLength     uint32
	ProviderID             windows.GUID
}

type cfCallbackRegistration struct {
	Type     uint32
	_        uint32
	Callback uintptr
}

type cfFileBasicInfo struct {
	CreationTime   int64
	LastAccessTime int64
	LastWriteTime  int64
	ChangeTime     int64
	FileAttributes uint32
	_              uint32
}

type cfFsMetadata struct {
	BasicInfo cfFileBasicInfo
	FileSize  int64
}

type cfPlaceholderCreateInfo struct {
	RelativeFileName   *uint16
	FsMetadata         cfFsMetadata
	FileIdentity       unsafe.Pointer
	FileIdentityLength uint32
	Flags              uint32
	Result             int32
	_                  uint32
	CreateUsn          int64
}

type cfCallbackInfo struct {
	StructSize             uint32
	_                      uint32
	ConnectionKey          int64
	CallbackContext        uintptr
	VolumeGuidName         *uint16
	VolumeDosName          *uint16
	VolumeSerialNumber     uint32
	_                      uint32
	SyncRootFileID         int64
	SyncRootIdentity       unsafe.Pointer
	SyncRootIdentityLength uint32
	_                      uint32
	FileID                 int64
	FileSize               int64
	FileIdentity           unsafe.Pointer
	FileIdentityLength     uint32
	_                      uint32
	NormalizedPath         *uint16
	TransferKey            int64
	PriorityHint           uint8
	_                      [7]byte
	CorrelationVector      uintptr
	ProcessInfo            uintptr
	RequestKey             int64
}

type cfCallbackParametersFetchData struct {
	ParamSize             uint32
	_                     uint32
	Flags                 uint32
	_                     uint32
	RequiredFileOffset    int64
	RequiredLength        int64
	OptionalFileOffset    int64
	OptionalLength        int64
	LastDehydrationTime   int64
	LastDehydrationReason uint32
	_                     uint32
}

type cfOperationInfo struct {
	StructSize        uint32
	Type              uint32
	ConnectionKey     int64
	TransferKey       int64
	CorrelationVector uintptr
	SyncStatus        uintptr
	RequestKey        int64
}

type cfOperationParametersTransferData struct {
	ParamSize        uint32
	_                uint32
	Flags            uint32
	CompletionStatus int32
	Buffer           uintptr
	Offset           int64
	Length           int64
}

var xdriveProviderID = windows.GUID{
	Data1: 0x7ac0c6a5, Data2: 0x4911, Data3: 0x4e45,
	Data4: [8]byte{0xb7, 0x3a, 0xd8, 0x2b, 0x90, 0x5e, 0x1f, 0x44},
}

func cfRegister(root string) error {
	rootW, err := windows.UTF16PtrFromString(root)
	if err != nil {
		return err
	}
	nameW, _ := windows.UTF16PtrFromString("xDrive")
	versionW, _ := windows.UTF16PtrFromString("0.1")
	identity := []byte("xdrive")
	reg := cfSyncRegistration{
		ProviderName: nameW, ProviderVersion: versionW,
		SyncRootIdentity: unsafe.Pointer(&identity[0]), SyncRootIdentityLength: uint32(len(identity)),
		ProviderID: xdriveProviderID,
	}
	reg.StructSize = uint32(unsafe.Sizeof(reg))
	pol := cfSyncPolicies{
		Hydration: cfHydrationPolicy{
			Primary:  cfHydrationPolicyFull,
			Modifier: cfHydrationModifierAutoDehydrationAllowed,
		},
		Population: cfPopulationPolicy{Primary: cfPopulationPolicyAlwaysFull},
	}
	pol.StructSize = uint32(unsafe.Sizeof(pol))
	register := func(flags uintptr) error {
		hr, _, _ := procRegisterSyncRoot.Call(
			uintptr(unsafe.Pointer(rootW)), uintptr(unsafe.Pointer(&reg)), uintptr(unsafe.Pointer(&pol)), flags,
		)
		return hresult("CfRegisterSyncRoot", hr)
	}
	// UPDATE makes repeated mounts idempotent. A brand-new sync root is not
	// registered yet, so fall back to a normal registration on first use.
	err = register(cfRegisterFlagUpdate)
	if err != nil {
		err = register(0)
	}
	runtime.KeepAlive(identity)
	runtime.KeepAlive(reg)
	runtime.KeepAlive(pol)
	return err
}

func cfUnregister(root string) error {
	rootW, err := windows.UTF16PtrFromString(root)
	if err != nil {
		return err
	}
	hr, _, _ := procUnregisterSyncRoot.Call(uintptr(unsafe.Pointer(rootW)))
	return hresult("CfUnregisterSyncRoot", hr)
}

func cfConnect(root string, callback uintptr) (int64, error) {
	rootW, err := windows.UTF16PtrFromString(root)
	if err != nil {
		return 0, err
	}
	callbacks := []cfCallbackRegistration{{Type: cfCallbackFetchData, Callback: callback}, {Type: cfCallbackNone}}
	var key int64
	hr, _, _ := procConnectSyncRoot.Call(
		uintptr(unsafe.Pointer(rootW)), uintptr(unsafe.Pointer(&callbacks[0])), 0, cfConnectFlagFullPath, uintptr(unsafe.Pointer(&key)),
	)
	runtime.KeepAlive(callbacks)
	if err := hresult("CfConnectSyncRoot", hr); err != nil {
		return 0, err
	}
	return key, nil
}

func cfDisconnect(key int64) error {
	hr, _, _ := procDisconnectSyncRoot.Call(uintptr(key))
	return hresult("CfDisconnectSyncRoot", hr)
}

func cfCreatePlaceholder(parent, name string, nodeID uint64, size int64, modUnixNano int64, supersede bool) error {
	parentW, err := windows.UTF16PtrFromString(parent)
	if err != nil {
		return err
	}
	nameW, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return err
	}
	identity := []byte(fmt.Sprintf("%d", nodeID))
	ft := filetimeFromUnixNano(modUnixNano)
	flags := uint32(cfPlaceholderMarkInSync)
	if supersede {
		flags |= cfPlaceholderSupersede
	}
	info := cfPlaceholderCreateInfo{
		RelativeFileName: nameW,
		FsMetadata:       cfFsMetadata{BasicInfo: cfFileBasicInfo{CreationTime: ft, LastAccessTime: ft, LastWriteTime: ft, ChangeTime: ft, FileAttributes: fileAttributeNormal}, FileSize: size},
		FileIdentity:     unsafe.Pointer(&identity[0]), FileIdentityLength: uint32(len(identity)), Flags: flags,
	}
	var processed uint32
	hr, _, _ := procCreatePlaceholders.Call(
		uintptr(unsafe.Pointer(parentW)), uintptr(unsafe.Pointer(&info)), 1, 0, uintptr(unsafe.Pointer(&processed)),
	)
	runtime.KeepAlive(identity)
	runtime.KeepAlive(info)
	if err := hresult("CfCreatePlaceholders", hr); err != nil {
		return err
	}
	if processed != 1 || info.Result < 0 {
		return fmt.Errorf("CfCreatePlaceholders item result 0x%08x", uint32(info.Result))
	}
	return nil
}

func cfTransfer(info *cfCallbackInfo, data []byte, offset int64) error {
	op := cfOperationInfo{StructSize: uint32(unsafe.Sizeof(cfOperationInfo{})), Type: cfOperationTypeTransferData, ConnectionKey: info.ConnectionKey, TransferKey: info.TransferKey, RequestKey: info.RequestKey}
	params := cfOperationParametersTransferData{ParamSize: uint32(unsafe.Sizeof(cfOperationParametersTransferData{})), CompletionStatus: 0, Offset: offset, Length: int64(len(data))}
	if len(data) > 0 {
		params.Buffer = uintptr(unsafe.Pointer(&data[0]))
	}
	hr, _, _ := procExecute.Call(uintptr(unsafe.Pointer(&op)), uintptr(unsafe.Pointer(&params)))
	runtime.KeepAlive(data)
	runtime.KeepAlive(op)
	runtime.KeepAlive(params)
	return hresult("CfExecute(TRANSFER_DATA)", hr)
}

func cfTransferFailure(info *cfCallbackInfo, offset, length int64) {
	op := cfOperationInfo{StructSize: uint32(unsafe.Sizeof(cfOperationInfo{})), Type: cfOperationTypeTransferData, ConnectionKey: info.ConnectionKey, TransferKey: info.TransferKey, RequestKey: info.RequestKey}
	params := cfOperationParametersTransferData{ParamSize: uint32(unsafe.Sizeof(cfOperationParametersTransferData{})), CompletionStatus: int32(-1073741823), Offset: offset, Length: length}
	_, _, _ = procExecute.Call(uintptr(unsafe.Pointer(&op)), uintptr(unsafe.Pointer(&params)))
}

func hresult(op string, hr uintptr) error {
	if int32(hr) < 0 {
		return fmt.Errorf("%s failed: HRESULT 0x%08x", op, uint32(hr))
	}
	return nil
}

func filetimeFromUnixNano(ns int64) int64 {
	if ns <= 0 {
		return 0
	}
	return ns/100 + 116444736000000000
}

func utf16PtrString(p *uint16) string {
	if p == nil {
		return ""
	}
	return windows.UTF16PtrToString(p)
}

func newCallback(fn any) uintptr { return syscall.NewCallback(fn) }
