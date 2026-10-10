package sourceworkerpolicy

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const SettingName = "pull"

type Values struct {
	ScanIntervalSeconds int64 `json:"scan_interval_seconds"`
	PollIntervalSeconds int64 `json:"poll_interval_seconds"`
	MaxConcurrency      int   `json:"max_concurrency"`
}

// Code defaults are an editor starting point, NOT an assertion about active
// deployment flags. A saved revision takes priority over worker env and flags.
func Defaults() Values {
	return Values{ScanIntervalSeconds: 6 * 60 * 60, PollIntervalSeconds: 60, MaxConcurrency: 2}
}

func Valid(v Values) bool {
	return v.ScanIntervalSeconds >= 60 && v.ScanIntervalSeconds <= 7*24*60*60 &&
		v.PollIntervalSeconds >= 10 && v.PollIntervalSeconds <= 60*60 &&
		v.MaxConcurrency >= 1 && v.MaxConcurrency <= 8
}

type Desired struct {
	Values
	Revision  uint64
	Source    string
	UpdatedAt *time.Time
}

// Invalid persisted settings fail closed rather than revert to old defaults.
func Read(ctx context.Context, db *gorm.DB) (Desired, error) {
	def := Desired{Values: Defaults(), Source: "default"}
	if db == nil {
		return Desired{}, fmt.Errorf("source worker policy database is unavailable")
	}
	var row meta.AdminSourceWorkerSetting
	err := db.WithContext(ctx).Where("name = ?", SettingName).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return def, nil
	}
	if err != nil {
		return Desired{}, err
	}
	v := Values{
		ScanIntervalSeconds: row.ScanIntervalSeconds,
		PollIntervalSeconds: row.PollIntervalSeconds,
		MaxConcurrency:      row.MaxConcurrency,
	}
	if row.Revision == 0 || !Valid(v) {
		return Desired{}, errors.New("persisted source worker configuration is invalid")
	}
	return Desired{Values: v, Revision: row.Revision, Source: "saved", UpdatedAt: &row.UpdatedAt}, nil
}
