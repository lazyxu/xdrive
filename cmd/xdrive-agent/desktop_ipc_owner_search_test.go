package main

import (
    "net/http"
    "testing"
)

func TestBackupOnlyExplicitOwnerSearchCannotOpenDesktopSearch(t *testing.T) {
    capabilities := desktopIPCCapabilitiesForRuntime(true)
    enabled := false
    for _, capability := range capabilities {
        if capability == "cloud-owner-search-read" { enabled = true }
        if capability == "cloud-files" { t.Fatal("Backup-only inherited full cloud files API") }
    }
    if !enabled || fullAgentOnlyRequest(http.MethodGet, "/v1/cloud/owner-search") {
        t.Fatal("bounded Owner search is missing from Backup-only")
    }
    for _, method := range []string{http.MethodPost, http.MethodPatch, http.MethodPut, http.MethodDelete} {
        if !fullAgentOnlyRequest(method, "/v1/cloud/owner-search") {
            t.Fatal("Owner search allowed write method " + method)
        }
    }
    if !fullAgentOnlyRequest(http.MethodGet, "/v1/cloud/search") {
        t.Fatal("full Desktop search unexpectedly available in Backup-only")
    }

    ctrl := &fakeDesktopIPCController{revision: 1}
    handler := newDesktopIPCHandler(ctrl, "secret", func() {}, true)
    for _, selector := range []string{
        "?q=a", "?q=family&sort=updated", "?q=family&q=other",
        "?q=family&cursor=", "?q=family&cursor=bad%0Avalue",
    } {
        w := desktopIPCRequest(t, handler, http.MethodGet, "/v1/cloud/owner-search"+selector, "")
        if w.Code == http.StatusOK {
            t.Fatalf("invalid Owner search selector accepted: %s", selector)
        }
    }
    w := desktopIPCRequest(t, handler, http.MethodGet, "/v1/cloud/owner-search?q=family", "")
    if w.Code != http.StatusOK || ctrl.cloudSearchSort != "name" || ctrl.cloudSearchOrder != "asc" ||
        ctrl.cloudSearchCursor != "" || ctrl.cloudSearchFilters.Active() {
        t.Fatalf("bounded Owner search mismatch: status=%d sort=%q order=%q", w.Code, ctrl.cloudSearchSort, ctrl.cloudSearchOrder)
    }
}
