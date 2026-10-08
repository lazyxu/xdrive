package transfer

import "testing"

func TestClearHistoryScopesKeepOtherHistoryAndActiveGroups(t *testing.T) {
	for _, scope := range []string{"network", "local"} {
		t.Run(scope, func(t *testing.T) {
			m := NewManager(30)
			network := m.Start(Spec{FileName: "download", Kind: KindDownload, Direction: "download", TotalBytes: 10})
			network.Complete()
			local := m.Start(Spec{FileName: "release", Kind: KindDehydration, Direction: "local", TotalBytes: 10})
			local.Complete()
			active := m.StartGroup(Spec{FileName: "folder", Kind: KindDownload, Direction: "download"})
			child := m.StartChild(active, Spec{FileName: "child", Kind: KindDownload, Direction: "download", TotalBytes: 10})
			child.Complete()
			m.ClearHistory(scope)
			_, items := m.Snapshot()
			kept := make(map[string]bool)
			for _, item := range items {
				kept[item.ID] = true
			}
			if !kept[active.ID()] || !kept[child.ID()] {
				t.Fatal("clearing history detached an active folder's completed child")
			}
			if scope == "network" && (kept[network.ID()] || !kept[local.ID()]) {
				t.Fatalf("network history crossed scope: %+v", items)
			}
			if scope == "local" && (!kept[network.ID()] || kept[local.ID()]) {
				t.Fatalf("local history crossed scope: %+v", items)
			}
		})
	}
}
