package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"github.com/lazyxu/xdrive/internal/sourceschedule"
	"github.com/lazyxu/xdrive/internal/sourcewake"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type sourceDTO struct {
	ID                 uint64     `json:"id"`
	Name               string     `json:"name"`
	Kind               string     `json:"kind"`
	Direction          string     `json:"direction"`
	SyncMode           string     `json:"sync_mode"`
	RunMode            string     `json:"run_mode"`
	Status             string     `json:"status"`
	ScheduleType       string     `json:"schedule_type,omitempty"`
	ScheduleExpression string     `json:"schedule_expression,omitempty"`
	ScheduleTimezone   string     `json:"schedule_timezone,omitempty"`
	Revision           uint64     `json:"revision"`
	TargetNodeID       *uint64    `json:"target_node_id,omitempty"`
	IgnoreRules        string     `json:"ignore_rules,omitempty"`
	Checkpoint         string     `json:"checkpoint,omitempty"`
	LastRunAt          *time.Time `json:"last_run_at,omitempty"`
	LastSuccessAt      *time.Time `json:"last_success_at,omitempty"`
	LastError          string     `json:"last_error,omitempty"`
	RunRequestedAt     *time.Time `json:"run_requested_at,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

type sourceOverviewDTO struct {
	Source     sourceDTO                  `json:"source"`
	LatestRun  *syncRunDTO                `json:"latest_run,omitempty"`
	Credential *sourceCredentialStatusDTO `json:"credential,omitempty"`
}

type syncRunDTO struct {
	ID                     string     `json:"id"`
	SourceID               uint64     `json:"source_id"`
	RunNumber              int64      `json:"run_number"`
	SourceRevision         uint64     `json:"source_revision"`
	TargetNodeID           *uint64    `json:"target_node_id,omitempty"`
	IgnoreRules            string     `json:"ignore_rules,omitempty"`
	Mode                   string     `json:"mode"`
	Trigger                string     `json:"trigger"`
	Status                 string     `json:"status"`
	CheckpointBefore       string     `json:"checkpoint_before,omitempty"`
	CheckpointAfter        string     `json:"checkpoint_after,omitempty"`
	ScannedItems           int64      `json:"scanned_items"`
	ScannedBytes           int64      `json:"scanned_bytes"`
	IgnoredItems           int64      `json:"ignored_items"`
	IgnoredBytes           int64      `json:"ignored_bytes"`
	NewItems               int64      `json:"new_items"`
	NewBytes               int64      `json:"new_bytes"`
	ChangedItems           int64      `json:"changed_items"`
	ChangedBytes           int64      `json:"changed_bytes"`
	MovedItems             int64      `json:"moved_items"`
	UnchangedItems         int64      `json:"unchanged_items"`
	UnchangedBytes         int64      `json:"unchanged_bytes"`
	MissingItems           int64      `json:"missing_items"`
	MissingBytes           int64      `json:"missing_bytes"`
	PlannedTransferItems   int64      `json:"planned_transfer_items"`
	PlannedTransferBytes   int64      `json:"planned_transfer_bytes"`
	ProcessedTransferItems int64      `json:"processed_transfer_items"`
	ProcessedTransferBytes int64      `json:"processed_transfer_bytes"`
	CreatedItems           int64      `json:"created_items"`
	UpdatedItems           int64      `json:"updated_items"`
	SkippedItems           int64      `json:"skipped_items"`
	TransferredItems       int64      `json:"transferred_items"`
	TransferredBytes       int64      `json:"transferred_bytes"`
	FailedItems            int64      `json:"failed_items"`
	ActiveTransferPath     string     `json:"active_transfer_path,omitempty"`
	ActiveTransferBytes    int64      `json:"active_transfer_bytes"`
	ActiveTransferTotal    int64      `json:"active_transfer_total_bytes"`
	CancelRequestedAt      *time.Time `json:"cancel_requested_at,omitempty"`
	Error                  string     `json:"error,omitempty"`
	StartedAt              time.Time  `json:"started_at"`
	FinishedAt             *time.Time `json:"finished_at,omitempty"`
}

func toSourceDTO(source meta.Source) sourceDTO {
	return sourceDTO{
		ID: source.ID, Name: source.Name, Kind: source.Kind, Direction: source.Direction,
		SyncMode: source.SyncMode, RunMode: source.RunMode, Status: source.Status,
		ScheduleType: source.ScheduleType, ScheduleExpression: source.ScheduleExpression, ScheduleTimezone: source.ScheduleTimezone,
		Revision: source.Revision, TargetNodeID: source.TargetNodeID, IgnoreRules: source.IgnoreRules,
		Checkpoint: source.Checkpoint, LastRunAt: source.LastRunAt, LastSuccessAt: source.LastSuccessAt,
		LastError: source.LastError, RunRequestedAt: source.RunRequestedAt,
		CreatedAt: source.CreatedAt, UpdatedAt: source.UpdatedAt,
	}
}

func toSyncRunDTO(run meta.SyncRun) syncRunDTO {
	return syncRunDTO{
		ID: run.ID, SourceID: run.SourceID, RunNumber: run.RunNumber, SourceRevision: run.SourceRevision,
		TargetNodeID: run.TargetNodeID, IgnoreRules: run.IgnoreRules,
		Mode: run.Mode, Trigger: run.Trigger, Status: run.Status,
		CheckpointBefore: run.CheckpointBefore, CheckpointAfter: run.CheckpointAfter,
		ScannedItems: run.ScannedItems, ScannedBytes: run.ScannedBytes,
		IgnoredItems: run.IgnoredItems, IgnoredBytes: run.IgnoredBytes,
		NewItems: run.NewItems, NewBytes: run.NewBytes, ChangedItems: run.ChangedItems, ChangedBytes: run.ChangedBytes,
		MovedItems: run.MovedItems, UnchangedItems: run.UnchangedItems, UnchangedBytes: run.UnchangedBytes,
		MissingItems: run.MissingItems, MissingBytes: run.MissingBytes,
		PlannedTransferItems: run.PlannedTransferItems, PlannedTransferBytes: run.PlannedTransferBytes,
		ProcessedTransferItems: run.ProcessedTransferItems, ProcessedTransferBytes: run.ProcessedTransferBytes,
		CreatedItems: run.CreatedItems, UpdatedItems: run.UpdatedItems, SkippedItems: run.SkippedItems,
		TransferredItems: run.TransferredItems, TransferredBytes: run.TransferredBytes,
		FailedItems:        run.FailedItems,
		ActiveTransferPath: run.ActiveTransferPath, ActiveTransferBytes: run.ActiveTransferBytes,
		ActiveTransferTotal: run.ActiveTransferTotal, CancelRequestedAt: run.CancelRequestedAt,
		Error: run.Error, StartedAt: run.StartedAt, FinishedAt: run.FinishedAt,
	}
}

func (s *Server) listSources(c *gin.Context) {
	var sources []meta.Source
	if err := s.DB.Where("owner_id = ?", userID(c)).Order("lower(name) ASC, id ASC").Find(&sources).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list sources failed")
		return
	}
	out := make([]sourceDTO, 0, len(sources))
	for _, source := range sources {
		out = append(out, toSourceDTO(source))
	}
	c.JSON(http.StatusOK, out)
}

func (s *Server) listSourceOverview(c *gin.Context) {
	var sources []meta.Source
	if err := s.DB.Where("owner_id = ?", userID(c)).Order("lower(name) ASC, id ASC").Find(&sources).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list sources failed")
		return
	}
	out := make([]sourceOverviewDTO, 0, len(sources))
	if len(sources) == 0 {
		c.JSON(http.StatusOK, out)
		return
	}

	sourceIDs := make([]uint64, 0, len(sources))
	credentialSourceIDs := make([]uint64, 0)
	for _, source := range sources {
		sourceIDs = append(sourceIDs, source.ID)
		if sourceUsesStoredCredential(source) {
			credentialSourceIDs = append(credentialSourceIDs, source.ID)
		}
	}

	var latestRuns []meta.SyncRun
	if err := s.DB.Raw(`
		SELECT DISTINCT ON (source_id) *
		FROM xd_sync_runs
		WHERE source_id IN ?
		ORDER BY source_id, started_at DESC, id DESC
	`, sourceIDs).Scan(&latestRuns).Error; err != nil {
		fail(c, http.StatusInternalServerError, "load latest source runs failed")
		return
	}
	latestBySource := make(map[uint64]meta.SyncRun, len(latestRuns))
	for _, run := range latestRuns {
		latestBySource[run.SourceID] = run
	}

	credentialBySource := make(map[uint64]meta.SourceCredential, len(credentialSourceIDs))
	if len(credentialSourceIDs) != 0 {
		var credentials []meta.SourceCredential
		if err := s.DB.Where("source_id IN ?", credentialSourceIDs).Find(&credentials).Error; err != nil {
			fail(c, http.StatusInternalServerError, "load source credentials failed")
			return
		}
		for _, credential := range credentials {
			credentialBySource[credential.SourceID] = credential
		}
	}

	for _, source := range sources {
		row := sourceOverviewDTO{Source: toSourceDTO(source)}
		if run, ok := latestBySource[source.ID]; ok {
			dto := toSyncRunDTO(run)
			row.LatestRun = &dto
		}
		if sourceUsesStoredCredential(source) {
			status := sourceCredentialStatusDTO{}
			if credential, ok := credentialBySource[source.ID]; ok {
				updated := credential.UpdatedAt
				status.Configured = true
				status.KeyVersion = credential.KeyVersion
				status.UpdatedAt = &updated
			}
			row.Credential = &status
		}
		out = append(out, row)
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, out)
}

func (s *Server) createSource(c *gin.Context) {
	var req struct {
		Name               string `json:"name"`
		Kind               string `json:"kind"`
		Direction          string `json:"direction"`
		SyncMode           string `json:"sync_mode"`
		RunMode            string `json:"run_mode"`
		ScheduleType       string `json:"schedule_type"`
		ScheduleExpression string `json:"schedule_expression"`
		ScheduleTimezone   string `json:"schedule_timezone"`
		TargetNodeID       uint64 `json:"target_node_id"`
		IgnoreRules        string `json:"ignore_rules"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Kind = strings.TrimSpace(req.Kind)
	req.Direction = strings.TrimSpace(req.Direction)
	req.SyncMode = strings.TrimSpace(req.SyncMode)
	req.RunMode = strings.TrimSpace(req.RunMode)
	if req.SyncMode == "" {
		req.SyncMode = meta.SourceSyncModeBackup
	}
	if req.RunMode == "" {
		req.RunMode = meta.SourceRunModeSync
	}
	if !meta.ValidSourceName(req.Name) || !meta.ValidSourceKind(req.Kind) || !meta.ValidSourceDirection(req.Direction) {
		fail(c, http.StatusBadRequest, "invalid source name, kind, or direction")
		return
	}
	if req.SyncMode != meta.SourceSyncModeBackup {
		fail(c, http.StatusBadRequest, "only backup sync_mode is currently supported")
		return
	}
	if !meta.ValidSourceRunMode(req.RunMode) {
		fail(c, http.StatusBadRequest, "invalid run_mode")
		return
	}
	if strings.TrimSpace(req.ScheduleType) == "" && strings.TrimSpace(req.ScheduleExpression) == "" && strings.TrimSpace(req.ScheduleTimezone) == "" {
		req.ScheduleType = sourceschedule.TypeInterval
		req.ScheduleExpression = sourceschedule.DefaultIntervalExpression
	}
	schedule, err := sourceschedule.Normalize(req.ScheduleType, req.ScheduleExpression, req.ScheduleTimezone)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	isYike := req.Kind == yikeSourceKind
	isSynologyFiles := req.Kind == synologyFilesSourceKind
	isSynologyPull := (req.Kind == synologySourceKind || isSynologyFiles) && req.Direction == meta.SourceDirectionPull
	if isSynologyFiles && req.Direction != meta.SourceDirectionPull {
		fail(c, http.StatusBadRequest, "Synology File Station only supports pull direction")
		return
	}
	if isYike {
		if req.Direction != meta.SourceDirectionPull {
			fail(c, http.StatusBadRequest, "Yike Photos only supports pull direction")
			return
		}
		if req.TargetNodeID != 0 {
			fail(c, http.StatusBadRequest, "Yike Photos target directory is managed automatically")
			return
		}
	} else {
		if req.TargetNodeID == 0 {
			fail(c, http.StatusBadRequest, "target_node_id is required")
			return
		}
		if _, err := s.ownedDirectory(userID(c), req.TargetNodeID); err != nil {
			fail(c, http.StatusBadRequest, "target directory not found")
			return
		}
	}
	if _, err := sourcepkg.CompileIgnoreRules(req.IgnoreRules); err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	var target *uint64
	status := meta.SourceStatusActive
	if isYike {
		// The managed target is bound atomically after the Cookie is validated and
		// the Yike account UID/name are known.
		status = meta.SourceStatusPaused
	} else {
		if isSynologyPull {
			// Pull mode is executed by the server worker and must not run until
			// the encrypted DSM credential has been validated and stored.
			status = meta.SourceStatusPaused
		}
		value := req.TargetNodeID
		target = &value
	}
	source := meta.Source{
		OwnerID: userID(c), Name: req.Name, Kind: req.Kind, Direction: req.Direction,
		SyncMode: meta.SourceSyncModeBackup, RunMode: req.RunMode, Status: status,
		ScheduleType: schedule.Type, ScheduleExpression: schedule.Expression, ScheduleTimezone: schedule.Timezone,
		Revision: 1, TargetNodeID: target, IgnoreRules: req.IgnoreRules,
	}
	if err := s.DB.Create(&source).Error; err != nil {
		if isDuplicate(err) {
			fail(c, http.StatusConflict, "source name already exists")
		} else {
			fail(c, http.StatusInternalServerError, "create source failed")
		}
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(source.Revision, 10)))
	c.JSON(http.StatusCreated, toSourceDTO(source))
}

