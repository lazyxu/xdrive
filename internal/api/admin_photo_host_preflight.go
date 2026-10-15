package api

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// This is a local, read-only preflight, not permission to mutate Host Manager.
// In particular its positive local checks never authorize deployment or prove
// a desired revision is applied on this or any other Server replica.
type adminPhotoHostPreflightCheck struct {
	ID     string `json:"id"`
	State  string `json:"state"`
	Detail string `json:"detail"`
}

type adminPhotoHostPreflightDTO struct {
	CheckedAt                   time.Time                      `json:"checked_at"`
	Action                      string                         `json:"action"`
	DesiredRevision             uint64                         `json:"desired_revision"`
	LocalChecksComplete         bool                           `json:"local_checks_complete"`
	HostObserved                bool                           `json:"host_observed"`
	HostControlObserved         bool                           `json:"host_control_observed"`
	ApplySupported              bool                           `json:"apply_supported"`
	Checks                      []adminPhotoHostPreflightCheck `json:"checks"`
	HostRevisionVerified        bool                           `json:"host_revision_verified"`
	ModelInfoChecks             []photoHostModelInfoCheck      `json:"model_info_checks"`
	ModelInstanceCoherent       bool                           `json:"model_instance_coherent"`
	DockerHealthcheckMatched    bool                           `json:"docker_healthcheck_matched"`
	SocketOwnerVerified         bool                           `json:"socket_owner_verified"`
	RequestGenerationCorrelated bool                           `json:"request_generation_correlated"`
	ModelRequestAckVerified     bool                           `json:"model_request_ack_verified"`
	SemanticTextTaskState       string                         `json:"semantic_text_task_state"`
	SemanticImageTaskState      string                         `json:"semantic_image_task_state"`
	FaceDetectorTaskState       string                         `json:"face_detector_task_state"`
	SFaceTaskState              string                         `json:"sface_task_state"`
	CreativeCutoutTaskState     string                         `json:"creative_cutout_task_state"`
	SmartModelTaskState         string                         `json:"smart_model_task_state"`
	SmartOCRFixtureState        string                         `json:"smart_ocr_fixture_state"`
}

// Any queued/active file, symlink, or unexpected filesystem error fails closed.
// A clear local directory is NOT evidence that all Server replicas are idle.
func (s *Server) photoHostLocalQueueClear() bool {
	if s == nil || strings.TrimSpace(s.HostControlDir) == "" {
		return false
	}
	for _, name := range []string{"photo-host-control-request.json", "photo-host-control-active.json", "photo-host-control-recovery"} {
		_, err := os.Lstat(filepath.Join(s.HostControlDir, name))
		if !errors.Is(err, os.ErrNotExist) {
			return false
		}
	}
	return true
}

