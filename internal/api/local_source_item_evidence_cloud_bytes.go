package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
)

const (
	localEvidencePhysicalCASLimitBytes = int64(64 << 20)
	localEvidencePhysicalCASDeadline   = 90 * time.Second
)

// An ephemeral observation, NOT a durable proof or a write authorization.
// CloudBytesVerified intentionally remains false: only a point-in-time read
// succeeded, and a subsequent writer must independently fence every input.
type localEvidencePhysicalCASResponse struct {
	SourceID             uint64 `json:"source_id"`
	Revision             uint64 `json:"revision"`
	Checked              int    `json:"checked"`
	CloudMetadataMatched bool   `json:"cloud_metadata_matched"`
	PhysicalCASMatched   bool   `json:"physical_cas_matched"`
	CloudBytesVerified   bool   `json:"cloud_bytes_verified"`
	ContentVerified      bool   `json:"content_verified"`
	CommitSupported      bool   `json:"commit_supported"`
	Authoritative        bool   `json:"authoritative"`
	MissingInferenceSafe bool   `json:"missing_inference_safe"`
}

// contextCASReader checks cancellation around each bounded read. Store.Open
// returns an os.File, and the Server never buffers the complete object.
type contextCASReader struct {
	ctx context.Context
	src io.Reader
}

func (r contextCASReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	n, err := r.src.Read(p)
	if cancelErr := r.ctx.Err(); cancelErr != nil {
		return 0, cancelErr
	}
	return n, err
}

// verifyPhysicalEvidenceCAS reads a single, canonical, currently stored CAS
// object using <=256KiB memory. The caller MUST repeat the entire device,
// Source, Root, SourceItem, Node, FileVersion and CAS DB proof after this read.
// Even success is transient and MUST NOT be reused as a commit token.
func verifyPhysicalEvidenceCAS(ctx context.Context, store storage.Store, object localEvidenceCloudObject) error {
	if ctx == nil || store == nil || object.Size < 0 ||
		object.Size > localEvidencePhysicalCASLimitBytes {
		return errors.New("physical content read not eligible")
	}
	key, err := storage.ContentAddressedKey(object.SHA256)
	if err != nil || key != object.Key {
		return errors.New("physical content key is not canonical")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	f, err := store.Open(ctx, key)
	if err != nil {
		return errors.New("physical content unavailable")
	}
	defer f.Close()
	before, err := f.Stat()
	if err != nil || !before.Mode().IsRegular() || before.Size() != object.Size {
		return errors.New("physical content size or type mismatch")
	}
	hash := sha256.New()
	size, err := io.CopyBuffer(hash,
		io.LimitReader(contextCASReader{ctx: ctx, src: f}, object.Size+1),
		make([]byte, 256<<10))
	if err != nil {
		return errors.New("physical content read failed")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	after, err := f.Stat()
	if err != nil || !after.Mode().IsRegular() ||
		!os.SameFile(before, after) || !after.ModTime().Equal(before.ModTime()) ||
		after.Size() != object.Size || size != object.Size ||
		hex.EncodeToString(hash.Sum(nil)) != object.SHA256 {
		return errors.New("physical content digest or identity mismatch")
	}
	return nil
}

// readLocalSourceEvidenceCloudBytes performs at most ONE explicitly requested
// small physical-object sample. It accepts only owning-Agent proven evidence,
// never caller-provided paths/keys or Node IDs. All I/O occurs OUTSIDE the
// database transaction. The second full metadata check fences concurrent
// revocation, version/alias edits and CAS metadata replacement.
func (s *Server) readLocalSourceEvidenceCloudBytes(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid local Source ID")
		return
	}
	raw, hasProof := c.Get(localSourceExecutorContextKey)
	proof, proofOK := raw.(localSourceExecutorProof)
	if !hasProof || !proofOK || proof.DeviceID == "" || proof.RootID == "" {
		fail(c, http.StatusForbidden, "owning device and local Root required")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, localEvidenceCloudMetadataMaxBytes)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var input localEvidenceCloudMetadataRequest
	if err := decoder.Decode(&input); err != nil || !validLocalEvidenceCloudMetadataRequest(input) ||
		len(input.Items) != 1 || input.Items[0].Size > localEvidencePhysicalCASLimitBytes {
		fail(c, http.StatusBadRequest, "invalid or oversized physical content sample")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		fail(c, http.StatusBadRequest, "trailing physical content input")
		return
	}
	if s.Store == nil {
		fail(c, http.StatusServiceUnavailable, "physical content storage unavailable")
		return
	}

	readCtx, cancel := context.WithTimeout(c.Request.Context(), localEvidencePhysicalCASDeadline)
	defer cancel()
	c.Request = c.Request.WithContext(readCtx)
	revision, objects, err := s.checkLocalEvidenceCloudMetadata(c, sourceID, expected, proof, input)
	if err != nil {
		failLocalEvidencePhysicalCAS(c, err, expected, revision)
		return
	}
	if len(objects) != 1 {
		fail(c, http.StatusConflict, "physical content source no longer matches")
		return
	}
	if err := verifyPhysicalEvidenceCAS(readCtx, s.Store, objects[0]); err != nil {
		if readCtx.Err() != nil {
			fail(c, http.StatusServiceUnavailable, "physical content verification interrupted")
		} else {
			fail(c, http.StatusConflict, "physical content could not be verified")
		}
		return
	}

	// A physical hash can race revocation, source edits, CAS garbage collection,
	// Node revision changes or alias conflicts. Recheck ALL metadata, never
	// reuse the first transaction's positive outcome as a write permission.
	revisionAgain, objectsAgain, err := s.checkLocalEvidenceCloudMetadata(c, sourceID, expected, proof, input)
	if err != nil {
		failLocalEvidencePhysicalCAS(c, err, expected, revisionAgain)
		return
	}
	if revisionAgain != revision || len(objectsAgain) != 1 || objectsAgain[0] != objects[0] ||
		readCtx.Err() != nil {
		fail(c, http.StatusConflict, "physical content source changed during read")
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(revision, 10)))
	c.JSON(http.StatusOK, localEvidencePhysicalCASResponse{
		SourceID: sourceID, Revision: revision, Checked: 1,
		CloudMetadataMatched: true, PhysicalCASMatched: true,
		CloudBytesVerified: false, ContentVerified: false,
		CommitSupported: false, Authoritative: false, MissingInferenceSafe: false,
	})
}

func failLocalEvidencePhysicalCAS(c *gin.Context, err error, expected, revision uint64) {
	switch {
	case errors.Is(err, errLocalSourceExecutorTransactionUnauthorized):
		fail(c, http.StatusForbidden, "owning device or local Root not authorized")
	case errors.Is(err, gorm.ErrRecordNotFound):
		fail(c, http.StatusNotFound, "local Source not found")
	case errors.Is(err, errRevisionConflict):
		revisionConflict(c, expected, revision)
	case errors.Is(err, errLocalEvidenceConflict), errors.Is(err, errLocalBindingStateInvalid):
		fail(c, http.StatusConflict, "physical content source no longer matches")
	case errors.Is(err, errLocalBindingTypeInvalid):
		fail(c, http.StatusForbidden, "local folder Push required")
	default:
		fail(c, http.StatusServiceUnavailable, "physical content verification unavailable")
	}
}
