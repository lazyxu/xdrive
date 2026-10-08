package api

import (
	"bytes"
	"io"
	"testing"
	"time"
)

func TestArchiveProgressReaderCoalescesFastReads(t *testing.T) {
	const (
		payloadSize = 8 << 20
		readSize    = 64 << 10
	)
	fixed := time.Unix(1_700_000_000, 0)
	reader := &archiveProgressReader{
		reader: bytes.NewReader(make([]byte, payloadSize)),
		now:    func() time.Time { return fixed },
	}
	var callbacks int
	var reported int64
	reader.onRead = func(delta int64) {
		callbacks++
		reported += delta
	}

	buf := make([]byte, readSize)
	dataReads := 0
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			dataReads++
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	if dataReads != payloadSize/readSize {
		t.Fatalf("data reads=%d want=%d", dataReads, payloadSize/readSize)
	}
	if callbacks != 1 {
		t.Fatalf("progress callbacks=%d want=1", callbacks)
	}
	if reported != payloadSize {
		t.Fatalf("reported bytes=%d want=%d", reported, payloadSize)
	}
}

func TestArchiveProgressReaderReportsAtIntervalAndFlushesEOF(t *testing.T) {
	clock := time.Unix(1_700_000_000, 0)
	reader := &archiveProgressReader{
		reader: bytes.NewReader([]byte("abcdefghijkl")),
		now:    func() time.Time { return clock },
	}
	var deltas []int64
	reader.onRead = func(delta int64) {
		deltas = append(deltas, delta)
	}

	buf := make([]byte, 4)
	if n, err := reader.Read(buf); n != 4 || err != nil {
		t.Fatalf("first read n=%d err=%v", n, err)
	}
	if len(deltas) != 0 {
		t.Fatalf("unexpected early progress: %v", deltas)
	}

	clock = clock.Add(archiveProgressReportInterval)
	if n, err := reader.Read(buf); n != 4 || err != nil {
		t.Fatalf("second read n=%d err=%v", n, err)
	}
	if len(deltas) != 1 || deltas[0] != 8 {
		t.Fatalf("interval deltas=%v want=[8]", deltas)
	}

	if n, err := reader.Read(buf); n != 4 || err != nil {
		t.Fatalf("third read n=%d err=%v", n, err)
	}
	if len(deltas) != 1 {
		t.Fatalf("unexpected third-read progress: %v", deltas)
	}
	reader.Flush()
	if len(deltas) != 2 || deltas[1] != 4 {
		t.Fatalf("terminal flush deltas=%v want=[8 4]", deltas)
	}
	if n, err := reader.Read(buf); n != 0 || err != io.EOF {
		t.Fatalf("EOF read n=%d err=%v", n, err)
	}
	if len(deltas) != 2 {
		t.Fatalf("EOF duplicated terminal progress: %v", deltas)
	}
}