func photoHostPreflight(desired photoHostDesired, host photoIntelligenceHostStatus, hostObserved bool, control photoHostControlStatus, controlObserved, queueClear bool) adminPhotoHostPreflightDTO {
	action := "unset"
	if desired.Revision > 0 {
		action = "disable"
		if desired.Enabled {
			action = "enable"
		}
	}
	checks := make([]adminPhotoHostPreflightCheck, 0, 7)
	add := func(id, state, detail string) {
		checks = append(checks, adminPhotoHostPreflightCheck{ID: id, State: state, Detail: detail})
	}
	if desired.Revision > 0 {
		add("desired", "pass", "管理员目标修订已保存；保存不代表宿主已应用")
	} else {
		add("desired", "missing", "尚无已保存的管理员宿主启停修订")
	}
	if action == "enable" {
		add("direction", "pass", "目标为启用固定共享宿主；不允许任意容器操作")
	} else if action == "disable" {
		add("direction", "blocked", "尚无跨实例分析任务排空与恢复证明，不能停用宿主")
	} else {
		add("direction", "missing", "先保存启用意图，才能检查受限启用的前置条件")
	}
	if controlObserved && hostObserved {
		add("host-manager", "pass", "固定 Host Manager 和控制状态心跳均为新鲜可信只读观测")
	} else {
		add("host-manager", "unknown", "缺少新鲜固定宿主或受限执行器证据，不能下发命令")
	}
	runtimeOK := hostObserved && (host.State == "healthy" || host.State == "stopped")
	if runtimeOK {
		add("runtime", "pass", "宿主确认为健康运行或已停止；运行中容器不得重新创建")
	} else if hostObserved && (host.State == "unhealthy" || host.State == "running-unverified" || host.State == "starting") {
		add("runtime", "blocked", "容器正在启动、未核验或不健康；禁止尝试重建运行中的模型")
	} else {
		add("runtime", "unknown", "无法确认固定容器健康或停止状态")
	}
	free := controlObserved && control.State != "queued" && control.State != "running" && queueClear
	if free {
		add("work-queue", "pass", "本宿主未观察到待执行请求或恢复事务；不代表其他实例空闲")
	} else {
		add("work-queue", "blocked", "执行中、存在待处理文件或队列状态不可证实，禁止新的宿主请求")
	}
	add("admin-dispatch", "blocked", "尚无已审计的跨实例授权锁、请求令牌绑定和不可覆盖下发协议")
	add("effect-proof", "unknown", "没有经过管理员请求令牌绑定及模型 Info 验证的真实生效结果")
	return adminPhotoHostPreflightDTO{
		CheckedAt: time.Now().UTC(), Action: action,
		DesiredRevision:     desired.Revision,
		LocalChecksComplete: action == "enable" && hostObserved && controlObserved && runtimeOK && free,
		HostObserved:        hostObserved, HostControlObserved: controlObserved,
		ApplySupported: false, Checks: checks,
	}
}

