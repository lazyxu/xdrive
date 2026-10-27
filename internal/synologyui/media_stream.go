package synologyui

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

// Browser HTMLMediaElement uses an ordinary same-origin Range URL. The URL
// has NO authorization power: DSM reauthenticates the current principal and
// discovers the same-user owning Agent for every GET/HEAD request.
const (
	ownerStreamMaxResponseBytes = 1 << 20
	ownerStreamChunkBytes       = 256 << 10
)

type ownerStreamSelector struct {
	nodeID   uint64
	revision uint64
	total    int64
	sha      string
	mime     string
}

func parseOwnerStreamSelector(rawQuery string) (ownerStreamSelector, error) {
	var out ownerStreamSelector
	q, err := url.ParseQuery(rawQuery)
	if err != nil || len(q) != 5 {
		return out, errors.New("invalid Owner stream selector")
	}
	for _, name := range []string{"node_id", "revision", "total", "sha256", "mime"} {
		if len(q[name]) != 1 {
			return out, errors.New("missing or repeated Owner stream selector")
		}
	}
	out.nodeID, err = strconv.ParseUint(q.Get("node_id"), 10, 64)
	if err != nil || !localbackupipc.ValidOwnerFileID(out.nodeID) ||
		strconv.FormatUint(out.nodeID, 10) != q.Get("node_id") {
		return ownerStreamSelector{}, errors.New("invalid Owner stream Node")
	}
	out.revision, err = strconv.ParseUint(q.Get("revision"), 10, 64)
	if err != nil || !localbackupipc.ValidOwnerFileID(out.revision) ||
		strconv.FormatUint(out.revision, 10) != q.Get("revision") {
		return ownerStreamSelector{}, errors.New("invalid Owner stream revision")
	}
	out.total, err = strconv.ParseInt(q.Get("total"), 10, 64)
	if err != nil || out.total <= 0 || uint64(out.total) > localbackupipc.MaxSafeSourceID ||
		strconv.FormatInt(out.total, 10) != q.Get("total") {
		return ownerStreamSelector{}, errors.New("invalid Owner stream size")
	}
	out.sha = q.Get("sha256")
	digest, err := hex.DecodeString(out.sha)
	if err != nil || len(digest) != 32 || strings.ToLower(out.sha) != out.sha {
		return ownerStreamSelector{}, errors.New("invalid Owner stream SHA")
	}
	out.mime = q.Get("mime")
	switch out.mime {
	case "video/mp4", "video/webm",
		"audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/flac":
		return out, nil
	default:
		return ownerStreamSelector{}, errors.New("unsupported Owner stream media type")
	}
}

func ownerStreamMediaSignature(data []byte, mime string) bool {
	starts := func(prefix string) bool {
		return len(data) >= len(prefix) && string(data[:len(prefix)]) == prefix
	}
	switch mime {
	case "video/mp4", "audio/mp4":
		return len(data) >= 8 && string(data[4:8]) == "ftyp"
	case "video/webm":
		return len(data) >= 4 &&
			data[0] == 0x1a && data[1] == 0x45 &&
			data[2] == 0xdf && data[3] == 0xa3
	case "audio/mpeg":
		return starts("ID3") || (len(data) >= 2 &&
			data[0] == 0xff && data[1]&0xe0 == 0xe0)
	case "audio/ogg":
		return starts("OggS")
	case "audio/wav":
		return len(data) >= 12 && starts("RIFF") && string(data[8:12]) == "WAVE"
	case "audio/flac":
		return starts("fLaC")
	default:
		return false
	}
}

// RFC 9110 single-range requests only. A response is at most 1 MiB even
// for open-ended browser requests; the native player seeks/fetches the next
// bounded response itself. We never accept multipart or caller URLs.
func parseOwnerStreamRange(header string, total int64) (start int64, length int, unsatisfiable bool, err error) {
	if total <= 0 || uint64(total) > localbackupipc.MaxSafeSourceID {
		return 0, 0, false, errors.New("invalid Owner stream total")
	}
	if header == "" {
		return 0, int(min(int64(ownerStreamMaxResponseBytes), total)), false, nil
	}
	if len(header) > 96 || !strings.HasPrefix(header, "bytes=") ||
		strings.ContainsAny(header, ", \t\r\n") {
		return 0, 0, false, errors.New("unsupported Owner multipart range")
	}
	spec := strings.TrimPrefix(header, "bytes=")
	bounds := strings.Split(spec, "-")
	if len(bounds) != 2 {
		return 0, 0, false, errors.New("invalid Owner Range")
	}
	if bounds[0] == "" {
		suffix, parseErr := strconv.ParseInt(bounds[1], 10, 64)
		if parseErr != nil || suffix <= 0 || strconv.FormatInt(suffix, 10) != bounds[1] {
			return 0, 0, false, errors.New("invalid Owner suffix Range")
		}
		length64 := min(suffix, total, ownerStreamMaxResponseBytes)
		return total - length64, int(length64), false, nil
	}
	start, parseErr := strconv.ParseInt(bounds[0], 10, 64)
	if parseErr != nil || start < 0 || strconv.FormatInt(start, 10) != bounds[0] {
		return 0, 0, false, errors.New("invalid Owner Range start")
	}
	if start >= total {
		return start, 0, true, nil
	}
	end := total - 1
	if bounds[1] != "" {
		requestedEnd, parseErr := strconv.ParseInt(bounds[1], 10, 64)
		if parseErr != nil || requestedEnd < start ||
			strconv.FormatInt(requestedEnd, 10) != bounds[1] {
			return 0, 0, false, errors.New("invalid Owner Range end")
		}
		end = min(end, requestedEnd)
	}
	end = min(end, start+ownerStreamMaxResponseBytes-1)
	return start, int(end - start + 1), false, nil
}

