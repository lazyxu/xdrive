package client

import (
 "context"
 "encoding/json"
 "net/http"
 "net/http/httptest"
 "strconv"
 "strings"
 "testing"

 "github.com/google/uuid"
)

func TestHistoricalCommonReceiptReadUsesCurrentProofAndReturnsOnlyOldCommit(t *testing.T) {
 proof := commonTestProof()
 sourceID, currentRevision, priorRevision := uint64(42), uint64(9), uint64(7)
 op := uuid.NewString()
 key := "lp2_" + strings.Repeat("a", 64)
 calls := 0
 status := "committed"
 server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
  calls++
  if r.Method != http.MethodPost || !strings.HasSuffix(r.URL.Path, "/receipt") ||
   r.Header.Get("If-Match") != strconv.Quote("9") ||
   r.Header.Get("X-XDrive-Device-ID") != proof.DeviceID ||
   r.Header.Get("X-XDrive-Local-Root-ID") != proof.RootID {
   t.Errorf("unfenced historical query: %s %s", r.Method, r.URL.Path)
  }
  var input struct {
   OperationID string `json:"operation_id"`
   ResumeKey string `json:"resume_key"`
   OriginalRevision uint64 `json:"original_revision"`
  }
  if err := json.NewDecoder(r.Body).Decode(&input); err != nil || input.OperationID != op ||
   input.ResumeKey != key || input.OriginalRevision != priorRevision {
   t.Errorf("original selector altered: %+v %v", input, err)
  }
  w.Header().Set("ETag", strconv.Quote("9"))
  w.Header().Set("Cache-Control", "private, no-store")
  w.Header().Set("Content-Type", "application/json")
  result := map[string]any{
   "source_id": sourceID, "revision": priorRevision, "operation_id": op,
   "state": status, "committed": status == "committed",
   "backup_complete": false, "retirement_safe": false, "current_cas_verified": false,
  }
  if status == "committed" {
   result["node_id"] = uint64(88)
   result["node_revision"] = uint64(1)
   result["content_sha256"] = strings.Repeat("b", 64)
   result["size"] = int64(13)
  }
  _ = json.NewEncoder(w).Encode(result)
 }))
 defer server.Close()
 api := New(server.URL, "valid-owner-token")
 got, err := api.ReadLocalPushCommonUploadHistoricalReceipt(context.Background(),
  sourceID, currentRevision, priorRevision, proof, op, key)
 if err != nil || !got.Committed || got.Revision != priorRevision || got.NodeID != 88 || calls != 1 {
  t.Fatalf("historical immutable commit could not be read: %+v %v calls=%d", got, err, calls)
 }
 status = "bound"
 if _, err := api.ReadLocalPushCommonUploadHistoricalReceipt(context.Background(),
  sourceID, currentRevision, priorRevision, proof, op, key); err == nil {
  t.Fatal("old-version pending Operation was promoted to a replayable receipt")
 }
 count := calls
 if _, err := api.ReadLocalPushCommonUploadHistoricalReceipt(context.Background(),
  sourceID, currentRevision, currentRevision+1, proof, op, key); err == nil || calls != count {
  t.Fatal("future revision triggered a private network read")
 }
}
