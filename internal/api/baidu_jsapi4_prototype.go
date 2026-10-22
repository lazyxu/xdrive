package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

// The prototype deliberately loads Baidu JSAPI in the authenticated Gallery
// document. A browser-type AK is a public client credential, not the private
// Server/static-map AK. This route NEVER returns a media token or photo GPS.
// The operator must enable/configure the dedicated JSAPI Browser AK first.
// The isolated signed-release/consent endpoints retain their stricter contract.
func (s *Server) mediaBaiduJSAPIPrototype(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	c.Header("Pragma", "no-cache")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")
	if s == nil || s.DB == nil || s.ConnectorSecrets == nil {
		fail(c, http.StatusServiceUnavailable, "Baidu browser map unavailable")
		return
	}
	var row meta.AdminServiceSecret
	if err := s.DB.WithContext(c.Request.Context()).
		Select("name", "enabled", "revision", "key_version", "ciphertext").
		Where("name = ?", baiduJSAPISecretName).Take(&row).Error; err != nil ||
		!row.Enabled || row.Revision == 0 || row.KeyVersion == 0 ||
		len(row.Ciphertext) == 0 {
		fail(c, http.StatusServiceUnavailable, "Baidu browser map unavailable")
		return
	}
	plaintext, err := s.ConnectorSecrets.Open(
		baiduJSAPISecretAADID, baiduJSAPISecretKind,
		row.KeyVersion, row.Ciphertext,
	)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Baidu browser map unavailable")
		return
	}
	defer clear(plaintext)
	if !validBaiduMapAK(string(plaintext)) {
		fail(c, http.StatusServiceUnavailable, "Baidu browser map unavailable")
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"provider":   "baidu-jsapi-4.0",
		"browser_ak": string(plaintext),
		"revision":   row.Revision,
	})
}
