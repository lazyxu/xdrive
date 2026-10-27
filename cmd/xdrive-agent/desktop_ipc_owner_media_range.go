package main

import (
	"context"
	"math"
	"net/http"
	"net/url"
	"strconv"

	"github.com/lazyxu/xdrive/internal/client"
)

// This optional controller method preserves the existing Desktop fake IPC
// contract. Backup-only and full Agents both enforce the same exact GET gate.
type desktopIPCOwnerMediaRangeReader interface {
	CloudOwnerMediaRange(context.Context, uint64, uint64, int64, int) (client.OwnerMediaRange, error)
}

func (h *desktopIPCHandler) cloudOwnerMediaRange(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(q) != 4 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_owner_media_range", "four canonical range fields required")
		return
	}
	for _, key := range []string{"node_id", "revision", "offset", "length"} {
		if len(q[key]) != 1 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_owner_media_range", "invalid or repeated range selector")
			return
		}
	}
	nodeID, errNode := strconv.ParseUint(q.Get("node_id"), 10, 64)
	revision, errRevision := strconv.ParseUint(q.Get("revision"), 10, 64)
	offset, errOffset := strconv.ParseInt(q.Get("offset"), 10, 64)
	length, errLength := strconv.Atoi(q.Get("length"))
	if errNode != nil || errRevision != nil || errOffset != nil || errLength != nil ||
		nodeID < 1 || nodeID > 1<<53-1 ||
		revision < 1 || revision > 1<<53-1 ||
		offset < 0 || offset > 1<<53-1 ||
		length < 1 || length > client.OwnerMediaRangeMaxBytes ||
		offset > math.MaxInt64-int64(length) ||
		q.Get("node_id") != strconv.FormatUint(nodeID, 10) ||
		q.Get("revision") != strconv.FormatUint(revision, 10) ||
		q.Get("offset") != strconv.FormatInt(offset, 10) ||
		q.Get("length") != strconv.Itoa(length) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_owner_media_range", "invalid immutable range fields")
		return
	}
	reader, ok := h.ctrl.(desktopIPCOwnerMediaRangeReader)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "owner_media_range_unavailable", "owning Agent does not support range reads")
		return
	}
	result, err := reader.CloudOwnerMediaRange(r.Context(), nodeID, revision, offset, length)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	if result.Revision != revision || result.Offset != offset ||
		result.Total <= offset || result.Total > 1<<53-1 ||
		len(result.Data) == 0 || len(result.Data) > length ||
		int64(len(result.Data)) > result.Total-offset ||
		(int64(len(result.Data)) < int64(length) && offset+int64(len(result.Data)) != result.Total) {
		writeDesktopIPCError(w, http.StatusServiceUnavailable, "invalid_owner_media_data", "inconsistent verified range projection")
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}
