package localbackupipc

import (
    "context"
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "strings"
    "testing"
    "time"

    "github.com/lazyxu/xdrive/internal/client"
)

func TestOwnerSearchPageIsBoundedAndOwnerScoped(t *testing.T) {
    parent := uint64(17)
    now := time.Now().UTC()
    valid := client.SearchPage{
        Items: []client.SearchResult{{
            Node: client.Node{
                ID: 42, ParentID: &parent, Name: "family.jpg", Type: "file",
                Size: 1200, Revision: 3, CreatedAt: now, UpdatedAt: now,
            },
            Breadcrumbs: []client.SearchBreadcrumb{{ID: 1, Name: "Cloud"}, {ID: 17, Name: "Photos"}},
            Path: "Photos/family.jpg",
        }},
        NextCursor: "next-page",
    }
    reads := 0
    response := valid
    server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        reads++
        if r.Method != http.MethodGet || r.URL.Path != "/v1/cloud/owner-search" ||
            r.URL.Query().Get("q") != "family" ||
            r.URL.Query().Get("cursor") != "cursor%2B" ||
            r.Header.Get("Authorization") != "Bearer "+strings.Repeat("a", 64) {
            t.Errorf("untrusted Owner search request: %s %s", r.Method, r.URL.String())
        }
        w.Header().Set("Content-Type", "application/json")
        _ = json.NewEncoder(w).Encode(response)
    }))
    defer server.Close()
    agent := &Client{baseURL: server.URL, token: strings.Repeat("a", 64), http: server.Client()}
    if _, err := agent.OwnerSearchPage(context.Background(), "family", "cursor%2B"); err == nil || reads != 0 {
        t.Fatal("old Agent searched without an explicit capability")
    }
    agent.capabilities = []string{"cloud-owner-search-read"}
    page, err := agent.OwnerSearchPage(context.Background(), "family", "cursor%2B")
    if err != nil || len(page.Items) != 1 || !page.HasMore || page.NextCursor != "next-page" ||
        page.Items[0].Node.ID != 42 || page.Items[0].Crumbs[1].ID != 17 {
        t.Fatalf("valid Owner search projection failed: %+v, %v", page, err)
    }
    for _, q := range []string{"", "a", "  family", "family ", "x\ny", strings.Repeat("a", 513)} {
        if _, err := agent.OwnerSearchPage(context.Background(), q, ""); err == nil {
            t.Fatalf("invalid Owner query accepted: %q", q)
        }
    }
    for _, cursor := range []string{"x\ny", strings.Repeat("z", 1025)} {
        if _, err := agent.OwnerSearchPage(context.Background(), "family", cursor); err == nil {
            t.Fatal("bad cursor accepted")
        }
    }
    if reads != 1 { t.Fatalf("invalid selectors reached Agent: %d", reads) }
    response = valid
    response.Items[0].Node.ParentID = new(uint64)
    if _, err := agent.OwnerSearchPage(context.Background(), "family", "cursor%2B"); err == nil {
        t.Fatal("foreign or missing parent entered Owner search")
    }
    response = valid
    response.Items[0].Node.ParentID = &parent
    response.Items[0].Breadcrumbs = []client.SearchBreadcrumb{{ID: 1, Name: "Cloud"}, {ID: 99, Name: "Foreign"}}
    if _, err := agent.OwnerSearchPage(context.Background(), "family", "cursor%2B"); err == nil {
        t.Fatal("foreign breadcrumb entered Owner search")
    }
    response = valid
    response.Items = []client.SearchResult{valid.Items[0], valid.Items[0]}
    if _, err := agent.OwnerSearchPage(context.Background(), "family", "cursor%2B"); err == nil {
        t.Fatal("duplicate search result accepted")
    }
    response = valid
    response.NextCursor = "cursor%2B"
    if _, err := agent.OwnerSearchPage(context.Background(), "family", "cursor%2B"); err == nil {
        t.Fatal("non-advancing search cursor accepted")
    }
}
