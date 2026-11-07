package client

import (
    "context"
    "errors"
    "net/http"
    "net/url"
    "strconv"
    "strings"

    "github.com/google/uuid"
)

// These DTOs only contain ciphertext and immutable Owner vault metadata.
// Clipboard is never authorized by a Device, SourceRun or share bearer.
type ClipboardVault struct {
    Salt string `json:"salt"`
    KDF string `json:"kdf"`
    Iterations int `json:"iterations"`
    CheckNonce string `json:"check_nonce"`
    CheckCiphertext string `json:"check_ciphertext"`
    AADScope string `json:"aad_scope"`
}

type ClipboardCheck struct {
    Nonce string `json:"nonce"`
    Ciphertext string `json:"ciphertext"`
    Scope string `json:"scope"`
}

type ClipboardWrite struct {
    ClientEventID string `json:"client_event_id"`
    Kind string `json:"kind"`
    Nonce string `json:"nonce"`
    Ciphertext string `json:"ciphertext"`
}

type ClipboardItem struct {
    ID uint64 `json:"id"`
    ClientEventID string `json:"client_event_id"`
    Kind string `json:"kind"`
    Nonce string `json:"nonce"`
    Ciphertext string `json:"ciphertext"`
    CreatedAt string `json:"created_at"`
    ExpiresAt string `json:"expires_at"`
}

type ClipboardPage struct {
    Items []ClipboardItem `json:"items"`
    NextBefore *uint64 `json:"next_before"`
}

func validClipboardWrite(value ClipboardWrite) bool {
    return uuid.Validate(value.ClientEventID) == nil &&
        (value.Kind == "text/plain" || value.Kind == "text/uri-list") &&
        len(value.Nonce) == 16 &&
        len(value.Ciphertext) > 16 && len(value.Ciphertext) <= 90000 &&
        !strings.ContainsAny(value.Nonce+value.Ciphertext, "\r\n")
}
func validClipboardVault(v ClipboardVault) bool {
    return v.KDF == "PBKDF2-SHA256" && v.Iterations == 310000 &&
        len(v.Salt) == 24 && (v.CheckCiphertext == "" || v.CheckNonce != "")
}
func validClipboardItem(v ClipboardItem) bool {
    return v.ID > 0 && validClipboardWrite(ClipboardWrite{
        ClientEventID:v.ClientEventID,Kind:v.Kind,Nonce:v.Nonce,Ciphertext:v.Ciphertext,
    }) && v.CreatedAt != "" && v.ExpiresAt != ""
}

func (c *Client) ClipboardVault(ctx context.Context) (ClipboardVault, error) {
    var out ClipboardVault
    if err := c.json(ctx,http.MethodGet,"/api/v1/clipboard/vault",nil,&out); err!=nil {return out,err}
    if !validClipboardVault(out) {return ClipboardVault{}, errors.New("invalid Owner clipboard vault")}
    return out,nil
}
func (c *Client) ClipboardCheck(ctx context.Context, check ClipboardCheck) (ClipboardVault,error) {
    if check.Scope == "" || len(check.Scope)>512 || len(check.Nonce)!=16 || len(check.Ciphertext)>256 {
        return ClipboardVault{},errors.New("invalid Owner clipboard check")
    }
    var out ClipboardVault
    if err:=c.json(ctx,http.MethodPut,"/api/v1/clipboard/vault/check",check,&out);err!=nil {return out,err}
    if !validClipboardVault(out) {return ClipboardVault{},errors.New("invalid Owner clipboard check response")}
    return out,nil
}
func (c *Client) ClipboardList(ctx context.Context,before uint64) (ClipboardPage,error) {
    path:="/api/v1/clipboard/items"
    if before>0 {path+="?before="+strconv.FormatUint(before,10)}
    var out ClipboardPage
    if err:=c.json(ctx,http.MethodGet,path,nil,&out);err!=nil {return out,err}
    if len(out.Items)>50 {return ClipboardPage{},errors.New("clipboard Owner page exceeds limit")}
    seen:=make(map[uint64]bool,len(out.Items))
    for _,item:=range out.Items {
        if !validClipboardItem(item) || seen[item.ID] {return ClipboardPage{},errors.New("invalid Owner clipboard page")}
        seen[item.ID]=true
    }
    return out,nil
}
func (c *Client) ClipboardCreate(ctx context.Context,write ClipboardWrite) (ClipboardItem,error) {
    if !validClipboardWrite(write) {return ClipboardItem{},errors.New("invalid encrypted clipboard item")}
    var out ClipboardItem
    if err:=c.json(ctx,http.MethodPost,"/api/v1/clipboard/items",write,&out);err!=nil {return out,err}
    if !validClipboardItem(out) || out.ClientEventID!=write.ClientEventID ||
        out.Kind!=write.Kind || out.Nonce!=write.Nonce || out.Ciphertext!=write.Ciphertext {
        return ClipboardItem{},errors.New("Owner clipboard receipt mismatch")
    }
    return out,nil
}
func (c *Client) ClipboardDelete(ctx context.Context,id uint64) error {
    if id==0 {return errors.New("invalid clipboard item ID")}
    return c.json(ctx,http.MethodDelete,"/api/v1/clipboard/items/"+url.PathEscape(strconv.FormatUint(id,10)),nil,nil)
}
func (c *Client) ClipboardClear(ctx context.Context) error {
    return c.json(ctx,http.MethodDelete,"/api/v1/clipboard/items",nil,nil)
}