func (s *Server) getSource(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	source, err := s.ownedSource(userID(c), id)
	if err != nil {
		fail(c, statusForLookup(err), "source not found")
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(source.Revision, 10)))
	c.JSON(http.StatusOK, toSourceDTO(source))
}

func (s *Server) updateSource(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	var req struct {
		Name               *string `json:"name"`
		RunMode            *string `json:"run_mode"`
		Status             *string `json:"status"`
		ScheduleType       *string `json:"schedule_type"`
		ScheduleExpression *string `json:"schedule_expression"`
		ScheduleTimezone   *string `json:"schedule_timezone"`
		TargetNodeID       *uint64 `json:"target_node_id"`
		IgnoreRules        *string `json:"ignore_rules"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}

	var updated meta.Source
	var currentRevision uint64
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var current meta.Source
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", id, userID(c)).First(&current).Error; err != nil {
			return err
		}
		currentRevision = current.Revision
		if current.Revision != expected {
			return errRevisionConflict
		}
		updates := map[string]any{}
		if req.Name != nil {
			name := strings.TrimSpace(*req.Name)
			if !meta.ValidSourceName(name) {
				return errInvalidSourceConfig
			}
			var count int64
			if err := tx.Model(&meta.Source{}).
				Where("owner_id = ? AND id <> ? AND lower(name) = lower(?)", userID(c), id, name).
				Count(&count).Error; err != nil {
				return err
			}
			if count != 0 {
				return errSourceNameTaken
			}
			updates["name"] = name
		}
		if req.RunMode != nil {
			mode := strings.TrimSpace(*req.RunMode)
			if !meta.ValidSourceRunMode(mode) {
				return errInvalidSourceConfig
			}
			updates["run_mode"] = mode
		}
		if req.Status != nil {
			status := strings.TrimSpace(*req.Status)
			if !meta.ValidSourceStatus(status) {
				return errInvalidSourceConfig
			}
			if status == meta.SourceStatusActive {
				if err := requireSourceReadyForActivation(tx, current); err != nil {
					return err
				}
			}
			updates["status"] = status
		}
		if req.ScheduleType != nil || req.ScheduleExpression != nil || req.ScheduleTimezone != nil {
			scheduleType := current.ScheduleType
			expression := current.ScheduleExpression
			timezone := current.ScheduleTimezone
			if req.ScheduleType != nil {
				scheduleType = strings.TrimSpace(*req.ScheduleType)
			}
			if req.ScheduleExpression != nil {
				expression = strings.TrimSpace(*req.ScheduleExpression)
			}
			if req.ScheduleTimezone != nil {
				timezone = strings.TrimSpace(*req.ScheduleTimezone)
			}
			schedule, err := sourceschedule.Normalize(scheduleType, expression, timezone)
			if err != nil || schedule.Type == "" {
				return errInvalidSourceConfig
			}
			updates["schedule_type"] = schedule.Type
			updates["schedule_expression"] = schedule.Expression
			updates["schedule_timezone"] = schedule.Timezone
		}
		if req.TargetNodeID != nil {
			if current.Kind == yikeSourceKind {
				return errManagedSourceTarget
			}
			if *req.TargetNodeID == 0 {
				return errInvalidSourceTarget
			}
			var target meta.Node
			if err := tx.Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				*req.TargetNodeID, userID(c), meta.NodeTypeDir).First(&target).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return errInvalidSourceTarget
				}
				return err
			}
			updates["target_node_id"] = target.ID
		}
		if req.IgnoreRules != nil {
			if _, err := sourcepkg.CompileIgnoreRules(*req.IgnoreRules); err != nil {
				return errInvalidSourceConfig
			}
			updates["ignore_rules"] = *req.IgnoreRules
		}
		if len(updates) == 0 {
			updated = current
			return nil
		}
		updates["revision"] = gorm.Expr("revision + 1")
		updates["updated_at"] = time.Now()
		if err := tx.Model(&meta.Source{}).
			Where("id = ? AND owner_id = ? AND revision = ?", id, userID(c), expected).
			Updates(updates).Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND owner_id = ?", id, userID(c)).First(&updated).Error
	})
	if err != nil {
		switch {
		case errors.Is(err, errRevisionConflict):
			revisionConflict(c, expected, currentRevision)
		case errors.Is(err, errSourceNameTaken), isDuplicate(err):
			fail(c, http.StatusConflict, "source name already exists")
		case errors.Is(err, errSourceCredentialRequired):
			fail(c, http.StatusConflict, "source credential must be configured before activation")
		case errors.Is(err, errSourceConnectorConfigRequired):
			fail(c, http.StatusConflict, "source connector config must be configured before activation")
		case errors.Is(err, errManagedSourceTarget):
			fail(c, http.StatusBadRequest, "Yike Photos target directory is managed automatically")
		case errors.Is(err, errInvalidSourceTarget):
			fail(c, http.StatusBadRequest, "target directory not found")
		case errors.Is(err, errInvalidSourceConfig):
			fail(c, http.StatusBadRequest, "invalid source configuration")
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "source not found")
		default:
			fail(c, http.StatusInternalServerError, "update source failed")
		}
		return
	}
	c.Header("ETag", strconv.Quote(strconv.FormatUint(updated.Revision, 10)))
	c.JSON(http.StatusOK, toSourceDTO(updated))
}

func (s *Server) triggerSource(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}

	now := time.Now().UTC()
	var source meta.Source
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", id, userID(c)).First(&source).Error; err != nil {
			return err
		}
		if source.Status != meta.SourceStatusActive {
			return errSourcePaused
		}
		if err := tx.Model(&meta.Source{}).Where("id = ?", source.ID).Updates(map[string]any{
			"run_requested_at": now,
			"updated_at":       now,
		}).Error; err != nil {
			return err
		}
		if source.Direction == meta.SourceDirectionPull {
			if err := sourcewake.Notify(tx, source.ID); err != nil {
				return err
			}
		}
		source.RunRequestedAt = &now
		source.UpdatedAt = now
		return nil
	})
	if err != nil {
		writeSourceRunError(c, err)
		return
	}
	c.JSON(http.StatusAccepted, toSourceDTO(source))
}

func (s *Server) deleteSource(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	var currentRevision uint64
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var source meta.Source
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", id, userID(c)).First(&source).Error; err != nil {
			return err
		}
		currentRevision = source.Revision
		if source.Revision != expected {
			return errRevisionConflict
		}
		var activeRuns int64
		if err := tx.Model(&meta.SyncRun{}).
			Where("source_id = ? AND status = ?", source.ID, meta.SyncRunStatusRunning).
			Count(&activeRuns).Error; err != nil {
			return err
		}
		if activeRuns != 0 {
			return errSourceRunActive
		}
		return tx.Delete(&source).Error
	})
	if err != nil {
		switch {
		case errors.Is(err, errRevisionConflict):
			revisionConflict(c, expected, currentRevision)
		case errors.Is(err, errSourceRunActive):
			fail(c, http.StatusConflict, "source already has an active run")
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "source not found")
		default:
			fail(c, http.StatusInternalServerError, "delete source failed")
		}
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) listSourceRuns(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	if _, err := s.ownedSource(userID(c), id); err != nil {
		fail(c, statusForLookup(err), "source not found")
		return
	}
	limit := 50
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 200 {
			fail(c, http.StatusBadRequest, "limit must be between 1 and 200")
			return
		}
		limit = value
	}
	offset := 0
	if raw := strings.TrimSpace(c.Query("offset")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			fail(c, http.StatusBadRequest, "offset must be zero or greater")
			return
		}
		offset = value
	}
	var runs []meta.SyncRun
	if err := s.DB.Where("source_id = ?", id).Order("started_at DESC, id DESC").Limit(limit).Offset(offset).Find(&runs).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list source runs failed")
		return
	}
	out := make([]syncRunDTO, 0, len(runs))
	for _, run := range runs {
		out = append(out, toSyncRunDTO(run))
	}
	c.JSON(http.StatusOK, out)
}

func (s *Server) getSourceRun(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	if _, err := s.ownedSource(userID(c), id); err != nil {
		fail(c, statusForLookup(err), "source not found")
		return
	}
	runID := strings.TrimSpace(c.Param("runID"))
	if runID == "" {
		fail(c, http.StatusBadRequest, "invalid run id")
		return
	}
	var run meta.SyncRun
	if err := s.DB.Where("id = ? AND source_id = ?", runID, id).First(&run).Error; err != nil {
		fail(c, http.StatusNotFound, "source run not found")
		return
	}
	c.JSON(http.StatusOK, toSyncRunDTO(run))
}

func (s *Server) ownedSource(uid, id uint64) (meta.Source, error) {
	var source meta.Source
	return source, s.DB.Where("id = ? AND owner_id = ?", id, uid).First(&source).Error
}

var (
	errInvalidSourceConfig           = errors.New("invalid source configuration")
	errInvalidSourceTarget           = errors.New("invalid source target")
	errManagedSourceTarget           = errors.New("managed source target")
	errSourceCredentialRequired      = errors.New("source credential is required")
	errSourceConnectorConfigRequired = errors.New("source connector config is required")
	errYikeAccountAlreadyConfigured  = errors.New("Yike account already configured")
	errYikeAccountMismatch           = errors.New("Yike account does not match managed target")
	errYikeTargetContainsData        = errors.New("Yike managed target already contains unmanaged data")
	errYikeTargetPathConflict        = errors.New("Yike managed target path conflict")
	errSourceNameTaken               = errors.New("source name taken")
)
