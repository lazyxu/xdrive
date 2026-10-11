package transfer

import (
	"sync"
	"testing"
)

// Once an Agent switches accounts and Clear returns, in-flight old-account
// folder planning cannot resurrect a child without its removed parent. This
// deliberately starts all planners before clearing; planners that lose the
// race to Clear may return nil, but none may publish orphaned tasks afterward.
func TestConcurrentClearAndStartChildCannotResurrectOldAccountTransfers(t *testing.T) {
	const (
		rounds   = 96
		planners = 128
	)
	for round := 0; round < rounds; round++ {
		manager := NewManager(planners + 16)
		group := manager.StartGroup(Spec{
			FileName: "old-account-folder",
			Kind:     KindUpload, Direction: "upload",
		})
		start := make(chan struct{})
		entered := make(chan struct{}, planners)
		var pending sync.WaitGroup
		pending.Add(planners)
		for n := 0; n < planners; n++ {
			go func() {
				defer pending.Done()
				<-start
				entered <- struct{}{}
				manager.StartChild(group, Spec{
					FileName: "old-account-child.jpg",
					Kind:     KindUpload, Direction: "upload",
				})
			}()
		}
		close(start)
		for n := 0; n < planners; n++ {
			<-entered
		}
		manager.Clear()
		pending.Wait()
		_, tasks := manager.Snapshot()
		if len(tasks) != 0 {
			t.Fatalf("round %d: an old account's child was created after Clear: %+v", round, tasks)
		}
	}
}
