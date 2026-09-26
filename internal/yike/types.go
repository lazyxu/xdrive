package yike

import (
	"fmt"
	"time"
)

type UserInfo struct {
	YouaID string `json:"youa_id"`
}

type Page struct {
	HasMore int    `json:"has_more"`
	Cursor  string `json:"cursor"`
}

func (p Page) HasNext() bool { return p.HasMore == 1 }

type File struct {
	FSID     int64    `json:"fsid"`
	Path     string   `json:"path"`
	Size     int64    `json:"size"`
	CTime    int64    `json:"ctime"`
	MTime    int64    `json:"mtime"`
	ThumbURL []string `json:"thumburl,omitempty"`
	MD5      string   `json:"md5,omitempty"`
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