func ownerStreamRead(
	ctx context.Context, reader OwnerMediaRangeReader, selector ownerStreamSelector,
	start int64, length int,
) ([]byte, error) {
	if reader == nil || length < 1 || length > ownerStreamMaxResponseBytes ||
		start < 0 || start >= selector.total ||
		int64(length) > selector.total-start {
		return nil, errors.New("invalid Owner media stream window")
	}
	out := make([]byte, 0, length)
	for len(out) < length {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		offset := start + int64(len(out))
		asked := min(ownerStreamChunkBytes, length-len(out))
		part, err := reader.OwnerFileMediaRange(ctx, selector.nodeID, selector.revision, offset, asked)
		if err != nil ||
			!localbackupipc.ValidateOwnerMediaRange(part, offset, asked, selector.revision) ||
			part.Total != selector.total || part.SHA256 != selector.sha ||
			len(part.Data) != asked {
			return nil, errors.New("incomplete or stale Owner media stream")
		}
		out = append(out, part.Data...)
	}
	return out, nil
}

func serveOwnerMediaStream(w http.ResponseWriter, r *http.Request, reader OwnerMediaRangeReader) {
	w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// Native media uses the browser's DSM cookies, not a bearer in its URL.
	// Never let a cross-origin page use those cookies for an embedded stream.
	if origin := r.Header.Get("Origin"); origin != "" && origin != "https://"+r.Host {
		http.Error(w, "cross-origin Owner media embedding denied", http.StatusForbidden)
		return
	}
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" &&
		site != "same-origin" && site != "none" {
		http.Error(w, "cross-site Owner media embedding denied", http.StatusForbidden)
		return
	}
	selector, err := parseOwnerStreamSelector(r.URL.RawQuery)
	if err != nil {
		http.Error(w, "invalid Owner media stream selector", http.StatusBadRequest)
		return
	}
	start, length, unsatisfiable, err := parseOwnerStreamRange(r.Header.Get("Range"), selector.total)
	if err != nil {
		http.Error(w, "invalid single Owner media Range", http.StatusBadRequest)
		return
	}
	etag := "\"" + selector.sha + "\""
	if conditional := r.Header.Get("If-Range"); conditional != "" && conditional != etag {
		http.Error(w, "Owner content version changed", http.StatusPreconditionFailed)
		return
	}
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("ETag", etag)
	if unsatisfiable {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", selector.total))
		http.Error(w, "Owner media Range unsatisfiable", http.StatusRequestedRangeNotSatisfiable)
		return
	}
	// A player's first probe can legitimately be bytes=0-1 and seek requests
	// can start deep inside an asset. Independently verify Owner file magic
	// for every request without ever trusting a caller-selected MIME label.
	proofSize := int(min(selector.total, int64(16)))
	proof, err := ownerStreamRead(r.Context(), reader, selector, 0, proofSize)
	if err != nil || !ownerStreamMediaSignature(proof, selector.mime) {
		http.Error(w, "Server Owner media type or content unavailable", http.StatusServiceUnavailable)
		return
	}
	// HEAD uses the same Owner checks while reporting the full resource size.
	if r.Method == http.MethodHead {
		w.Header().Set("Content-Type", selector.mime)
		w.Header().Set("Content-Length", strconv.FormatInt(selector.total, 10))
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "Owner media stream is read only", http.StatusMethodNotAllowed)
		return
	}
	// Buffer one verified <=1 MiB response, then publish headers. A changed
	// revision or Owner between chunks fails BEFORE an HTTP 206 is committed.
	data, err := ownerStreamRead(r.Context(), reader, selector, start, length)
	if err != nil {
		http.Error(w, "Server Owner media unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", selector.mime)
	w.Header().Set("Content-Disposition", "inline")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, start+int64(len(data))-1, selector.total))
	w.WriteHeader(http.StatusPartialContent)
	_, _ = w.Write(data)
}
