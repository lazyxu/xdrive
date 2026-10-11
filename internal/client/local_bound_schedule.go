package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/lazyxu/xdrive/internal/sourceschedule"
)

// A pending local schedule is private to the credential-verified owning Agent.
// It is never included in the ordinary Source or DeviceBackup read projections.
type LocalBoundBackupSchedule struct {
	SourceID           uint64 `json:"source_id"`
	Revision           uint64 `json:"revision"`
	ScheduleType       string `json:"schedule_type"`
	ScheduleExpression string `json:"schedule_expression"`
	ScheduleTimezone   string `json:"schedule_timezone"`
}

// LocalBoundSchedule does not fall back to the generic owner-readable GET,
// which deliberately redacts device-local schedule configuration.
func (c *Client) LocalBoundSchedule(ctx context.Context, id uint64, proof LocalBoundSourceProof) (LocalBoundBackupSchedule, error) {
	var out LocalBoundBackupSchedule
	if id == 0 {
		return out, fmt.Errorf("positive Source ID required")
	}
	req, err := c.request(ctx, http.MethodGet, fmt.Sprintf("/api/v1/sources/%d/local-schedule", id), nil)
	if err != nil {
		return out, err
	}
	localRulesProofHeaders(req, proof)
	response, err := c.do(req)
	if err != nil {
		return out, err
	}
	defer response.Body.Close()
	if err := decodeResponse(response, &out); err != nil {
		return LocalBoundBackupSchedule{}, err
	}
	if out.SourceID != id || out.Revision == 0 {
		return LocalBoundBackupSchedule{}, fmt.Errorf("local schedule identity or revision mismatch")
	}
	return out, nil
}

// SetLocalBoundSchedule saves only the schedule fields of a paused local Push.
// No activation/trigger, preview, deletion or remote scheduling is attempted.
// The follow-up private GET returns the authoritative stored normalized values,
// because the generic PATCH response is intentionally redacted.
func (c *Client) SetLocalBoundSchedule(ctx context.Context, id, revision uint64, spec sourceschedule.Spec, proof LocalBoundSourceProof) (LocalBoundBackupSchedule, error) {
	var empty LocalBoundBackupSchedule
	if id == 0 || revision == 0 {
		return empty, fmt.Errorf("positive Source ID and revision required")
	}
	normalized, err := sourceschedule.Normalize(spec.Type, spec.Expression, spec.Timezone)
	if err != nil || normalized.Type == "" {
		return empty, fmt.Errorf("invalid saved schedule")
	}
	body, err := json.Marshal(UpdateSourceInput{
		ScheduleType:       &normalized.Type,
		ScheduleExpression: &normalized.Expression,
		ScheduleTimezone:   &normalized.Timezone,
	})
	if err != nil {
		return empty, err
	}
	req, err := c.request(ctx, http.MethodPatch, fmt.Sprintf("/api/v1/sources/%d", id), bytes.NewReader(body))
	if err != nil {
		return empty, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("If-Match", strconv.Quote(strconv.FormatUint(revision, 10)))
	localRulesProofHeaders(req, proof)
	response, err := c.do(req)
	if err != nil {
		return empty, err
	}
	defer response.Body.Close()
	var updated Source
	if err := decodeResponse(response, &updated); err != nil {
		return empty, err
	}
	if updated.ID != id || updated.Kind != "local_folder" || updated.Direction != "push" ||
		updated.Status != "paused" || updated.Revision <= revision {
		return empty, fmt.Errorf("local Source identity, revision or paused state invalid after saved schedule")
	}
	stored, err := c.LocalBoundSchedule(ctx, id, proof)
	if err != nil {
		return empty, fmt.Errorf("schedule may have saved; reload local settings: %w", err)
	}
	if stored.Revision != updated.Revision || stored.ScheduleType != normalized.Type ||
		stored.ScheduleExpression != normalized.Expression || stored.ScheduleTimezone != normalized.Timezone {
		return empty, fmt.Errorf("schedule may have saved but changed before verification; reload local settings")
	}
	return stored, nil
}
