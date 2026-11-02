package api

import (
    "errors"
    "net/http"
    "strconv"
    "strings"
    "time"

    "github.com/gin-gonic/gin"
    "github.com/lazyxu/xdrive/internal/meta"
    "gorm.io/gorm"
    "gorm.io/gorm/clause"
)

const ownerSharePageLimit = 50

type ownerShareItemDTO struct {
    shareDTO
    NodeName    string `json:"node_name"`
    NodeType    string `json:"node_type"`
    NodeMissing bool   `json:"node_missing"`
}

type ownerSharesPageDTO struct {
    Items      []ownerShareItemDTO `json:"items"`
    NextCursor uint64              `json:"next_cursor"`
}

// Lists every share owned by the current user, including revoked/expired rows.
// The response never includes original tokens, token hashes or ciphertext.
func (s *Server) listOwnShares(c *gin.Context) {
    limit := ownerSharePageLimit
    if value := strings.TrimSpace(c.Query("limit")); value != "" {
        parsed, err := strconv.Atoi(value)
        if err != nil || parsed < 1 || parsed > 100 {
            fail(c, http.StatusBadRequest, "invalid share page limit")
            return
        }
        limit = parsed
    }
    cursor := uint64(0)
    if value := strings.TrimSpace(c.Query("cursor")); value != "" {
        parsed, err := strconv.ParseUint(value, 10, 64)
        if err != nil || parsed == 0 {
            fail(c, http.StatusBadRequest, "invalid share cursor")
            return
        }
        cursor = parsed
    }
    query := s.DB.WithContext(c.Request.Context()).Where("owner_id = ?", userID(c))
    if cursor != 0 { query = query.Where("id < ?", cursor) }
    var shares []meta.Share
    if err := query.Order("id DESC").Limit(limit + 1).Find(&shares).Error; err != nil {
        fail(c, http.StatusInternalServerError, "list owner shares failed")
        return
    }
    hasMore := len(shares) > limit
    if hasMore { shares = shares[:limit] }
    ids := make([]uint64, 0, len(shares))
    for _, share := range shares { ids = append(ids, share.NodeID) }
    nodes := make(map[uint64]meta.Node, len(ids))
    if len(ids) != 0 {
        var found []meta.Node
        if err := s.DB.WithContext(c.Request.Context()).Select("id", "name", "type").
            Where("owner_id = ? AND id IN ? AND deleted_at IS NULL", userID(c), ids).
            Find(&found).Error; err != nil {
            fail(c, http.StatusInternalServerError, "share node lookup failed")
            return
        }
        for _, node := range found { nodes[node.ID] = node }
    }
    now := time.Now()
    page := ownerSharesPageDTO{Items: make([]ownerShareItemDTO, 0, len(shares))}
    for _, share := range shares {
        item := ownerShareItemDTO{shareDTO: toShareDTO(share, now)}
        if node, ok := nodes[share.NodeID]; ok {
            item.NodeName, item.NodeType = node.Name, node.Type
        } else {
            item.NodeName, item.NodeMissing = "原文件已删除", true
        }
        page.Items = append(page.Items, item)
    }
    if hasMore && len(shares) > 0 { page.NextCursor = shares[len(shares)-1].ID }
    c.Header("Cache-Control", "private, no-store")
    c.JSON(http.StatusOK, page)
}

type ownerShareLinkDTO struct {
    Token       string `json:"token"`
    LegacyAlias bool   `json:"legacy_alias"`
}

// Reveals a stable capability only on an explicit authenticated Owner action.
// For historical hash-only shares the original random token is irreversible;
// create ONE persistent alias on the SAME row, retaining the old token hash.
func (s *Server) copyOwnShareLink(c *gin.Context) {
    shareID, ok := parseID(c.Param("id"))
    if !ok {
        fail(c, http.StatusBadRequest, "invalid share id")
        return
    }
    if s.ConnectorSecrets == nil {
        fail(c, http.StatusServiceUnavailable, "share link encryption keyring is not configured")
        return
    }
    now := time.Now()
    var result ownerShareLinkDTO
    err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
        var share meta.Share
        if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
            Where("id = ? AND owner_id = ?", shareID, userID(c)).
            First(&share).Error; err != nil { return err }
        if shareStatus(share, now) != "active" { return errShareUnavailable }
        var node meta.Node
        if err := tx.Select("id", "type").
            Where("id = ? AND owner_id = ? AND deleted_at IS NULL",
                share.NodeID, share.OwnerID).First(&node).Error; err != nil { return err }
        if node.Type != meta.NodeTypeDir && node.Type != meta.NodeTypeFile {
            return errShareUnavailable
        }
        if share.LinkTokenKeyVersion != 0 || len(share.LinkTokenCiphertext) != 0 {
            if share.LinkTokenKeyVersion == 0 || len(share.LinkTokenCiphertext) == 0 {
                return errors.New("incomplete share link ciphertext")
            }
            data, err := s.ConnectorSecrets.OpenShareToken(
                share.ID, share.LinkTokenKeyVersion, share.LinkTokenCiphertext)
            if err != nil { return err }
            token := string(data)
            tokenHash := hashShareToken(token)
            if tokenHash != share.TokenHash &&
                (share.LinkAliasHash == nil || tokenHash != *share.LinkAliasHash) {
                return errors.New("share link token/hash mismatch")
            }
            result.Token, result.LegacyAlias = token, tokenHash != share.TokenHash
            return nil
        }
        token, hash, err := generateShareToken()
        if err != nil { return err }
        version, ciphertext, err := s.ConnectorSecrets.SealShareToken(share.ID, []byte(token))
        if err != nil { return err }
        if err := tx.Model(&share).Updates(map[string]any{
            "link_alias_hash": hash,
            "link_token_ciphertext": ciphertext,
            "link_token_key_version": version,
        }).Error; err != nil { return err }
        result.Token, result.LegacyAlias = token, true
        return nil
    })
    if err != nil {
        switch {
        case errors.Is(err, gorm.ErrRecordNotFound):
            fail(c, http.StatusNotFound, "share not found")
        case errors.Is(err, errShareUnavailable):
            fail(c, http.StatusGone, "share unavailable")
        default:
            fail(c, http.StatusServiceUnavailable, "share link cannot be recovered with current encryption keys")
        }
        return
    }
    c.Header("Cache-Control", "private, no-store")
    c.Header("Referrer-Policy", "no-referrer")
    c.JSON(http.StatusOK, result)
}
