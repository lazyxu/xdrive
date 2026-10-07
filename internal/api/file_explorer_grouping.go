package api

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

type fileExplorerGrouping struct {
	Group        string
	FoldersFirst bool
}

type fileExplorerGroupIndexDTO struct {
	Key        string `json:"key"`
	ItemCount  int64  `json:"item_count"`
	StartIndex int64  `json:"start_index"`
}

type fileExplorerGroupRow struct {
	Key       string `gorm:"column:group_key"`
	ItemCount int64  `gorm:"column:item_count"`
}

type fileExplorerGroupFields struct {
	Type    string
	Name    string
	Updated string
	Size    string
}

func parseFileExplorerGrouping(c *gin.Context, rangeRequested bool) (fileExplorerGrouping, bool) {
	grouping := fileExplorerGrouping{
		Group:        strings.TrimSpace(strings.ToLower(c.Query("group"))),
		FoldersFirst: true,
	}
	if grouping.Group == "" {
		grouping.Group = "none"
	}
	switch grouping.Group {
	case "none", "type", "modified", "size":
	default:
		fail(c, http.StatusBadRequest, "group must be none, type, modified, or size")
		return fileExplorerGrouping{}, false
	}

	if rawValues, exists := c.Request.URL.Query()["folders_first"]; exists {
		raw := ""
		if len(rawValues) > 0 {
			raw = strings.TrimSpace(strings.ToLower(rawValues[0]))
		}
		value, err := strconv.ParseBool(raw)
		if err != nil {
			fail(c, http.StatusBadRequest, "folders_first must be true or false")
			return fileExplorerGrouping{}, false
		}
		grouping.FoldersFirst = value
	}

	if !rangeRequested {
		if _, exists := c.Request.URL.Query()["group"]; exists {
			fail(c, http.StatusBadRequest, "group requires offset")
			return fileExplorerGrouping{}, false
		}
		if _, exists := c.Request.URL.Query()["folders_first"]; exists {
			fail(c, http.StatusBadRequest, "folders_first requires offset")
			return fileExplorerGrouping{}, false
		}
	}
	return grouping, true
}

func fileExplorerExtensionExpr(nameExpr string) string {
	return fmt.Sprintf(
		"(CASE WHEN strpos(%[1]s, '.') > 1 AND right(%[1]s, 1) <> '.' "+
			"THEN lower(reverse(split_part(reverse(%[1]s), '.', 1))) ELSE '' END)",
		nameExpr,
	)
}

func fileExplorerGroupKeyExpr(
	fields fileExplorerGroupFields,
	grouping fileExplorerGrouping,
) string {
	switch grouping.Group {
	case "type":
		extension := fileExplorerExtensionExpr(fields.Name)
		return fmt.Sprintf(
			"(CASE WHEN %s = 'dir' THEN 'folder' WHEN %s = '' THEN 'other' ELSE 'ext:' || %s END)",
			fields.Type,
			extension,
			extension,
		)
	case "modified":
		return fmt.Sprintf(
			"(CASE WHEN %s IS NULL THEN 'unknown' ELSE 'month:' || TO_CHAR(%s AT TIME ZONE 'UTC', 'YYYY-MM') END)",
			fields.Updated,
			fields.Updated,
		)
	case "size":
		return fmt.Sprintf(
			"(CASE WHEN %s = 'dir' THEN 'folder' WHEN %s <= 0 THEN 'empty' "+
				"WHEN %s < 1048576 THEN 'tiny' WHEN %s < 104857600 THEN 'small' "+
				"WHEN %s < 1073741824 THEN 'medium' ELSE 'large' END)",
			fields.Type,
			fields.Size,
			fields.Size,
			fields.Size,
			fields.Size,
		)
	default:
		return "''"
	}
}

func fileExplorerFolderRankExpr(typeExpr string) string {
	return fmt.Sprintf("(CASE WHEN %s = 'dir' THEN 0 ELSE 1 END)", typeExpr)
}

func fileExplorerGroupOrder(
	fields fileExplorerGroupFields,
	grouping fileExplorerGrouping,
) string {
	groupKey := fileExplorerGroupKeyExpr(fields, grouping)
	switch grouping.Group {
	case "type":
		folderRank := 0
		if !grouping.FoldersFirst {
			folderRank = 2
		}
		return fmt.Sprintf(
			"(CASE WHEN %s = 'folder' THEN %d ELSE 1 END) ASC, %s ASC",
			groupKey,
			folderRank,
			groupKey,
		)
	case "modified":
		return fmt.Sprintf(
			"(CASE WHEN %s = 'unknown' THEN 1 ELSE 0 END) ASC, %s DESC",
			groupKey,
			groupKey,
		)
	case "size":
		folderRank := 0
		if !grouping.FoldersFirst {
			folderRank = 6
		}
		return fmt.Sprintf(
			"(CASE %s WHEN 'folder' THEN %d WHEN 'empty' THEN 1 WHEN 'tiny' THEN 2 "+
				"WHEN 'small' THEN 3 WHEN 'medium' THEN 4 WHEN 'large' THEN 5 ELSE 7 END) ASC",
			groupKey,
			folderRank,
		)
	default:
		return ""
	}
}

func fileExplorerItemOrderPrefix(
	fields fileExplorerGroupFields,
	grouping fileExplorerGrouping,
) string {
	parts := make([]string, 0, 3)
	if grouping.Group != "none" {
		parts = append(parts, fileExplorerGroupOrder(fields, grouping))
		if grouping.Group == "modified" && grouping.FoldersFirst {
			parts = append(parts, fileExplorerFolderRankExpr(fields.Type)+" ASC")
		}
	} else if grouping.FoldersFirst {
		parts = append(parts, fileExplorerFolderRankExpr(fields.Type)+" ASC")
	}
	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, ", ") + ", "
}

func fileExplorerGroupIndexes(rows []fileExplorerGroupRow) []fileExplorerGroupIndexDTO {
	groups := make([]fileExplorerGroupIndexDTO, 0, len(rows))
	var start int64
	for _, row := range rows {
		if row.ItemCount <= 0 || strings.TrimSpace(row.Key) == "" {
			continue
		}
		groups = append(groups, fileExplorerGroupIndexDTO{
			Key:        row.Key,
			ItemCount:  row.ItemCount,
			StartIndex: start,
		})
		start += row.ItemCount
	}
	return groups
}
