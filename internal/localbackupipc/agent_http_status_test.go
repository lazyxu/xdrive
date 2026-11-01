package localbackupipc

import (
    "errors"
    "net/http"
    "testing"
)

func TestAgentHTTPStatusErrorNeverContainsCredentials(t *testing.T) {
    err := &AgentHTTPStatusError{Method: http.MethodPost, StatusCode: http.StatusUnauthorized}
    var typed *AgentHTTPStatusError
    if !errors.As(err, &typed) || typed.StatusCode != 401 ||
        err.Error() != "owning Agent rejected POST (HTTP 401)" {
        t.Fatal("Agent HTTP error must be structured and contain no response body")
    }
}
