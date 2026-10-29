package synologyui

import (
	"context"
	"net/http"
	"net/url"
	"strconv"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

// This is a DSM-authenticated fixed read capability, NOT a signed ticket,
// dynamic player, arbitrary proxy, NAS file read or elevated Owner selector.
func serveOwnerLiveMotion(w http.ResponseWriter, r *http.Request, agent Agent) {
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(q) != 2 || len(q["node_id"]) != 1 || len(q["revision"]) != 1 {
		http.Error(w, "invalid Owner Live Photo selector", http.StatusBadRequest)
		return
	}
	id, e1 := strconv.ParseUint(q.Get("node_id"), 10, 64)
	rev, e2 := strconv.ParseUint(q.Get("revision"), 10, 64)
	if e1 != nil || e2 != nil || id == 0 || rev == 0 ||
		id > client.OwnerLiveMotionMaxSafeID || rev > client.OwnerLiveMotionMaxSafeID ||
		strconv.FormatUint(id, 10) != q.Get("node_id") ||
		strconv.FormatUint(rev, 10) != q.Get("revision") {
		http.Error(w, "invalid Owner Live Photo identity", http.StatusBadRequest)
		return
	}
	reader, ok := agent.(interface {
		OwnerLiveMotion(context.Context, uint64, uint64) (localbackupipc.OwnerLiveMotion, error)
	})
	if !ok {
		http.Error(w, "Owner Live Photo unavailable", http.StatusNotImplemented)
		return
	}
	motion, err := reader.OwnerLiveMotion(r.Context(), id, rev)
	if err != nil || !localbackupipc.ValidateOwnerLiveMotion(motion, id, rev) {
		http.Error(w, "verified Owner Live Photo unavailable", http.StatusServiceUnavailable)
		return
	}
	sendJSON(w, motion)
}
