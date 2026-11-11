package client

import (
  "bufio"
  "context"
  "errors"
  "fmt"
  "io"
  "net/http"
  "strconv"
  "strings"
  "time"

  "github.com/google/uuid"
)

// ClipboardChangeEvent is only an Owner-visible invalidation cursor, never
// Clipboard content, a remote bearer or a File/Device authorization grant.
type ClipboardChangeEvent struct {
  Cursor uint64 `json:"cursor"`
  Changed bool `json:"changed"`
}

// readClipboardChangeSSE consumes the existing Server's small SSE frames.
// It refuses content-bearing or malformed events and never returns text.
func readClipboardChangeSSE(stream io.Reader, after uint64) (ClipboardChangeEvent, error) {
  noChange := ClipboardChangeEvent{Cursor: after}
  scanner := bufio.NewScanner(stream)
  scanner.Buffer(make([]byte, 1024), 8192)
  var event string
  var cursor uint64
  var hasID bool
  for scanner.Scan() {
    line := strings.TrimSuffix(scanner.Text(), "")
    if line == "" {
      if event == "change" {
        if !hasID || cursor <= after || cursor > 1<<53-1 {
          return noChange, errors.New("invalid Clipboard change event")
        }
        return ClipboardChangeEvent{Cursor: cursor, Changed: true}, nil
      }
      event, cursor, hasID = "", 0, false
      continue
    }
    switch {
    case strings.HasPrefix(line, ":"):
      // No-op keepalive.
    case strings.HasPrefix(line, "event: "):
      value := strings.TrimPrefix(line, "event: ")
      if value != "change" && value != "sync" {
        return noChange, errors.New("unexpected Clipboard event")
      }
      event = value
    case strings.HasPrefix(line, "id: "):
      raw := strings.TrimPrefix(line, "id: ")
      id, err := strconv.ParseUint(raw, 10, 64)
      if err != nil || id > 1<<53-1 || strconv.FormatUint(id, 10) != raw {
        return noChange, errors.New("invalid Clipboard SSE cursor")
      }
      cursor, hasID = id, true
    case strings.HasPrefix(line, "data: "):
      if line != "data: {}" {
        return noChange, errors.New("Clipboard event contained unexpected data")
      }
    case strings.HasPrefix(line, "retry: "):
      // Server controls retry; the local Host uses its own cancellation.
    default:
      return noChange, errors.New("unexpected Clipboard SSE field")
    }
  }
  if err := scanner.Err(); err != nil { return noChange, err }
  return noChange, nil
}

// ClipboardWaitForChange opens the existing authenticated Server SSE endpoint,
// bounded to 12 s. No stream, token or message payload reaches the Host.
func (c *Client) ClipboardWaitForChange(
  ctx context.Context, after uint64, deviceID, token string,
) (ClipboardChangeEvent, error) {
  noChange := ClipboardChangeEvent{Cursor: after}
  if ctx == nil || after > 1<<53-1 { return noChange, errors.New("invalid Clipboard cursor") }
  if deviceID != "" || token != "" {
    id, err := uuid.Parse(deviceID)
    if err != nil || id.String() != deviceID || token == "" {
      return noChange, errors.New("invalid Clipboard device proof")
    }
  }
  watchCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
  defer cancel()
  request, err := c.request(watchCtx, http.MethodGet,
    fmt.Sprintf("/api/v1/clipboard/events?after=%d", after), nil)
  if err != nil { return noChange, err }
  request.Header.Set("Accept", "text/event-stream")
  if deviceID != "" {
    request.Header.Set("X-XDrive-Device-ID", deviceID)
    request.Header.Set("X-XDrive-Device-Token", token)
  }
  response, err := c.do(request)
  if err != nil {
    if ctx.Err() == nil && errors.Is(watchCtx.Err(), context.DeadlineExceeded) {
      return noChange, nil
    }
    return noChange, err
  }
  defer response.Body.Close()
  if response.StatusCode != http.StatusOK ||
    !strings.HasPrefix(response.Header.Get("Content-Type"), "text/event-stream") {
    return noChange, errors.New("Owner Clipboard event stream unavailable")
  }
  result, err := readClipboardChangeSSE(response.Body, after)
  if err != nil {
    if ctx.Err() == nil && errors.Is(watchCtx.Err(), context.DeadlineExceeded) {
      return noChange, nil
    }
    return noChange, err
  }
  if err := ctx.Err(); err != nil { return noChange, err }
  return result, nil
}
