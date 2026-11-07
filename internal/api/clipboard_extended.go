package api

import (
  "encoding/base64"
  "errors"
  "net/http"
  "strings"
  "time"

  "github.com/gin-gonic/gin"
  "github.com/google/uuid"
  "github.com/lazyxu/xdrive/internal/meta"
  "gorm.io/gorm"
  "gorm.io/gorm/clause"
)

// Only the Sender/Recipient handle the X25519-HKDF-SHA256-AES-GCM keys.
// The Server has no private key and no binary Clipboard upload writer.
func clipboardValidPublicKey(raw string) bool {
  b,err:=base64.StdEncoding.Strict().DecodeString(raw)
  if err!=nil || len(b)!=32 { return false }
  for _,value:=range b { if value!=0 { return true } }
  return false
}
func clipboardVisibleToDevice(db *gorm.DB, id string) *gorm.DB {
  if id=="" { return db.Where("(target_device_id = '' OR target_device_id IS NULL)") }
  return db.Where("(target_device_id = '' OR target_device_id IS NULL OR target_device_id = ?)",id)
}
// Both verified interactive Owner session AND current installation credential
// must be valid. A device credential alone never grants any Clipboard route.
func (s *Server) clipboardVerifiedDevice(c *gin.Context, owner uint64)(string,bool){
  id:=strings.TrimSpace(c.GetHeader("X-XDrive-Device-ID"))
  token:=c.GetHeader("X-XDrive-Device-Token")
  if id=="" && token=="" { return "",true } // broadcast-only
  parsed,err:=uuid.Parse(id)
  if err!=nil || parsed.String()!=id || token=="" { return "",false }
  db:=s.DB.WithContext(c.Request.Context())
  var device meta.ClientDevice
  if db.Where("owner_id = ? AND id = ? AND revoked_at IS NULL",owner,id).
    Take(&device).Error!=nil || !clientDeviceIdentityCredentialMatches(device,token){return "",false}
  var cap meta.ClipboardDeviceKey
  if db.Where("owner_id = ? AND device_id = ? AND revoked_at IS NULL",owner,id).
    Take(&cap).Error!=nil { return "",true } // No Clipboard capability: broadcasts only
  return id,true
}
func (s *Server) clipboardValidateTargetAndNode(db *gorm.DB, owner uint64, req clipboardWriteRequest)error{
  if req.TargetDeviceID!="" {
    var key meta.ClipboardDeviceKey
    var device meta.ClientDevice
    if db.Where("owner_id = ? AND device_id = ? AND revoked_at IS NULL",owner,req.TargetDeviceID).
      Take(&key).Error!=nil ||
      db.Where("owner_id = ? AND id = ? AND revoked_at IS NULL",owner,req.TargetDeviceID).
      Take(&device).Error!=nil || !clipboardValidPublicKey(key.PublicKey) {return errClipboardForbidden}
  }
  if req.NodeID>0 {
    var node meta.Node
    // Original already exists through the Owner's normal UploadSession/CAS path.
    if db.Where("id = ? AND owner_id = ? AND deleted_at IS NULL AND trash_root_id IS NULL AND type = ?",
      req.NodeID,owner,"file").Take(&node).Error!=nil {return errClipboardForbidden}
  }
  return nil
}
func (s *Server) enrollClipboardDeviceKey(c *gin.Context) {
  c.Header("Cache-Control","no-store")
  owner:=userID(c)
  id:=strings.TrimSpace(c.GetHeader("X-XDrive-Device-ID"))
  token:=c.GetHeader("X-XDrive-Device-Token")
  parsed,err:=uuid.Parse(id)
  if owner==0 || err!=nil || parsed.String()!=id || token==""{
    c.JSON(http.StatusForbidden,gin.H{"error":"current Owner device proof required"});return
  }
  var payload struct { PublicKey string `json:"public_key" binding:"required"` }
  if c.ShouldBindJSON(&payload)!=nil || !clipboardValidPublicKey(payload.PublicKey){
    c.JSON(http.StatusBadRequest,gin.H{"error":"invalid Curve25519 public key"});return
  }
  db:=s.DB.WithContext(c.Request.Context())
  var device meta.ClientDevice
  if db.Where("owner_id = ? AND id = ? AND revoked_at IS NULL",owner,id).
    Take(&device).Error!=nil || !clientDeviceIdentityCredentialMatches(device,token){
    c.JSON(http.StatusForbidden,gin.H{"error":"device credential invalid"});return
  }
  now:=time.Now().UTC()
  proposed:=meta.ClipboardDeviceKey{OwnerID:owner,DeviceID:id,PublicKey:payload.PublicKey,CreatedAt:now,UpdatedAt:now}
  if err:=db.Clauses(clause.OnConflict{DoNothing:true}).Create(&proposed).Error;err!=nil{
    c.JSON(http.StatusInternalServerError,gin.H{"error":"device enrollment unavailable"});return
  }
  var stored meta.ClipboardDeviceKey
  if db.Where("owner_id = ? AND device_id = ?",owner,id).Take(&stored).Error!=nil{
    c.JSON(http.StatusInternalServerError,gin.H{"error":"device enrollment unavailable"});return
  }
  if stored.RevokedAt!=nil || stored.PublicKey!=payload.PublicKey{
    c.JSON(http.StatusConflict,gin.H{"error":"device key immutable or revoked"});return
  }
  c.JSON(http.StatusOK,gin.H{"device_id":stored.DeviceID,"public_key":stored.PublicKey})
}
func (s *Server) listClipboardDevices(c *gin.Context){
  c.Header("Cache-Control","no-store")
  owner:=userID(c)
  if owner==0 {c.AbortWithStatus(http.StatusUnauthorized);return}
  db:=s.DB.WithContext(c.Request.Context())
  var keys []meta.ClipboardDeviceKey
  if db.Where("owner_id = ? AND revoked_at IS NULL",owner).Order("device_id").Limit(101).
     Find(&keys).Error!=nil {c.JSON(http.StatusInternalServerError,gin.H{"error":"devices unavailable"});return}
  if len(keys)>100 {c.JSON(http.StatusConflict,gin.H{"error":"device list too large"});return}
  result:=make([]gin.H,0,len(keys))
  for _,key:=range keys{
    var device meta.ClientDevice
    err:=db.Where("owner_id = ? AND id = ? AND revoked_at IS NULL",owner,key.DeviceID).
      Take(&device).Error
    if errors.Is(err,gorm.ErrRecordNotFound){continue}
    if err!=nil {c.JSON(http.StatusInternalServerError,gin.H{"error":"devices unavailable"});return}
    result=append(result,gin.H{"device_id":key.DeviceID,"name":device.Name,"platform":device.Platform,"public_key":key.PublicKey})
  }
  c.JSON(http.StatusOK,gin.H{"devices":result})
}
func (s *Server) revokeClipboardDeviceKey(c *gin.Context){
  c.Header("Cache-Control","no-store")
  owner:=userID(c)
  id,err:=uuid.Parse(c.Param("id"))
  if owner==0 || err!=nil {c.JSON(http.StatusBadRequest,gin.H{"error":"invalid device"});return}
  now:=time.Now().UTC()
  r:=s.DB.WithContext(c.Request.Context()).Model(&meta.ClipboardDeviceKey{}).
     Where("owner_id = ? AND device_id = ? AND revoked_at IS NULL",owner,id.String()).
     Update("revoked_at",now)
  if r.Error!=nil {c.JSON(http.StatusInternalServerError,gin.H{"error":"revoke unavailable"});return}
  if r.RowsAffected==0 {c.JSON(http.StatusNotFound,gin.H{"error":"device unavailable"});return}
  c.Status(http.StatusNoContent)
}
