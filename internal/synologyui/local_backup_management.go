package synologyui

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localbackupipc"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
)

// LocalBackupManagementAgent is an optional, fixed owner-Agent capability.
// It is deliberately separate from generic Server Source CRUD.
type LocalBackupManagementAgent interface {
	LocalBackupSettings(context.Context, uint64) (client.LocalBoundBackupSettings, error)
	RenameLocalBackupSource(context.Context, uint64, uint64, string) (client.LocalBoundBackupSettings, error)
	RetargetLocalBackupSource(context.Context, uint64, uint64, uint64) (client.LocalBoundBackupSettings, error)
	SetLocalBackupMode(context.Context, uint64, uint64, string) (client.LocalBoundBackupSettings, error)
	LocalBackupRules(context.Context, uint64) (client.LocalBoundIgnoreRules, error)
	SaveLocalBackupRules(context.Context, uint64, uint64, string) (client.LocalBoundIgnoreRules, error)
	RemoveLocalBackupSource(context.Context, uint64, uint64) (client.LocalBoundBackupRemoval, error)
}

func isLocalBackupManagementPath(path string) bool {
	switch path {
	case "/v1/local-source", "/v1/local-source-rename", "/v1/local-target",
		"/v1/local-mode", "/v1/local-rules", "/v1/local-bound-remove":
		return true
	default:
		return false
	}
}

func isLocalBackupManagementMutation(path string) bool {
	switch path {
	case "/v1/local-source-rename", "/v1/local-target", "/v1/local-mode",
		"/v1/local-rules", "/v1/local-bound-remove":
		return true
	default:
		return false
	}
}

func localBackupManagementBodyLimit(path string) int64 {
	if path == "/v1/local-rules" {
		return 4*sourcepkg.MaxIgnoreRulesBytes + 2048
	}
	return 1024
}

func localBackupManagementMethodAllowed(path, method string) bool {
	switch path {
	case "/v1/local-source":
		return method == http.MethodGet
	case "/v1/local-rules":
		return method == http.MethodGet || method == http.MethodPost
	case "/v1/local-source-rename", "/v1/local-target", "/v1/local-mode", "/v1/local-bound-remove":
		return method == http.MethodPost
	default:
		return false
	}
}

// parseLocalBackupMutation requires one exact JSON object: no duplicate,
// unknown, missing, trailing, or oversized fields are forwarded to the Agent.
func parseLocalBackupMutation(r *http.Request, maxBytes int64, fields ...string) ([]byte, error) {
	if r == nil || r.Body == nil || r.ContentLength < 2 || r.ContentLength > maxBytes {
		return nil, errors.New("invalid local backup request size")
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, maxBytes+1))
	if err != nil || int64(len(data)) > maxBytes || int64(len(data)) != r.ContentLength {
		return nil, errors.New("invalid local backup request body")
	}
	allowed := make(map[string]bool, len(fields))
	for _, field := range fields {
		allowed[field] = true
	}
	seen := make(map[string]bool, len(fields))
	decoder := json.NewDecoder(bytes.NewReader(data))
	first, err := decoder.Token()
	if err != nil || first != json.Delim('{') {
		return nil, errors.New("local backup request must be an object")
	}
	for decoder.More() {
		token, err := decoder.Token()
		name, ok := token.(string)
		if err != nil || !ok || !allowed[name] || seen[name] {
			return nil, errors.New("unexpected or duplicate local backup field")
		}
		seen[name] = true
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return nil, errors.New("invalid local backup field")
		}
	}
	last, err := decoder.Token()
	if err != nil || last != json.Delim('}') || len(seen) != len(allowed) {
		return nil, errors.New("incomplete local backup request")
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return nil, errors.New("trailing local backup request data")
	}
	return data, nil
}

func validLocalBackupName(name string) bool {
	return name != "" && strings.TrimSpace(name) == name &&
		len([]byte(name)) <= 128 && !strings.ContainsAny(name, "\x00\r\n")
}

func validLocalBackupSettings(settings client.LocalBoundBackupSettings, sourceID uint64) bool {
	if settings.SourceID != sourceID || settings.Revision == 0 ||
		!validLocalBackupName(settings.Name) ||
		(settings.SyncMode != "backup" && settings.SyncMode != "mirror") ||
		len([]byte(settings.TargetPath)) > 2048 ||
		strings.ContainsAny(settings.TargetPath, "\x00\r\n") {
		return false
	}
	return settings.TargetNodeID == nil || localbackupipc.ValidSourceID(*settings.TargetNodeID)
}

func validLocalBackupRules(rules client.LocalBoundIgnoreRules, sourceID uint64) bool {
	if rules.SourceID != sourceID || rules.Revision == 0 {
		return false
	}
	_, err := sourcepkg.CompileIgnoreRules(rules.IgnoreRules)
	return err == nil
}

