package client

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"strings"
)

const OwnerLiveMotionMaxBytes = 4 << 20
const OwnerLiveMotionMaxSafeID uint64 = (1 << 53) - 1

// One on-demand, Owner-verified Live Photo motion. Binary data is bounded
// before any IPC JSON response; never return a media ticket, source path, CAS
// key, Server URL, authorization header, GPS or raw metadata.
type OwnerLiveMotion struct {
	NodeID   uint64 `json:"node_id"`
	Revision uint64 `json:"revision"`
	MIMEType string `json:"mime_type"`
	Size     int    `json:"size"`
	SHA256   string `json:"sha256"`
	Data     []byte `json:"data"`
}

type OwnerLiveMotionSource interface {
	MediaItem(context.Context, uint64) (MediaItem, error)
	MediaLivePhotoMotion(context.Context, uint64) (io.ReadCloser, string, int64, error)
}

func validOwnerLiveSource(item MediaItem, id, revision uint64) bool {
	return item.LivePhoto && item.Node.ID == id && item.Node.Revision == revision &&
		item.Node.Type == "file" && item.Metadata.MediaKind == "image"
}

func ownerLiveMotionMIME(value string) bool {
	return value == "video/mp4" || value == "video/quicktime"
}

func ownerLiveMotionSignature(value []byte) bool {
	return len(value) >= 12 && string(value[4:8]) == "ftyp"
}

func ValidateOwnerLiveMotion(m OwnerLiveMotion, id, revision uint64) bool {
	if id == 0 || id > OwnerLiveMotionMaxSafeID ||
		revision == 0 || revision > OwnerLiveMotionMaxSafeID ||
		m.NodeID != id || m.Revision != revision ||
		!ownerLiveMotionMIME(m.MIMEType) ||
		m.Size < 12 || m.Size > OwnerLiveMotionMaxBytes ||
		len(m.Data) != m.Size || !ownerLiveMotionSignature(m.Data) ||
		len(m.SHA256) != 64 || strings.ToLower(m.SHA256) != m.SHA256 {
		return false
	}
	digest, err := hex.DecodeString(m.SHA256)
	if err != nil || len(digest) != sha256.Size {
		return false
	}
	sum := sha256.Sum256(m.Data)
	return bytes.Equal(sum[:], digest)
}

// No speculative motion load: the authenticated Server proves the *current*
// exact photo both BEFORE and AFTER returning the bounded motion bytes.
// This intentionally does not cache, persist or replay old media tickets.
func ReadVerifiedOwnerLiveMotion(ctx context.Context, src OwnerLiveMotionSource, id, revision uint64) (OwnerLiveMotion, error) {
	var empty OwnerLiveMotion
	if ctx == nil || ctx.Err() != nil || src == nil ||
		id == 0 || id > OwnerLiveMotionMaxSafeID || revision == 0 ||
		revision > OwnerLiveMotionMaxSafeID {
		return empty, errors.New("invalid Owner Live Photo request")
	}
	first, err := src.MediaItem(ctx, id)
	if err != nil || !validOwnerLiveSource(first, id, revision) {
		return empty, errors.New("Owner Live Photo not current or unavailable")
	}
	body, mimeType, contentLength, err := src.MediaLivePhotoMotion(ctx, id)
	if err != nil {
		if body != nil {
			_ = body.Close()
		}
		return empty, errors.New("Server Owner motion unavailable")
	}
	if body == nil {
		return empty, errors.New("Owner Live Photo motion is empty")
	}
	defer body.Close()
	if !ownerLiveMotionMIME(mimeType) ||
		contentLength == 0 || contentLength > OwnerLiveMotionMaxBytes {
		return empty, errors.New("Owner Live Photo motion exceeds bounded playback")
	}
	data, err := io.ReadAll(io.LimitReader(body, OwnerLiveMotionMaxBytes+1))
	if err != nil || len(data) > OwnerLiveMotionMaxBytes ||
		!ownerLiveMotionSignature(data) ||
		(contentLength > 0 && int64(len(data)) != contentLength) ||
		ctx.Err() != nil {
		return empty, errors.New("Owner Live Photo motion failed byte verification")
	}
	last, err := src.MediaItem(ctx, id)
	if err != nil || !validOwnerLiveSource(last, id, revision) || ctx.Err() != nil {
		return empty, errors.New("Owner Live Photo changed during playback admission")
	}
	digest := sha256.Sum256(data)
	value := OwnerLiveMotion{
		NodeID: id, Revision: revision, MIMEType: mimeType,
		Size: len(data), SHA256: hex.EncodeToString(digest[:]), Data: data,
	}
	if !ValidateOwnerLiveMotion(value, id, revision) {
		return empty, errors.New("invalid Owner Live Photo projection")
	}
	return value, nil
}
