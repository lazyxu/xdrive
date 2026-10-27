package localbackupipc

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOwnerQuotaRequiresCapabilityAndNeverExposesAdminStorage(t *testing.T) {
	reads := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reads++
		if r.Method != http.MethodGet || r.URL.Path != "/v1/cloud/quota" ||
			r.URL.RawQuery != "" || r.Header.Get("Authorization") != "Bearer "+strings.Repeat("a", 64) {
			t.Error("Owner quota used non-allowlisted Agent route or bearer")
			http.Error(w, "unavailable", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"quota_bytes":8000,"physical_used_bytes":1200,"reserved_bytes":300,"available_bytes":6500,"disk_total_bytes":10000,"disk_available_bytes":8500,"logical_file_bytes":5000,"trash_bytes":200,"history_bytes":100,"over_quota":false}`))
	}))
	defer server.Close()
	c := &Client{baseURL: server.URL, token: strings.Repeat("a", 64), http: server.Client()}
	if _, err := c.OwnerQuota(context.Background()); err == nil || reads != 0 {
		t.Fatal("absent quota capability touched the owning Agent")
	}
	c.capabilities = []string{"cloud-quota-read"}
	q, err := c.OwnerQuota(context.Background())
	if err != nil || q.QuotaBytes != 8000 || q.ReservedBytes != 300 ||
		q.AvailableBytes != 6500 || q.DiskTotalBytes == nil || *q.DiskTotalBytes != 10000 ||
		q.DiskAvailableBytes == nil || *q.DiskAvailableBytes != 8500 {
		t.Fatalf("real Owner quota fields lost: %+v %v", q, err)
	}
	if reads != 1 {
		t.Fatalf("unexpected Agent requests: %d", reads)
	}
}

func TestOwnerQuotaRejectsNegativeOrUnsafeJSAmounts(t *testing.T) {
	if !ValidateOwnerQuota(OwnerQuota{QuotaBytes: 0, ReservedBytes: 0, AvailableBytes: 1024}) {
		t.Fatal("valid unlimited Server quota rejected")
	}
	for _, q := range []OwnerQuota{
		{QuotaBytes: -1},
		{ReservedBytes: -1},
		{AvailableBytes: int64(MaxSafeSourceID) + 1},
		{LogicalFileBytes: -1},
		{TrashBytes: -1},
		{HistoryBytes: -1},
	} {
		if ValidateOwnerQuota(q) {
			t.Fatal("invalid Server quota amount was accepted")
		}
	}
	negative := int64(-1)
	if ValidateOwnerQuota(OwnerQuota{DiskTotalBytes: &negative}) ||
		ValidateOwnerQuota(OwnerQuota{DiskAvailableBytes: &negative}) {
		t.Fatal("negative physical disk metadata accepted")
	}
}
