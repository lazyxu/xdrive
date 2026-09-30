package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourcecredential"
	"github.com/lazyxu/xdrive/internal/synology"
	"gorm.io/gorm"
)

const (
	defaultSourceBrowseLimit = 200
	maxSourceBrowseLimit     = 1000
)

type sourceFileStationBrowser func(
	context.Context,
	synology.Credential,
	string,
	int,
	int,
) (synology.FileStationPage, error)

type sourceBrowseDirectoryDTO struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type sourceBrowsePageDTO struct {
	Path       string                     `json:"path,omitempty"`
	Items      []sourceBrowseDirectoryDTO `json:"items"`
	Total      int                        `json:"total"`
	NextOffset *int                       `json:"next_offset,omitempty"`
}

func (s *Server) browseSourceDirectories(c *gin.Context) {
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	source, err := s.ownedSource(userID(c), sourceID)
	if err != nil {
		fail(c, statusForLookup(err), "source not found")
		return
	}
	if source.Kind != synologyFilesSourceKind || source.Direction != meta.SourceDirectionPull {
		fail(c, http.StatusBadRequest, "source_browse_unsupported")
		return
	}
	if s.ConnectorSecrets == nil {
		fail(c, http.StatusServiceUnavailable, "source credential encryption is not configured")
		return
	}

	remotePath := c.Query("path")
	if remotePath == "/" {
		fail(c, http.StatusBadRequest, "use an empty path to browse File Station shares")
		return
	}
	if remotePath != "" {
		normalized, err := synology.NormalizeFileStationPath(remotePath)
		if err != nil {
			fail(c, http.StatusBadRequest, "invalid File Station browse path")
			return
		}
		remotePath = normalized
	}

	offset, ok := parseSourceBrowseInt(c.Query("offset"), 0, 0, 1_000_000_000)
	if !ok {
		fail(c, http.StatusBadRequest, "invalid browse offset")
		return
	}
	limit, ok := parseSourceBrowseInt(c.Query("limit"), defaultSourceBrowseLimit, 1, maxSourceBrowseLimit)
	if !ok {
		fail(c, http.StatusBadRequest, "invalid browse limit")
		return
	}

	plaintext, err := sourcecredential.Get(c.Request.Context(), s.DB, s.ConnectorSecrets, source)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusConflict, "source_credential_not_configured")
			return
		}
		fail(c, http.StatusInternalServerError, "load source credential failed")
		return
	}
	defer clear(plaintext)

	var credential synology.Credential
	if err := json.Unmarshal(plaintext, &credential); err != nil {
		fail(c, http.StatusInternalServerError, "decode source credential failed")
		return
	}

	page, err := s.fileStationBrowser()(c.Request.Context(), credential, remotePath, offset, limit)
	credential.Password = ""
	if err != nil {
		writeSourceCredentialTestError(c, source.Kind, err)
		return
	}

	items := make([]sourceBrowseDirectoryDTO, 0, len(page.Entries))
	for _, entry := range page.Entries {
		if !entry.IsDir {
			continue
		}
		items = append(items, sourceBrowseDirectoryDTO{Name: entry.Name, Path: entry.Path})
	}
	var nextOffset *int
	next := page.Offset + len(page.Entries)
	if next < page.Total {
		nextOffset = &next
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, sourceBrowsePageDTO{
		Path: remotePath, Items: items, Total: page.Total, NextOffset: nextOffset,
	})
}

func parseSourceBrowseInt(raw string, fallback, minimum, maximum int) (int, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fallback, true
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < minimum || value > maximum {
		return 0, false
	}
	return value, true
}

func (s *Server) fileStationBrowser() sourceFileStationBrowser {
	if s.fileStationBrowse != nil {
		return s.fileStationBrowse
	}
	return func(
		ctx context.Context,
		credential synology.Credential,
		remotePath string,
		offset int,
		limit int,
	) (synology.FileStationPage, error) {
		client, err := synology.New(credential)
		if err != nil {
			return synology.FileStationPage{}, err
		}
		session, err := client.ConnectFileStation(ctx)
		credential.Password = ""
		if err != nil {
			return synology.FileStationPage{}, err
		}
		defer func() {
			closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = session.Close(closeCtx)
		}()
		if remotePath == "" {
			return session.ListSharesPage(ctx, offset, limit)
		}
		return session.ListFolderPage(ctx, remotePath, offset, limit)
	}
}
