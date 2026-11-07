package main

import (
    "context"
    "net/http"
    "strconv"
    "strings"

    "github.com/lazyxu/xdrive/internal/client"
)

// Explicit six-operation loopback allowlist, never a generic Owner HTTP proxy.
type desktopIPCClipboardPort interface {
    CloudClipboardVault(context.Context) (client.ClipboardVault,error)
    CloudClipboardCheck(context.Context,client.ClipboardCheck) (client.ClipboardVault,error)
    CloudClipboardList(context.Context,uint64) (client.ClipboardPage,error)
    CloudClipboardCreate(context.Context,client.ClipboardWrite) (client.ClipboardItem,error)
    CloudClipboardDelete(context.Context,uint64) error
    CloudClipboardClear(context.Context) error
}
func (h *desktopIPCHandler) clipboardPort(w http.ResponseWriter) (desktopIPCClipboardPort,bool) {
    port,ok:=h.ctrl.(desktopIPCClipboardPort)
    if !ok {
        writeDesktopIPCError(w,http.StatusNotImplemented,"clipboard_unavailable","Owner Clipboard is unavailable")
    }
    return port,ok
}
func (h *desktopIPCHandler) cloudClipboardVault(w http.ResponseWriter,r *http.Request) {
    port,ok:=h.clipboardPort(w);if !ok{return}
    value,err:=port.CloudClipboardVault(r.Context())
    if err!=nil {writeDesktopIPCControllerError(w,err);return}
    writeDesktopIPCJSON(w,http.StatusOK,value)
}
func (h *desktopIPCHandler) cloudClipboardCheck(w http.ResponseWriter,r *http.Request) {
    port,ok:=h.clipboardPort(w);if !ok{return}
    var input client.ClipboardCheck
    if !decodeDesktopIPCJSONLimit(w,r,&input,1024){return}
    value,err:=port.CloudClipboardCheck(r.Context(),input)
    if err!=nil {writeDesktopIPCControllerError(w,err);return}
    writeDesktopIPCJSON(w,http.StatusOK,value)
}
func (h *desktopIPCHandler) cloudClipboardList(w http.ResponseWriter,r *http.Request) {
    port,ok:=h.clipboardPort(w);if !ok{return}
    before:=uint64(0)
    if raw:=r.URL.Query().Get("before");raw!="" {
        parsed,err:=strconv.ParseUint(raw,10,64)
        if err!=nil || parsed==0 {writeDesktopIPCError(w,http.StatusBadRequest,"invalid_clipboard_cursor","invalid clipboard cursor");return}
        before=parsed
    }
    value,err:=port.CloudClipboardList(r.Context(),before)
    if err!=nil {writeDesktopIPCControllerError(w,err);return}
    writeDesktopIPCJSON(w,http.StatusOK,value)
}
func (h *desktopIPCHandler) cloudClipboardCreate(w http.ResponseWriter,r *http.Request) {
    port,ok:=h.clipboardPort(w);if !ok{return}
    var input client.ClipboardWrite
    if !decodeDesktopIPCJSONLimit(w,r,&input,128<<10){return}
    value,err:=port.CloudClipboardCreate(r.Context(),input)
    if err!=nil {writeDesktopIPCControllerError(w,err);return}
    writeDesktopIPCJSON(w,http.StatusCreated,value)
}
func (h *desktopIPCHandler) cloudClipboardDelete(w http.ResponseWriter,r *http.Request) {
    port,ok:=h.clipboardPort(w);if !ok{return}
    raw:=strings.TrimSpace(r.PathValue("id"))
    id,err:=strconv.ParseUint(raw,10,64)
    if err!=nil || id==0 {writeDesktopIPCError(w,http.StatusBadRequest,"invalid_clipboard_id","invalid clipboard item");return}
    if err:=port.CloudClipboardDelete(r.Context(),id);err!=nil {writeDesktopIPCControllerError(w,err);return}
    w.WriteHeader(http.StatusNoContent)
}
func (h *desktopIPCHandler) cloudClipboardClear(w http.ResponseWriter,r *http.Request) {
    port,ok:=h.clipboardPort(w);if !ok{return}
    if err:=port.CloudClipboardClear(r.Context());err!=nil {writeDesktopIPCControllerError(w,err);return}
    w.WriteHeader(http.StatusNoContent)
}