func (s *Server) adminPhotoHostPreflight(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.Header("Referrer-Policy", "no-referrer")
	desired, err := s.readPhotoHostDesired(c.Request.Context())
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Photo Intelligence host configuration unavailable")
		return
	}
	host, observed := s.readPhotoIntelligenceHostStatus()
	control, supported := s.readPhotoHostControlStatus()
	gate, hasGate, err := s.readPhotoHostApply(c.Request.Context())
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "photo host dispatch status unavailable")
		return
	}
	report := photoHostPreflight(desired, host, observed, control, supported, s.photoHostLocalQueueClear())
	// Only the administrator's explicit no-store preflight may trigger the
	// four Info checks and (after proven ACK) bounded fixed synthetic tasks. Missing
	// trustworthy host revision evidence means that Info is never invoked.
	report.ModelInfoChecks = unverifiedPhotoHostModelInfoChecks()
	report.SemanticTextTaskState = "unverified"
	report.SemanticImageTaskState = "unverified"
	report.FaceDetectorTaskState = "unverified"
	report.SFaceTaskState = "unverified"
	report.CreativeCutoutTaskState = "unverified"
	report.SmartModelTaskState = "unverified"
	report.SmartOCRFixtureState = "unverified"
	if hasGate && photoHostModelInfoAllowed(desired, gate, hasGate, s.photoHostApplyReceipt(gate)) {
		report.HostRevisionVerified = true
		report.ModelInfoChecks = s.probePhotoHostModelInfo(c.Request.Context())
		report.ModelInstanceCoherent = photoHostModelInstanceCoherent(report.ModelInfoChecks)
		// A newer desired revision or host drift detected during the probes
		// must not publish stale green model evidence.
		latest, desiredErr := s.readPhotoHostDesired(c.Request.Context())
		latestGate, latestPresent, gateErr := s.readPhotoHostApply(c.Request.Context())
		if desiredErr != nil || gateErr != nil || !latestPresent ||
			!photoHostModelInfoAllowed(latest, latestGate, true, s.photoHostApplyReceipt(latestGate)) ||
			latest.Revision != desired.Revision || latestGate.RequestID != gate.RequestID {
			report.HostRevisionVerified = false
			report.ModelInfoChecks = unverifiedPhotoHostModelInfoChecks()
			report.ModelInstanceCoherent = false
		}
	}
	if report.HostRevisionVerified && report.ModelInstanceCoherent {
		// Independently re-read only the fresh fixed-container host bridge,
		// never invoke Docker from Server or request media/model bytes.
		if latestHost, valid := s.readPhotoIntelligenceHostStatus(); valid {
			report.DockerHealthcheckMatched = photoHostDockerHealthcheckMatched(report.ModelInfoChecks, latestHost)
			report.SocketOwnerVerified = photoHostDockerSocketOwnerVerified(report.ModelInfoChecks, latestHost)
			if latestControl, trusted := s.readPhotoHostControlStatus(); trusted {
				report.RequestGenerationCorrelated = photoHostRequestGenerationCorrelated(
					report.ModelInfoChecks, latestHost, latestControl, gate,
				)
				// Host Manager's private action-time receipt and all four model
				// Info acknowledgments must match the same durable admin gate.
				// The local queue is rechecked; do not promote on a new action.
				if report.RequestGenerationCorrelated && s.photoHostLocalQueueClear() {
					report.ModelRequestAckVerified = photoHostModelRequestAckVerified(
						report.ModelInfoChecks, latestHost, latestControl, gate,
					)
				}
			}
		}
	}
	if report.ModelRequestAckVerified {
		// Fixed synthetic text/image and YuNet inference are independent
		// of the host/model ACK and global effect-proof, and accept no
		// user media or changes to durable task ownership.
		report.SemanticTextTaskState = s.photoHostSemanticTextProbe(
			c.Request.Context(), desired, gate, report.ModelInfoChecks,
		)
		report.SemanticImageTaskState = s.photoHostSemanticImageProbe(
			c.Request.Context(), desired, gate, report.ModelInfoChecks,
		)
		report.FaceDetectorTaskState, report.SFaceTaskState = s.photoHostFaceDetectorProbe(
			c.Request.Context(), desired, gate, report.ModelInfoChecks,
		)
		report.SmartModelTaskState, report.SmartOCRFixtureState = s.photoHostSmartProbe(
			c.Request.Context(), desired, gate, report.ModelInfoChecks,
		)
		report.CreativeCutoutTaskState = s.photoHostCreativeCutoutProbe(
			c.Request.Context(), desired, gate, report.ModelInfoChecks,
		)
		// Reject stale evidence if model/host changes during any task.
		if !s.photoHostSemanticEvidenceCurrent(c.Request.Context(), desired, gate, report.ModelInfoChecks) {
			report.HostRevisionVerified = false
			report.ModelInfoChecks = unverifiedPhotoHostModelInfoChecks()
			report.ModelInstanceCoherent = false
			report.DockerHealthcheckMatched = false
			report.SocketOwnerVerified = false
			report.RequestGenerationCorrelated = false
			report.ModelRequestAckVerified = false
			report.SemanticTextTaskState = "unverified"
			report.SemanticImageTaskState = "unverified"
			report.FaceDetectorTaskState = "unverified"
			report.SFaceTaskState = "unverified"
			report.CreativeCutoutTaskState = "unverified"
			report.SmartModelTaskState = "unverified"
			report.SmartOCRFixtureState = "unverified"
		}
	}
	if report.ModelRequestAckVerified {
		report.Checks[6].Detail = "四类模型已确认同一次宿主请求；合成语义文本／图片、YuNet、SFace 固定向量、Smart 三模型、Creative 固定抠图执行状态分别显示；固定字形 OCR 匹配独立呈现，真实 OCR/SFace/创作效果、图库任务及全集群仍未验证"
	} else if report.HostRevisionVerified {
		report.Checks[6].Detail = "宿主请求令牌与目标修订已核验；模型请求回执尚未完成独立核验，不能证明同源请求确认或真实媒体任务成功"
	}
	if report.LocalChecksComplete && s.photoHostCanSubmit(desired, gate, hasGate) {
		// Dispatch-ready is not an effect proof and can become stale before
		// POST; the real action repeats all checks under a global DB fence.
		report.ApplySupported = true
		report.Checks[5].State = "pass"
		report.Checks[5].Detail = "可经管理员授权提交固定宿主启用请求；仍需实际回执和模型检测"
	}
	c.JSON(http.StatusOK, report)
}
