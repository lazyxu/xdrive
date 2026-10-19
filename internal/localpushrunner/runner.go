// Package localpushrunner coordinates a bounded first-file Push operation.
// It never grants device/Root authority, activates SourceRuns, retires native
// request keys, or declares a complete backup. Production transports must
// separately prove every exact owner/device/Root/source/SQL/CAS boundary.
package localpushrunner

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"sync"
	"time"
)

const MaxFirstLeafBytes int64 = 64 << 20
const reconcileTimeout = 5 * time.Second

var (
	ErrInvalidRequest = errors.New("local push request unavailable")
	ErrAlreadyRunning = errors.New("local push source already running")
	ErrQuarantined    = errors.New("local push source requires durable recovery")
	ErrUncertain      = errors.New("local push commit outcome uncertain")
	ErrDenied         = errors.New("local push admission denied")
)

var canonicalUUID = regexp.MustCompile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
var canonicalDigest = regexp.MustCompile("^[0-9a-f]{64}$")

// Scope must be constructed from authenticated Agent/Server state, NEVER a
// renderer/Web parameter. The runner does not trust or authorize this struct;
// Drivers MUST recheck owner/device token, Root/fingerprint, session, revision
// and current OS original during the physical work and final SQL COMMIT.
// JSON must not expose private path/identity information from this boundary.
type Scope struct {
	Server          string
	Account         string
	SessionID       string
	DeviceID        string
	RootID          string
	RootFingerprint string
	SourceID        uint64
	Revision        uint64
	TargetNodeID    uint64
	RelativePath    string
	ContentSHA256   string
	Size            int64
}

func (Scope) MarshalJSON() ([]byte, error) { return []byte("{}"), nil }

func safeRelativePath(v string) bool {
	if v == "" || len(v) > 4096 || strings.HasPrefix(v, "/") ||
		strings.ContainsAny(v, "\\:\x00\r\n") {
		return false
	}
	for _, component := range strings.Split(v, "/") {
		if component == "" || component == "." || component == ".." {
			return false
		}
	}
	return true
}
func safeIdentity(v string) bool {
	return v != "" && len(v) <= 2048 && strings.TrimSpace(v) == v &&
		!strings.ContainsAny(v, "\x00\r\n")
}
func (s Scope) valid() bool {
	return safeIdentity(s.Server) && safeIdentity(s.Account) && safeIdentity(s.SessionID) &&
		canonicalUUID.MatchString(s.DeviceID) && canonicalUUID.MatchString(s.RootID) &&
		canonicalDigest.MatchString(s.RootFingerprint) &&
		s.SourceID != 0 && s.Revision != 0 && s.TargetNodeID != 0 &&
		safeRelativePath(s.RelativePath) && s.ContentSHA256 != "" &&
		canonicalDigest.MatchString(s.ContentSHA256) &&
		s.Size >= 0 && s.Size <= MaxFirstLeafBytes
}

// Staged is a temporary, NONCANONICAL physical stage receipt. It proves no
// persistent Node, SourceItem, FileVersion or backup result by itself.
type Staged struct {
	StageID       string
	SourceID      uint64
	Revision      uint64
	ContentSHA256 string
	Size          int64
}

func (Staged) MarshalJSON() ([]byte, error) { return []byte("{}"), nil }
func (s Staged) matches(req Scope) bool {
	return canonicalUUID.MatchString(s.StageID) && s.SourceID == req.SourceID &&
		s.Revision == req.Revision && s.ContentSHA256 == req.ContentSHA256 && s.Size == req.Size
}

// Operation is the exact durable, idempotent operation reservation.
type Operation struct {
	ID         string
	Generation uint64
	SourceID   uint64
	Revision   uint64
}

func (Operation) MarshalJSON() ([]byte, error) { return []byte("{}"), nil }
func (op Operation) matches(s Scope) bool {
	return canonicalUUID.MatchString(op.ID) && op.Generation != 0 &&
		op.SourceID == s.SourceID && op.Revision == s.Revision
}

// CommitProof must be based on a fresh, verified immutable PostgreSQL COMMIT
// plus actual physical CAS and native original evidence. NEVER infer it from
// an HTTP ACK, a staging receipt, a timed-out reservation, or SourceRun text.
type CommitProof struct {
	StageID        string
	OperationID    string
	Generation     uint64
	SourceID       uint64
	Revision       uint64
	NodeID         uint64
	SourceItemID   uint64
	ContentSHA256  string
	Size           int64
	DurableSQL     bool
	PhysicalCAS    bool
	NativeOriginal bool
}

