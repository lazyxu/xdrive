package api

import (
	"fmt"
	"sort"
	"strings"

	"github.com/lazyxu/xdrive/internal/background"
)

func writeBackgroundSchedulerMetrics(
	b *strings.Builder,
	snapshot background.MetricsSnapshot,
) {
	if b == nil {
		return
	}
	fmt.Fprintln(b, "# HELP xdrive_background_tasks_total Background scheduler task lifecycle counters.")
	fmt.Fprintln(b, "# TYPE xdrive_background_tasks_total counter")
	for _, value := range []struct {
		result string
		count  uint64
	}{
		{"submitted", snapshot.Submitted},
		{"started", snapshot.Started},
		{"completed", snapshot.Completed},
		{"failed", snapshot.Failed},
		{"cancelled", snapshot.Cancelled},
		{"retried", snapshot.Retried},
		{"deduplicated", snapshot.Deduplicated},
		{"promoted", snapshot.Promoted},
		{"backpressured", snapshot.Backpressured},
		{"lease_unavailable", snapshot.LeaseUnavailable},
		{"lease_lost", snapshot.LeaseLost},
		{"expired", snapshot.Expired},
		{"superseded", snapshot.Superseded},
	} {
		fmt.Fprintf(
			b,
			"xdrive_background_tasks_total{result=%q} %d\n",
			value.result,
			value.count,
		)
	}

	resources := make([]background.ResourceClass, 0, len(snapshot.ByResource))
	for resource := range snapshot.ByResource {
		resources = append(resources, resource)
	}
	sort.Slice(resources, func(i, j int) bool {
		return resources[i] < resources[j]
	})

	fmt.Fprintln(b, "# HELP xdrive_background_queue_depth Background scheduler queued tasks by resource class.")
	fmt.Fprintln(b, "# TYPE xdrive_background_queue_depth gauge")
	fmt.Fprintln(b, "# HELP xdrive_background_running Background scheduler running tasks by resource class.")
	fmt.Fprintln(b, "# TYPE xdrive_background_running gauge")
	for _, resource := range resources {
		value := snapshot.ByResource[resource]
		fmt.Fprintf(
			b,
			"xdrive_background_queue_depth{resource=%q} %d\n",
			resource,
			value.Queued,
		)
		fmt.Fprintf(
			b,
			"xdrive_background_running{resource=%q} %d\n",
			resource,
			value.Running,
		)
	}
}