func localBackupSourceOwned(ctx context.Context, agent Agent, sourceID uint64) bool {
	if !localbackupipc.ValidSourceID(sourceID) {
		return false
	}
	schedule, err := agent.ReadSchedule(ctx, sourceID)
	return err == nil && localbackupipc.ValidateSchedule(schedule, sourceID)
}

func writeLocalBackupAgentError(w http.ResponseWriter, err error) {
	var status *localbackupipc.AgentHTTPStatusError
	if errors.As(err, &status) {
		switch status.StatusCode {
		case http.StatusBadRequest, http.StatusForbidden, http.StatusNotFound,
			http.StatusConflict, http.StatusNotImplemented:
			http.Error(w, "owning Agent rejected local backup operation", status.StatusCode)
			return
		}
	}
	http.Error(w, "owning Agent local backup operation unavailable", http.StatusServiceUnavailable)
}

func (g *Gateway) serveLocalBackupManagement(w http.ResponseWriter, r *http.Request, ctx context.Context, agent Agent) {
	manager, ok := agent.(LocalBackupManagementAgent)
	if !ok {
		http.Error(w, "owning Agent local backup management unavailable", http.StatusNotImplemented)
		return
	}

	switch r.URL.Path {
	case "/v1/local-source":
		id, valid := sourceID(r, 1)
		if !valid || !localBackupSourceOwned(ctx, agent, id) {
			http.Error(w, "Source is not owned by this Agent", http.StatusForbidden)
			return
		}
		result, err := manager.LocalBackupSettings(ctx, id)
		if err != nil {
			writeLocalBackupAgentError(w, err)
			return
		}
		if !validLocalBackupSettings(result, id) {
			http.Error(w, "invalid owning Agent settings", http.StatusServiceUnavailable)
			return
		}
		sendJSON(w, result)
		return

	case "/v1/local-rules":
		if r.Method == http.MethodGet {
			id, valid := sourceID(r, 1)
			if !valid || !localBackupSourceOwned(ctx, agent, id) {
				http.Error(w, "Source is not owned by this Agent", http.StatusForbidden)
				return
			}
			result, err := manager.LocalBackupRules(ctx, id)
			if err != nil {
				writeLocalBackupAgentError(w, err)
				return
			}
			if !validLocalBackupRules(result, id) {
				http.Error(w, "invalid owning Agent rules", http.StatusServiceUnavailable)
				return
			}
			sendJSON(w, result)
			return
		}
		if r.URL.RawQuery != "" {
			http.Error(w, "invalid local backup query", http.StatusBadRequest)
			return
		}
		data, err := parseLocalBackupMutation(r, localBackupManagementBodyLimit(r.URL.Path),
			"source_id", "revision", "ignore_rules")
		if err != nil {
			http.Error(w, "invalid local backup rules request", http.StatusBadRequest)
			return
		}
		var input struct {
			SourceID    uint64 `json:"source_id"`
			Revision    uint64 `json:"revision"`
			IgnoreRules string `json:"ignore_rules"`
		}
		if err := json.Unmarshal(data, &input); err != nil ||
			!localbackupipc.ValidSourceID(input.SourceID) || input.Revision == 0 {
			http.Error(w, "invalid local backup rules request", http.StatusBadRequest)
			return
		}
		if _, err := sourcepkg.CompileIgnoreRules(input.IgnoreRules); err != nil {
			http.Error(w, "invalid local backup rules syntax", http.StatusBadRequest)
			return
		}
		if !localBackupSourceOwned(ctx, agent, input.SourceID) {
			http.Error(w, "Source is not owned by this Agent", http.StatusForbidden)
			return
		}
		result, err := manager.SaveLocalBackupRules(ctx, input.SourceID, input.Revision, input.IgnoreRules)
		if err != nil {
			writeLocalBackupAgentError(w, err)
			return
		}
		if !validLocalBackupRules(result, input.SourceID) || result.Revision <= input.Revision ||
			result.IgnoreRules != input.IgnoreRules {
			http.Error(w, "unverified owning Agent rules acknowledgement", http.StatusServiceUnavailable)
			return
		}
		sendJSON(w, result)
		return
	}

	if r.URL.RawQuery != "" {
		http.Error(w, "invalid local backup query", http.StatusBadRequest)
		return
	}
	var data []byte
	var err error
	switch r.URL.Path {
	case "/v1/local-source-rename":
		data, err = parseLocalBackupMutation(r, localBackupManagementBodyLimit(r.URL.Path), "source_id", "revision", "name")
	case "/v1/local-target":
		data, err = parseLocalBackupMutation(r, localBackupManagementBodyLimit(r.URL.Path), "source_id", "revision", "target_node_id")
	case "/v1/local-mode":
		data, err = parseLocalBackupMutation(r, localBackupManagementBodyLimit(r.URL.Path), "source_id", "revision", "sync_mode")
	case "/v1/local-bound-remove":
		data, err = parseLocalBackupMutation(r, localBackupManagementBodyLimit(r.URL.Path), "source_id", "revision")
	default:
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, "invalid local backup mutation", http.StatusBadRequest)
		return
	}

	switch r.URL.Path {
	case "/v1/local-source-rename":
		var input struct {
			SourceID uint64 `json:"source_id"`
			Revision uint64 `json:"revision"`
			Name     string `json:"name"`
		}
		if err := json.Unmarshal(data, &input); err != nil ||
			!localbackupipc.ValidSourceID(input.SourceID) || input.Revision == 0 ||
			!validLocalBackupName(input.Name) {
			http.Error(w, "invalid local backup rename", http.StatusBadRequest)
			return
		}
		if !localBackupSourceOwned(ctx, agent, input.SourceID) {
			http.Error(w, "Source is not owned by this Agent", http.StatusForbidden)
			return
		}
		result, err := manager.RenameLocalBackupSource(ctx, input.SourceID, input.Revision, input.Name)
		if err != nil {
			writeLocalBackupAgentError(w, err)
			return
		}
		if !validLocalBackupSettings(result, input.SourceID) || result.Revision <= input.Revision || result.Name != input.Name {
			http.Error(w, "unverified local backup rename acknowledgement", http.StatusServiceUnavailable)
			return
		}
		sendJSON(w, result)

	case "/v1/local-target":
		var input struct {
			SourceID     uint64 `json:"source_id"`
			Revision     uint64 `json:"revision"`
			TargetNodeID uint64 `json:"target_node_id"`
		}
		if err := json.Unmarshal(data, &input); err != nil ||
			!localbackupipc.ValidSourceID(input.SourceID) || input.Revision == 0 ||
			!localbackupipc.ValidSourceID(input.TargetNodeID) {
			http.Error(w, "invalid local backup target", http.StatusBadRequest)
			return
		}
		if !localBackupSourceOwned(ctx, agent, input.SourceID) {
			http.Error(w, "Source is not owned by this Agent", http.StatusForbidden)
			return
		}
		result, err := manager.RetargetLocalBackupSource(ctx, input.SourceID, input.Revision, input.TargetNodeID)
		if err != nil {
			writeLocalBackupAgentError(w, err)
			return
		}
		if !validLocalBackupSettings(result, input.SourceID) || result.Revision <= input.Revision ||
			result.TargetNodeID == nil || *result.TargetNodeID != input.TargetNodeID {
			http.Error(w, "unverified local backup target acknowledgement", http.StatusServiceUnavailable)
			return
		}
		sendJSON(w, result)

	case "/v1/local-mode":
		var input struct {
			SourceID uint64 `json:"source_id"`
			Revision uint64 `json:"revision"`
			SyncMode string `json:"sync_mode"`
		}
		if err := json.Unmarshal(data, &input); err != nil ||
			!localbackupipc.ValidSourceID(input.SourceID) || input.Revision == 0 ||
			(input.SyncMode != "backup" && input.SyncMode != "mirror") {
			http.Error(w, "invalid local backup mode", http.StatusBadRequest)
			return
		}
		if !localBackupSourceOwned(ctx, agent, input.SourceID) {
			http.Error(w, "Source is not owned by this Agent", http.StatusForbidden)
			return
		}
		result, err := manager.SetLocalBackupMode(ctx, input.SourceID, input.Revision, input.SyncMode)
		if err != nil {
			writeLocalBackupAgentError(w, err)
			return
		}
		if !validLocalBackupSettings(result, input.SourceID) || result.Revision <= input.Revision || result.SyncMode != input.SyncMode {
			http.Error(w, "unverified local backup mode acknowledgement", http.StatusServiceUnavailable)
			return
		}
		sendJSON(w, result)

	case "/v1/local-bound-remove":
		var input struct {
			SourceID uint64 `json:"source_id"`
			Revision uint64 `json:"revision"`
		}
		if err := json.Unmarshal(data, &input); err != nil ||
			!localbackupipc.ValidSourceID(input.SourceID) || input.Revision == 0 {
			http.Error(w, "invalid local backup removal", http.StatusBadRequest)
			return
		}
		if !localBackupSourceOwned(ctx, agent, input.SourceID) {
			http.Error(w, "Source is not owned by this Agent", http.StatusForbidden)
			return
		}
		result, err := manager.RemoveLocalBackupSource(ctx, input.SourceID, input.Revision)
		if err != nil {
			writeLocalBackupAgentError(w, err)
			return
		}
		if result.SourceID != input.SourceID {
			http.Error(w, "unverified local backup removal acknowledgement", http.StatusServiceUnavailable)
			return
		}
		sendJSON(w, result)
	}
}
