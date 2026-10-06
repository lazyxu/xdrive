package update

import (
	"fmt"
	"time"

	humanize "github.com/dustin/go-humanize"
)

const updateProgressSteps = 5

type ProgressEvent struct {
	Step           int
	TotalSteps     int
	Stage          string
	Message        string
	Name           string
	Current        int64
	Total          int64
	BytesPerSecond float64
	Elapsed        time.Duration
}

type ProgressFunc func(ProgressEvent)

func reportProgress(fn ProgressFunc, event ProgressEvent) {
	if fn == nil {
		return
	}
	if event.TotalSteps == 0 {
		event.TotalSteps = updateProgressSteps
	}
	fn(event)
}

func FormatProgress(event ProgressEvent) string {
	totalSteps := event.TotalSteps
	if totalSteps == 0 {
		totalSteps = updateProgressSteps
	}
	prefix := fmt.Sprintf("[update %d/%d] %s", event.Step, totalSteps, event.Stage)
	if event.Message != "" {
		return prefix + ": " + event.Message
	}
	if event.Name != "" && event.Current == 0 && event.Total == 0 {
		return prefix + ": " + event.Name
	}
	if event.Current > 0 || event.Total > 0 {
		current := formatBytes(float64(event.Current))
		rate := formatBytes(event.BytesPerSecond) + "/s"
		elapsed := event.Elapsed.Round(time.Second)
		if event.Total > 0 {
			pct := float64(event.Current) * 100 / float64(event.Total)
			return fmt.Sprintf("%s: %s / %s (%.1f%%) | %s | elapsed %s",
				prefix, current, formatBytes(float64(event.Total)), pct, rate, elapsed)
		}
		return fmt.Sprintf("%s: %s | %s | elapsed %s", prefix, current, rate, elapsed)
	}
	return prefix
}

func formatBytes(value float64) string {
	return humanize.IBytes(uint64(max(float64(0), value)))
}
