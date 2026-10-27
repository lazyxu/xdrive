package localbackupipc

import (
	"context"
	"errors"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

// The original Server Owner quota, not an estimate from the NAS volume.
// No generic disk inventory, cleanup or administrator credentials are exposed.
type OwnerQuota = client.QuotaUsage

func safeQuotaAmount(value int64) bool {
	return value >= 0 && uint64(value) <= MaxSafeSourceID
}

// Validate all values before serializing them to a JavaScript Number. Never
// silently clamp a 64-bit byte count or infer a missing Server account.
func ValidateOwnerQuota(q OwnerQuota) bool {
	if !safeQuotaAmount(q.QuotaBytes) ||
		!safeQuotaAmount(q.PhysicalUsedBytes) ||
		!safeQuotaAmount(q.ReservedBytes) ||
		!safeQuotaAmount(q.AvailableBytes) ||
		!safeQuotaAmount(q.LogicalFileBytes) ||
		!safeQuotaAmount(q.TrashBytes) ||
		!safeQuotaAmount(q.HistoryBytes) {
		return false
	}
	if q.DiskTotalBytes != nil && !safeQuotaAmount(*q.DiskTotalBytes) {
		return false
	}
	if q.DiskAvailableBytes != nil && !safeQuotaAmount(*q.DiskAvailableBytes) {
		return false
	}
	return true
}

func (c *Client) OwnerQuota(ctx context.Context) (OwnerQuota, error) {
	if c == nil || !hasCapability(c.capabilities, "cloud-quota-read") {
		return OwnerQuota{}, errors.New("owning Agent does not allow Owner quota read")
	}
	var quota OwnerQuota
	if err := c.request(ctx, http.MethodGet, "/v1/cloud/quota", nil, &quota); err != nil {
		return OwnerQuota{}, err
	}
	if !ValidateOwnerQuota(quota) {
		return OwnerQuota{}, errors.New("unsafe Owner quota projection")
	}
	return quota, nil
}
