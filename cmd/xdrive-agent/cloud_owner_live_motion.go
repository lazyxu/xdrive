package main

import (
	"context"
	"net/http"
	"net/url"
	"strconv"

	"github.com/lazyxu/xdrive/internal/client"
)

// Optional capability; no existing Desktop controller/Host gains an implicit
// route. Only the authenticated same-user Agent's current Server session reads.
type cloudOwnerLiveMotionReader interface {
	CloudOwnerLiveMotion(context.Context, uint64, uint64) (client.OwnerLiveMotion, error)
}

func (c *agentController) CloudOwnerLiveMotion(
	ctx context.Context, nodeID, revision uint64,
) (client.OwnerLiveMotion, error) {
	own, _, err := c.cloudClient()
	if err != nil {
		return client.OwnerLiveMotion{}, err
	}
	return client.ReadVerifiedOwnerLiveMotion(ctx, own, nodeID, revision)
}

func ownerLiveMotionSelector(raw string) (nodeID, revision uint64, ok bool) {
	q, err := url.ParseQuery(raw)
	if err != nil || len(q) != 2 || len(q["node_id"]) != 1 || len(q["revision"]) != 1 {
		return 0, 0, false
	}
	nodeID, e1 := strconv.ParseUint(q.Get("node_id"), 10, 64)
	revision, e2 := strconv.ParseUint(q.Get("revision"), 10, 64)
	if e1 != nil || e2 != nil ||
		nodeID == 0 || revision == 0 ||
		nodeID > client.OwnerLiveMotionMaxSafeID || revision > client.OwnerLiveMotionMaxSafeID ||
		strconv.FormatUint(nodeID, 10) != q.Get("node_id") ||
		strconv.FormatUint(revision, 10) != q.Get("revision") {
		return 0, 0, false
	}
	return nodeID, revision, true
}

func (h *desktopIPCHandler) cloudOwnerLiveMotion(w http.ResponseWriter, r *http.Request) {
	id, revision, ok := ownerLiveMotionSelector(r.URL.RawQuery)
	if !ok {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_owner_live_motion", "exact Owner Node/revision required")
		return
	}
	reader, ok := h.ctrl.(cloudOwnerLiveMotionReader)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "owner_live_motion_unavailable", "read-only Live Photo capability unavailable")
		return
	}
	projection, err := reader.CloudOwnerLiveMotion(r.Context(), id, revision)
	if err != nil || !client.ValidateOwnerLiveMotion(projection, id, revision) {
		writeDesktopIPCError(w, http.StatusServiceUnavailable, "owner_live_motion_unavailable", "verified Owner Live Photo unavailable")
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, projection)
}
