package localpushcommon

import (
 "context"
 "errors"
 "strings"
 "testing"

 "github.com/google/uuid"
 "github.com/lazyxu/xdrive/internal/client"
)

// This stub has only read methods: no Admit/Bind/Finalize/Upload path.
type historicalOriginalProbe struct {
 readOnlyOriginalProbe
 historyCalls int
 history func(uint64, uint64, string) (client.LocalPushCommonUploadReceipt, error)
}

func (p *historicalOriginalProbe) ReadLocalPushCommonUploadHistoricalReceipt(
 _ context.Context, sourceID, currentRevision, originalRevision uint64,
 _ client.LocalBoundSourceProof, operationID, _ string,
) (client.LocalPushCommonUploadReceipt, error) {
 p.historyCalls++
 if sourceID == 0 || currentRevision < originalRevision {
  return client.LocalPushCommonUploadReceipt{}, ErrUncertain
 }
 return p.history(currentRevision, originalRevision, operationID)
}

func TestHistoricalOriginalReadAcceptsOnlyCurrentScopeAndCommittedOldSQL(t *testing.T) {
 old := fixturePlan()
 old.SourceRevision = 6
 newer := old
 newer.SourceRevision = 7
 newer.OperationID = uuid.NewString()
 newer.Target = Target{NodeID: 81, ExpectedRevision: 1}
 newer.ContentSHA256 = strings.Repeat("b", 64)
 newer.Size++
 if old.Validate() != nil || newer.Validate() != nil { t.Fatal("bad fixture") }
 probe := &historicalOriginalProbe{}
 probe.read = func(_ int, op, _ string) (client.LocalPushCommonUploadReceipt, error) {
  if op != newer.OperationID { t.Fatal("unexpected current operation") }
  return committedOriginalTestReceipt(newer), nil
 }
 probe.history = func(current, previous uint64, op string) (client.LocalPushCommonUploadReceipt, error) {
  if current != 7 || previous != 6 || op != old.OperationID {
   t.Fatal("historical operation was not scoped to current Source and original ID")
  }
  return committedOriginalTestReceipt(old), nil
 }
 got, err := ReadVerifiedOriginalFileReceipts(context.Background(), probe,
  durableProof(old), old.SourceID, 7, []Plan{old, newer})
 if err != nil || len(got) != 2 || probe.historyCalls != 1 || probe.calls != 1 ||
  got[0].Receipt.Revision != 6 || got[1].Receipt.Revision != 7 {
  t.Fatalf("versioned original provenance was not read under current authority: %+v %v", got, err)
 }
 // Neither a past-version pending operation nor a fabricated current result
 // can be adopted by a future Source revision.
 probe.history = func(_, _ uint64, _ string) (client.LocalPushCommonUploadReceipt, error) {
  return client.LocalPushCommonUploadReceipt{
   SourceID: old.SourceID, Revision: 6, OperationID: old.OperationID, State: "bound",
  }, nil
 }
 if got, err := ReadVerifiedOriginalFileReceipts(context.Background(), probe,
  durableProof(old), old.SourceID, 7, []Plan{old, newer}); !errors.Is(err, ErrUncertain) || len(got) != 0 {
  t.Fatalf("old pending Operation crossed revision: %+v %v", got, err)
 }
 probe.history = func(_, _ uint64, _ string) (client.LocalPushCommonUploadReceipt, error) {
  fake := committedOriginalTestReceipt(old)
  fake.Revision = 7
  return fake, nil
 }
 if got, err := ReadVerifiedOriginalFileReceipts(context.Background(), probe,
  durableProof(old), old.SourceID, 7, []Plan{old}); !errors.Is(err, ErrUncertain) || len(got) != 0 {
  t.Fatalf("forged historical revision crossed validation: %+v %v", got, err)
 }
}

func TestHistoricalOriginalRequiresDedicatedReadCapabilityAndNoFutureRevision(t *testing.T) {
 prior := fixturePlan()
 prior.SourceRevision--
 current := prior
 current.SourceRevision++
 current.OperationID = uuid.NewString()
 current.Target = Target{NodeID: 81, ExpectedRevision: 1}
 // A legacy reader cannot accidentally use a current-version SQL API to
 // inspect an older Operation or claim its commit.
 legacy := &readOnlyOriginalProbe{read: func(_ int, _, _ string) (client.LocalPushCommonUploadReceipt, error) {
  t.Fatal("historic plan was queried via current-version endpoint")
  return client.LocalPushCommonUploadReceipt{}, nil
 }}
 if got, err := ReadVerifiedOriginalFileReceipts(context.Background(), legacy,
  durableProof(prior), prior.SourceID, current.SourceRevision, []Plan{prior}); !errors.Is(err, ErrUncertain) || len(got) != 0 || legacy.calls != 0 {
  t.Fatalf("legacy reader forged historical permission: %+v %v", got, err)
 }
 future := current
 future.SourceRevision++
 if got, err := ReadVerifiedOriginalFileReceipts(context.Background(), legacy,
  durableProof(prior), prior.SourceID, current.SourceRevision, []Plan{future}); !errors.Is(err, ErrUncertain) || len(got) != 0 {
  t.Fatalf("future Operation revision was read: %+v %v", got, err)
 }
}
