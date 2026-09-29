package yike

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"
)

type UserInfo struct {
	YouaID   string `json:"youa_id"`
	Nickname string `json:"nickname,omitempty"`
}

type FlexibleBoolInt int

func (v *FlexibleBoolInt) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	switch string(data) {
	case "", "null", "false":
		*v = 0
		return nil
	case "true":
		*v = 1
		return nil
	}
	var value int
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*v = FlexibleBoolInt(value)
	return nil
}

type FlexibleString string

func (s *FlexibleString) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	if len(data) == 0 || bytes.Equal(data, []byte("null")) {
		*s = ""
		return nil
	}
	if data[0] == '"' {
		var value string
		if err := json.Unmarshal(data, &value); err != nil {
			return err
		}
		*s = FlexibleString(value)
		return nil
	}
	var number json.Number
	if err := json.Unmarshal(data, &number); err != nil {
		return err
	}
	*s = FlexibleString(number.String())
	return nil
}

type Page struct {
	HasMore FlexibleBoolInt `json:"has_more"`
	Cursor  FlexibleString  `json:"cursor"`
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
	FSID           int64              `json:"fsid"`
	FSIDAlt        int64              `json:"fs_id,omitempty"`
	FileID         int64              `json:"file_id,omitempty"`
	Path           string             `json:"path"`
	ServerFilename string             `json:"server_filename,omitempty"`
	Filename       string             `json:"filename,omitempty"`
	Name           string             `json:"name,omitempty"`
	Size           int64              `json:"size"`
	FileSize       int64              `json:"file_size,omitempty"`
	Bytes          int64              `json:"bytes,omitempty"`
	CTime          int64              `json:"ctime"`
	ServerCTime    int64              `json:"server_ctime,omitempty"`
	CreateTime     int64              `json:"create_time,omitempty"`
	MTime          int64              `json:"mtime"`
	ServerMTime    int64              `json:"server_mtime,omitempty"`
	ModifyTime     int64              `json:"modify_time,omitempty"`
	Uptime         int64              `json:"uptime,omitempty"`
	ShootTime      int64              `json:"shoot_time,omitempty"`
	ShootTimeCamel int64              `json:"shootTime,omitempty"`
	ThumbURL       FlexibleStringList `json:"thumburl,omitempty"`
	MD5            string             `json:"md5,omitempty"`
}

func (f *File) Normalize() {
	if f == nil {
		return
	}
	if f.FSID <= 0 {
		switch {
		case f.FSIDAlt > 0:
			f.FSID = f.FSIDAlt
		case f.FileID > 0:
			f.FSID = f.FileID
		}
	}
	if f.Size <= 0 {
		switch {
		case f.FileSize > 0:
			f.Size = f.FileSize
		case f.Bytes > 0:
			f.Size = f.Bytes
		}
	}
	if f.CTime <= 0 {
		switch {
		case f.ServerCTime > 0:
			f.CTime = f.ServerCTime
		case f.CreateTime > 0:
			f.CTime = f.CreateTime
		}
	}
	if f.MTime <= 0 {
		switch {
		case f.ServerMTime > 0:
			f.MTime = f.ServerMTime
		case f.ModifyTime > 0:
			f.MTime = f.ModifyTime
		case f.Uptime > 0:
			f.MTime = f.Uptime
		}
	}
	if f.ShootTime <= 0 && f.ShootTimeCamel > 0 {
		f.ShootTime = f.ShootTimeCamel
	}
}

func (f File) VisibleName() string {
	for _, candidate := range []string{f.ServerFilename, f.Filename, f.Name} {
		if strings.TrimSpace(candidate) != "" {
			// Preserve leading whitespace here; canonical filename handling
			// removes only filesystem-incompatible trailing space/dot later.
			return candidate
		}
	}
	remotePath := strings.ReplaceAll(f.Path, "\\", "/")
	remotePath = strings.TrimRight(remotePath, "/")
	if strings.TrimSpace(remotePath) != "" {
		if i := strings.LastIndexByte(remotePath, '/'); i >= 0 {
			remotePath = remotePath[i+1:]
		}
		if strings.TrimSpace(remotePath) != "" {
			if decoded, err := url.PathUnescape(remotePath); err == nil {
				remotePath = decoded
			}
			return remotePath
		}
	}
	return ""
}

func (f File) ModifiedAt() time.Time { return time.Unix(f.MTime, 0).UTC() }

type FileList struct {
	Page
	List            []File         `json:"list"`
	Items           []File         `json:"items,omitempty"`
	Files           []File         `json:"files,omitempty"`
	FileList        []File         `json:"file_list,omitempty"`
	FileListCompact []File         `json:"filelist,omitempty"`
	NextCursor      FlexibleString `json:"next_cursor,omitempty"`
	NextCursorCamel FlexibleString `json:"nextCursor,omitempty"`
	HasMoreCamel    *bool          `json:"hasMore,omitempty"`
	TotalCount      int64          `json:"total_count,omitempty"`
}

func (l *FileList) Normalize() {
	if l == nil {
		return
	}
	if len(l.List) == 0 {
		switch {
		case len(l.Items) != 0:
			l.List = l.Items
		case len(l.Files) != 0:
			l.List = l.Files
		case len(l.FileList) != 0:
			l.List = l.FileList
		case len(l.FileListCompact) != 0:
			l.List = l.FileListCompact
		}
	}
	for i := range l.List {
		l.List[i].Normalize()
	}
	if strings.TrimSpace(string(l.Cursor)) == "" {
		switch {
		case strings.TrimSpace(string(l.NextCursor)) != "":
			l.Cursor = FlexibleString(strings.TrimSpace(string(l.NextCursor)))
			if l.HasMore == 0 {
				l.HasMore = 1
			}
		case strings.TrimSpace(string(l.NextCursorCamel)) != "":
			l.Cursor = FlexibleString(strings.TrimSpace(string(l.NextCursorCamel)))
			if l.HasMore == 0 {
				l.HasMore = 1
			}
		}
	}
	if l.HasMoreCamel != nil {
		if *l.HasMoreCamel {
			l.HasMore = 1
		} else {
			l.HasMore = 0
		}
	}
	if l.HasMore == 0 && l.TotalCount > int64(len(l.List)) && strings.TrimSpace(string(l.Cursor)) != "" {
		l.HasMore = 1
	}
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
