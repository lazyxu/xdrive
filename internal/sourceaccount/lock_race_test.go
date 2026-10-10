package sourceaccount

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

// The test driver exercises the production Lease lifecycle without requiring
// PostgreSQL. SQL connection lifetime and concurrent calls remain real.
type leaseRaceConnector struct {
	unlocks *atomic.Int32
}

func (c leaseRaceConnector) Connect(context.Context) (driver.Conn, error) {
	return &leaseRaceConn{unlocks: c.unlocks}, nil
}

func (c leaseRaceConnector) Driver() driver.Driver { return leaseRaceDriver{} }

type leaseRaceDriver struct{}

func (leaseRaceDriver) Open(string) (driver.Conn, error) {
	return nil, errors.New("use leaseRaceConnector")
}

type leaseRaceConn struct {
	unlocks *atomic.Int32
}

func (*leaseRaceConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected Prepare")
}

func (*leaseRaceConn) Close() error { return nil }

func (*leaseRaceConn) Begin() (driver.Tx, error) {
	return nil, errors.New("unexpected Begin")
}

func (c *leaseRaceConn) QueryContext(
	_ context.Context,
	query string,
	_ []driver.NamedValue,
) (driver.Rows, error) {
	var value driver.Value
	switch {
	case query == "SELECT 1":
		value = int64(1)
	case strings.HasPrefix(query, "SELECT pg_advisory_unlock("):
		c.unlocks.Add(1)
		value = true
	default:
		return nil, fmt.Errorf("unexpected lease query %q", query)
	}
	return &leaseRaceRows{value: value}, nil
}

type leaseRaceRows struct {
	value   driver.Value
	emitted bool
}

func (*leaseRaceRows) Columns() []string { return []string{"result"} }
func (*leaseRaceRows) Close() error      { return nil }
func (r *leaseRaceRows) Next(dest []driver.Value) error {
	if r.emitted {
		return io.EOF
	}
	r.emitted = true
	dest[0] = r.value
	return nil
}

func newRaceLease(t *testing.T) (*Lease, *sql.DB, *atomic.Int32) {
	t.Helper()
	unlocks := new(atomic.Int32)
	db := sql.OpenDB(leaseRaceConnector{unlocks: unlocks})
	conn, err := db.Conn(context.Background())
	if err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	return &Lease{conn: conn, key: 101}, db, unlocks
}

// Before the fix, simultaneous Heartbeat and Close produced a Go DATA RACE
// on l.conn (and sometimes a nil-pointer panic between the two reads).
func TestLeaseConcurrentHeartbeatAndClose(t *testing.T) {
	for cycle := 0; cycle < 64; cycle++ {
		lease, db, unlocks := newRaceLease(t)
		start := make(chan struct{})
		var wg sync.WaitGroup
		for worker := 0; worker < 12; worker++ {
			wg.Add(1)
			go func(worker int) {
				defer wg.Done()
				defer func() {
					if p := recover(); p != nil {
						t.Errorf("heartbeat/close race panicked: %v", p)
					}
				}()
				<-start
				if worker == 0 {
					lease.Close()
				} else {
					_ = lease.Heartbeat(context.Background())
				}
			}(worker)
		}
		close(start)
		wg.Wait()
		lease.Close()
		if got := unlocks.Load(); got != 1 {
			t.Errorf("cycle %d: unlock executed %d times, want 1", cycle, got)
		}
		if err := lease.Heartbeat(context.Background()); err == nil {
			t.Errorf("cycle %d: heartbeat succeeded after Close", cycle)
		}
		if err := db.Close(); err != nil {
			t.Fatal(err)
		}
	}
}

// Closing from two cancellation paths must release the advisory lock once.
func TestLeaseConcurrentDoubleClose(t *testing.T) {
	for cycle := 0; cycle < 64; cycle++ {
		lease, db, unlocks := newRaceLease(t)
		start := make(chan struct{})
		var wg sync.WaitGroup
		for worker := 0; worker < 12; worker++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				lease.Close()
			}()
		}
		close(start)
		wg.Wait()
		if got := unlocks.Load(); got != 1 {
			t.Errorf("cycle %d: unlock executed %d times, want 1", cycle, got)
		}
		if err := db.Close(); err != nil {
			t.Fatal(err)
		}
	}
}