func (CommitProof) MarshalJSON() ([]byte, error) { return []byte("{}"), nil }
func (p CommitProof) matches(s Scope, st Staged, op Operation) bool {
	return p.StageID == st.StageID && p.OperationID == op.ID &&
		p.Generation == op.Generation && p.SourceID == s.SourceID &&
		p.Revision == s.Revision && p.ContentSHA256 == s.ContentSHA256 &&
		p.Size == s.Size && p.NodeID != 0 && p.SourceItemID != 0 &&
		p.DurableSQL && p.PhysicalCAS && p.NativeOriginal
}

// Driver must use owning Agent-held native proofs and authenticated Server
// transport, with pre/post checks inside COMMIT. This interface is NOT a
// substitute for hardware/OS, PostgreSQL or CAS evidence.
type Driver interface {
	Check(context.Context, Scope) error
	Stage(context.Context, Scope) (Staged, error)
	Prepare(context.Context, Scope, Staged) (Operation, error)
	Commit(context.Context, Scope, Staged, Operation) error
	Reconcile(context.Context, Scope, Staged, Operation) (CommitProof, error)
}

// FirstLeafResult describes one verified canonical first file, NOT a complete
// backup. SourceRun, Mirror deletion, scheduler and key retirement are absent.
// A caller cannot turn an uncertain result into success or a new generation.
type FirstLeafResult struct {
	Confirmed bool
	Uncertain bool
}

func (FirstLeafResult) MarshalJSON() ([]byte, error) { return []byte("{}"), nil }

// Runner serializes one Source per process. Its in-memory lock is ONLY local
// fairness, NOT a cross-process or durable Server operation admission fence.
type Runner struct {
	mu      sync.Mutex
	running map[uint64]struct{}
	// In-memory fail-closed safeguard only. A new Agent process MUST load
	// the OS SecretStore request-key claim and Server COMMIT evidence before
	// admitting any replacement or recovery operation.
	quarantined map[uint64]struct{}
}

func (r *Runner) enter(id uint64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.running == nil {
		r.running = make(map[uint64]struct{})
	}
	if _, exists := r.running[id]; exists {
		return ErrAlreadyRunning
	}
	if _, exists := r.quarantined[id]; exists {
		return ErrQuarantined
	}
	r.running[id] = struct{}{}
	return nil
}
func (r *Runner) quarantine(id uint64) {
	r.mu.Lock()
	if r.quarantined == nil {
		r.quarantined = make(map[uint64]struct{})
	}
	r.quarantined[id] = struct{}{}
	r.mu.Unlock()
}
func (r *Runner) leave(id uint64) {
	r.mu.Lock()
	delete(r.running, id)
	r.mu.Unlock()
}

// RunFirstLeaf stages a real bounded original and coordinates the short
// current-operation COMMIT. After Commit is invoked, network errors and
// cancellations are ALWAYS uncertain until independently reconciled. A
// canceled caller does not prove a Server COMMIT did not happen: we run one
// bounded *fresh* reconciliation even if the request context is canceled.
// Never automatically mint another request key or launch a second generation.
func (r *Runner) RunFirstLeaf(ctx context.Context, scope Scope, d Driver) (FirstLeafResult, error) {
	var empty FirstLeafResult
	if r == nil || ctx == nil || d == nil || !scope.valid() {
		return empty, ErrInvalidRequest
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	if err := r.enter(scope.SourceID); err != nil {
		return empty, err
	}
	defer r.leave(scope.SourceID)

	if err := d.Check(ctx, scope); err != nil {
		return empty, ErrDenied
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	stage, err := d.Stage(ctx, scope)
	if err != nil {
		return empty, err
	}
	if !stage.matches(scope) {
		return empty, ErrDenied
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	if err := d.Check(ctx, scope); err != nil {
		return empty, ErrDenied
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	// Prepare can durably reserve an Operation and lose its HTTP ACK. Fence
	// all new work BEFORE sending the first request, not after its response.
	// Cross-process/crash recovery must additionally verify the OS-stored
	// request-key claim and authoritative Server COMMIT evidence.
	r.quarantine(scope.SourceID)
	op, err := d.Prepare(ctx, scope, stage)
	if err != nil {
		return empty, err
	}
	if !op.matches(scope) {
		return empty, ErrDenied
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}

	// A timeout, HTTP disconnect, or cancellation may happen *during* this
	// call, after the Server has already committed canonical bytes. The
	// original durable native key/claim must remain for later recovery.
	commitErr := d.Commit(ctx, scope, stage, op)
	reconcileCtx, cancel := context.WithTimeout(context.Background(), reconcileTimeout)
	defer cancel()
	receipt, readErr := d.Reconcile(reconcileCtx, scope, stage, op)
	if readErr == nil && receipt.matches(scope, stage, op) {
		return FirstLeafResult{Confirmed: true}, nil
	}
	// Even when Commit returns nil, an absent/mismatched/unavailable proof
	// is not a success, and cannot justify cancellation or key deletion.
	_ = commitErr
	return FirstLeafResult{Uncertain: true}, ErrUncertain
}
