package sourceschedule

import (
	"fmt"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/robfig/cron/v3"
)

const (
	TypeInterval = "interval"
	TypeCron     = "cron"
	TypeManual   = "manual"

	DefaultIntervalExpression = "6h"
	DefaultInterval           = 6 * time.Hour
	MinInterval               = time.Minute
	MaxInterval               = 365 * 24 * time.Hour
)

var standardCronParser = cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)

type Spec struct {
	Type       string
	Expression string
	Timezone   string
}

func Normalize(scheduleType, expression, timezone string) (Spec, error) {
	scheduleType = strings.ToLower(strings.TrimSpace(scheduleType))
	expression = strings.TrimSpace(expression)
	timezone = strings.TrimSpace(timezone)
	if scheduleType == "" && expression == "" && timezone == "" {
		return Spec{}, nil
	}
	switch scheduleType {
	case TypeInterval:
		if expression == "" {
			return Spec{}, fmt.Errorf("schedule_expression is required for interval schedule")
		}
		interval, err := time.ParseDuration(expression)
		if err != nil || interval < MinInterval || interval > MaxInterval {
			return Spec{}, fmt.Errorf("interval schedule must be a duration between %s and %s", MinInterval, MaxInterval)
		}
		return Spec{Type: TypeInterval, Expression: expression}, nil
	case TypeManual:
		return Spec{Type: TypeManual}, nil
	case TypeCron:
		if expression == "" {
			return Spec{}, fmt.Errorf("schedule_expression is required for cron schedule")
		}
		if _, err := standardCronParser.Parse(expression); err != nil {
			return Spec{}, fmt.Errorf("invalid 5-field cron schedule: %w", err)
		}
		if timezone == "" {
			timezone = "UTC"
		}
		if _, err := time.LoadLocation(timezone); err != nil {
			return Spec{}, fmt.Errorf("invalid schedule timezone %q", timezone)
		}
		return Spec{Type: TypeCron, Expression: expression, Timezone: timezone}, nil
	default:
		return Spec{}, fmt.Errorf("schedule_type must be interval, cron, or manual")
	}
}

func Explicit(source meta.Source) (Spec, error) {
	return Normalize(source.ScheduleType, source.ScheduleExpression, source.ScheduleTimezone)
}

func Effective(source meta.Source, fallback time.Duration) (Spec, error) {
	spec, err := Explicit(source)
	if err != nil {
		return Spec{}, err
	}
	if spec.Type != "" {
		return spec, nil
	}
	if fallback <= 0 {
		fallback = DefaultInterval
	}
	if fallback < MinInterval {
		fallback = MinInterval
	}
	return Spec{Type: TypeInterval, Expression: fallback.String()}, nil
}

func Due(source meta.Source, now time.Time, fallback time.Duration) (bool, error) {
	if source.RunRequestedAt != nil {
		return true, nil
	}
	spec, err := Effective(source, fallback)
	if err != nil {
		return false, err
	}
	if spec.Type == TypeManual {
		return false, nil
	}
	if source.RetryAt != nil {
		return !source.RetryAt.After(now.UTC()), nil
	}
	if source.LastRunAt == nil {
		return true, nil
	}
	next, err := nextAfter(source, *source.LastRunAt, fallback)
	if err != nil {
		return false, err
	}
	return !next.After(now.UTC()), nil
}

func NextRunAt(source meta.Source, now time.Time, fallback time.Duration) (time.Time, error) {
	if source.RunRequestedAt != nil {
		return now.UTC(), nil
	}
	spec, err := Effective(source, fallback)
	if err != nil {
		return time.Time{}, err
	}
	if spec.Type == TypeManual {
		return time.Time{}, nil
	}
	if source.RetryAt != nil {
		return source.RetryAt.UTC(), nil
	}
	if source.LastRunAt == nil {
		return now.UTC(), nil
	}
	return nextAfter(source, *source.LastRunAt, fallback)
}

func nextAfter(source meta.Source, last time.Time, fallback time.Duration) (time.Time, error) {
	spec, err := Effective(source, fallback)
	if err != nil {
		return time.Time{}, err
	}
	switch spec.Type {
	case TypeInterval:
		interval, _ := time.ParseDuration(spec.Expression)
		return last.UTC().Add(interval), nil
	case TypeCron:
		location, err := time.LoadLocation(spec.Timezone)
		if err != nil {
			return time.Time{}, err
		}
		schedule, err := standardCronParser.Parse(spec.Expression)
		if err != nil {
			return time.Time{}, err
		}
		return schedule.Next(last.In(location)).UTC(), nil
	default:
		return time.Time{}, fmt.Errorf("unsupported schedule type %q", spec.Type)
	}
}
