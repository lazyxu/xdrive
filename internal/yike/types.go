package yike

import (
	"bytes"
	"encoding/json"
	"fmt"
	"time"
)

type UserInfo struct {
	YouaID   string `json:"youa_id"`
	Nickname string `json:"nickname,omitempty"`
}

type Page struct {
	HasMore int    `json:"has_more"`
	Cursor  string `json:"cursor"`
}

func (p Page) HasNext() bool { return p.HasMore == 1 }

type FlexibleStringList []string

func (s *FlexibleStringList) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	if len(data) == 0 || bytes.Equal(data, []byte("null")) {
		*s = nil
		return nil
	}
	switch data[0] {
	case '"':
		var value string
		if err := json.Unmarshal(data, &value); err != nil {
			return err
		}
		if value == "" {
			*s = nil
		} else {
			*s = FlexibleStringList{value}
		}
		return nil
	case '[':
		var rawValues []json.RawMessage
		if err := json.Unmarshal(data, &rawValues); err != nil {
			return err
		}
		values := make(FlexibleStringList, 0, len(rawValues))
		for _, raw := range rawValues {
			var value string
			if err := json.Unmarshal(raw, &value); err == nil && value != "" {
				values = append(values, value)
			}
		}
		*s = values
		return nil
	default:
		// Thumbnail metadata is optional and has changed shape in the private
		// Yike API. Ignore unknown-but-valid JSON instead of failing a full scan.
		var ignored any
		if err := json.Unmarshal(data, &ignored); err != nil {
			return err
		}
		*s = nil
		return nil
	}
}

type File struct {
	FSID      int64              `json:"fsid"`
	Path      string             `json:"path"`
	Size      int64              `json:"size"`
	CTime     int64              `json:"ctime"`
	MTime     int64              `json:"mtime"`
	ShootTime int64              `json:"shoot_time,omitempty"`
	ThumbURL  FlexibleStringList `json:"thumburl,omitempty"`
	MD5       string             `json:"md5,omitempty"`
}

func (f File) ModifiedAt() time.Time { return time.Unix(f.MTime, 0).UTC() }

type FileList struct {
	Page
	List []File `json:"list"`
}

type Album struct {
	AlbumID      string `json:"album_id"`
	TID          int64  `json:"tid"`
	Title        string `json:"title"`
	JoinTime     int64  `json:"join_time"`
	CreationTime int64  `json:"create_time"`
	MTime        int64  `json:"mtime"`
}

type AlbumList struct {
	Page
	List       []Album `json:"list"`
	Reset      int64   `json:"reset"`
	TotalCount int64   `json:"total_count"`
}

type AlbumFile struct {
	File
	AlbumID string `json:"album_id"`
	TID     int64  `json:"tid"`
	UK      int64  `json:"uk"`
}

type AlbumFileList struct {
	Page
	List       []AlbumFile `json:"list"`
	Reset      int64       `json:"reset"`
	TotalCount int64       `json:"total_count"`
}

type DownloadLink struct {
	URL     string
	Headers map[string]string
}

func ExternalID(ownerUK, fsid int64) (string, error) {
	if ownerUK <= 0 || fsid <= 0 {
		return "", fmt.Errorf("owner uk and fsid must be positive")
	}
	return fmt.Sprintf("yike:%d:%d", ownerUK, fsid), nil
}

func (f AlbumFile) OwnerUK(fallback int64) int64 {
	if f.UK > 0 {
		return f.UK
	}
	return fallback
}
