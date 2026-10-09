import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type {
  MediaDuplicateOrganizePlan,
  MediaDuplicateOrganizeApplyInput,
  MediaDuplicateOrganizeApplyResult,
  MediaItem,
} from '../models'

function joinLabels(values: (string | undefined)[]) {
  return values.filter((value): value is string => Boolean(value?.trim())).join('、') || '无'
}

/** A read-only review of all independent per-copy user and source metadata. */
export function XDriveMediaGalleryDuplicateOrganizePreview({
  nodeIDs,
  items,
  requestPlan,
  applyPlan,
  onRefresh,
}: {
  nodeIDs: number[]
  items: MediaItem[]
  requestPlan?: (
    keeperNodeID: number,
    nodeIDs: number[],
  ) => Promise<MediaDuplicateOrganizePlan>
  applyPlan?: (input: MediaDuplicateOrganizeApplyInput) => Promise<MediaDuplicateOrganizeApplyResult>
  onRefresh?: () => void
}) {
  const [keeperNodeID, setKeeperNodeID] = useState(nodeIDs[0] ?? 0)
  const [plan, setPlan] = useState<MediaDuplicateOrganizePlan | null>(null)
  const plannedKeeperNodeID = plan?.keeper_node_id ?? 0
  const keeperMirrorManaged = Boolean(plan?.members.some((member) =>
    member.node_id === plannedKeeperNodeID &&
    (member.source_links ?? []).some((link) => link.sync_mode === 'mirror'),
  ))
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [selectedDescription, setSelectedDescription] = useState<string | null>(null)
  const [applyResult, setApplyResult] = useState<MediaDuplicateOrganizeApplyResult | null>(null)
  const [error, setError] = useState('')
  const applyInFlight = useRef(false)
  const requestID = useRef(0)
  useEffect(() => {
    requestID.current += 1
    setKeeperNodeID(nodeIDs[0] ?? 0)
    setPlan(null)
    setLoading(false)
    setApplying(false)
    setConfirmed(false)
    setSelectedDescription(null)
    setApplyResult(null)
    setError('')
    return () => { requestID.current += 1 }
  }, [nodeIDs])

  if (nodeIDs.length > 32) {
    return (
      <Typography variant="caption" color="text.secondary">
        保全整理单次最多审核 32 个文件；本组可以继续单独浏览，不会自动合并或删除。
      </Typography>
    )
  }
  if (nodeIDs.length < 2 || items.length < 2) return null

  const requestReview = () => {
    if (!requestPlan || applyInFlight.current) return
    const generation = ++requestID.current
    setLoading(true)
    setError('')
    setPlan(null)
    setConfirmed(false)
    setSelectedDescription(null)
    setApplyResult(null)
    void requestPlan(keeperNodeID, [...nodeIDs]).then((next) => {
      if (generation !== requestID.current) return
      const expected = new Set(nodeIDs)
      if (!next.no_mutation || next.keeper_node_id !== keeperNodeID ||
          !/^[0-9a-fA-F]{64}$/.test(next.plan_revision || '') ||
          next.members?.length !== nodeIDs.length ||
          next.members.some((member) => !expected.delete(member.node_id)) ||
          expected.size !== 0) {
        throw new Error('整理预览与当前文件集合不一致，请刷新后重试')
      }
      setPlan(next)
    }).catch((failure: unknown) => {
      if (generation === requestID.current) {
        setError(failure instanceof Error ? failure.message : '无法加载保全计划，请重试')
      }
    }).finally(() => {
      if (generation === requestID.current) setLoading(false)
    })
  }

  // A separate, opt-in user action. Never submit a dry-run plan on mount,
  // thumbnail expansion or simply opening the modal. The Server checks the
  // exact SHA-256 plan token and all backing resource revisions again in a
  // serializable PostgreSQL transaction. No file or CAS operation is sent.
  const requestConfirmedApply = () => {
    if (!applyPlan || !plan || !confirmed || keeperMirrorManaged ||
        plan.asset_comparison !== 'identical' ||
        (plan.distinct_descriptions.length > 1
          ? selectedDescription === null || !plan.distinct_descriptions.includes(selectedDescription) ||
            !plan.members.some((member) => member.node_id === plan.keeper_node_id &&
              (!member.description.trim() || member.description === selectedDescription))
          : !plan.ready_for_manual_review) ||
        !/^[0-9a-fA-F]{64}$/.test(plan.plan_revision || '') ||
        applyInFlight.current || loading) {
      return
    }
    const generation = ++requestID.current
    applyInFlight.current = true
    setApplying(true)
    setError('')
    const input: MediaDuplicateOrganizeApplyInput = {
      keeper_node_id: plan.keeper_node_id,
      node_ids: [...nodeIDs],
      expected_plan_revision: plan.plan_revision,
      ...(plan.distinct_descriptions.length > 1 && selectedDescription !== null
        ? { selected_description: selectedDescription }
        : {}),
      confirm: true,
    }
    void applyPlan(input).then((result) => {
      if (generation !== requestID.current) return
      if (result.keeper_node_id !== plan.keeper_node_id ||
          !result.original_files_retained || !result.original_edits_retained ||
          !result.source_links_unchanged || result.physical_bytes_reclaimed !== 0) {
        throw new Error('服务端未确认原始文件与资源完整保留，请核对任务状态')
      }
      setApplyResult(result)
      setPlan(null)
      setConfirmed(false)
      setSelectedDescription(null)
    }).catch((failure: unknown) => {
      if (generation !== requestID.current) return
      setPlan(null)
      setConfirmed(false)
      setSelectedDescription(null)
      setApplyResult(null)
      setError((failure instanceof Error ? failure.message : '标注保全失败') +
        '。请重新查看最新保全计划；旧的确认不能重试。')
    }).finally(() => {
      applyInFlight.current = false
      if (generation === requestID.current) setApplying(false)
    })
  }

  const nameByID = new Map(items.map((item) => [item.node.id, item.node.name]))
  const keeperOriginalDescription = plan?.members.find(
    (member) => member.node_id === plan.keeper_node_id,
  )?.description ?? ''
  const descriptionChoices = plan?.distinct_descriptions.filter(
    (description) => !keeperOriginalDescription.trim() || description === keeperOriginalDescription,
  ) ?? []
  return (
    <Stack spacing={1.5} data-xdrive-gallery-duplicate-organize>
      <Typography variant="subtitle2" fontWeight={700}>
        保全整理预览
      </Typography>
      <Typography variant="caption" color="text.secondary">
        检查各副本的收藏、相册、人物、描述、标签、资源及编辑状态；本操作只读取数据，
        不会移动、删除文件或释放共享 Blob。
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} spacing={1}>
        <TextField
          label="拟保留的文件"
          size="small"
          select
          value={keeperNodeID}
          onChange={(event) => {
            requestID.current += 1
            setKeeperNodeID(Number(event.target.value))
            setPlan(null)
            setLoading(false)
            setConfirmed(false)
            setSelectedDescription(null)
            setApplyResult(null)
            setError('')
          }}
          disabled={loading || applying}
          sx={{ flex: 1, minWidth: 0 }}
          data-xdrive-gallery-organize-keeper
        >
          {items.map((item) => (
            <MenuItem key={item.node.id} value={item.node.id}>
              {item.node.name} · #{item.node.id}
            </MenuItem>
          ))}
        </TextField>
        <Button
          variant="outlined"
          disabled={!requestPlan || loading || applying}
          onClick={requestReview}
          sx={{ minHeight: 44, flexShrink: 0 }}
          data-xdrive-gallery-organize-preview
        >
          {loading ? <CircularProgress size={18} /> : '查看保全计划'}
        </Button>
      </Stack>
      {!requestPlan ? (
        <Typography variant="caption" color="text.secondary">
          当前客户端尚不支持保全计划查询，请升级服务端或 Desktop Agent。
        </Typography>
      ) : null}
      {error ? <Typography role="alert" color="error" variant="body2">{error}</Typography> : null}
      {applyResult ? (
        <Paper variant="outlined" sx={{ p: 1.5 }} data-xdrive-gallery-organize-applied>
          <Stack spacing={1}>
            <Typography variant="body2" fontWeight={700} color="success.main" role="status">
              标注已保全到文件 #{applyResult.keeper_node_id}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              收藏及标签等已按保全计划合并；新增手动相册
              {applyResult.manual_albums_added} 个、持久人物关系
              {applyResult.durable_people_added} 个。
              全部原文件、独立编辑配方与同步来源仍保留，物理空间释放为 0。
            </Typography>
            {onRefresh ? (
              <Button size="small" variant="outlined" sx={{ alignSelf: 'flex-start', minHeight: 44 }}
                onClick={onRefresh} data-xdrive-gallery-organize-refresh>
                刷新图库，查看保全结果
              </Button>
            ) : null}
          </Stack>
        </Paper>
      ) : null}
      {plan ? (
        <Paper variant="outlined" sx={{ p: 1.5 }} data-xdrive-gallery-organize-plan>
          <Stack spacing={1.25}>
            <Typography variant="body2" fontWeight={700}>
              {plan.asset_comparison === 'identical'
                ? '完整资源及编辑配方一致'
                : '存在差异或尚未验证，禁止自动整理'}
            </Typography>
            <Typography variant="body2" color="text.secondary">{plan.reason}</Typography>
            <Typography variant="caption" color="text.secondary">
              保留文件 #{plan.keeper_node_id} · 收藏：{plan.combined_favorite ? '包含收藏' : '无收藏'}
              {' · '}手动相册：{plan.manual_album_count} · 持久人物：{plan.durable_person_count}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              标签：{joinLabels(plan.combined_tags)}；人物备注：{joinLabels(plan.combined_people_labels)}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              data-xdrive-gallery-organize-source-coverage
            >
              {typeof plan.source_managed_assets === 'number' &&
               typeof plan.potential_reimport_assets === 'number'
                ? `当前已关联同步文件夹：${plan.source_managed_assets} 份 · Pull 来源可能重新导入：${plan.potential_reimport_assets} 份`
                : '当前服务端未返回来源关联核对信息，请升级后核验'}
              。该结果仅代表本地已关联的来源记录，不是远端完整扫描。
            </Typography>
            {plan.distinct_descriptions.length > 1 ? (
              <Stack spacing={0.75}>
                <Typography variant="body2" color="warning.main">
                  各副本描述不同。必须主动选择 keeper 的显示描述；其他原始文件及其描述全部保留。
                </Typography>
                <TextField
                  select
                  label="选择 keeper 的显示描述"
                  value={selectedDescription ?? ''}
                  onChange={(event) => {
                    setSelectedDescription(event.target.value || null)
                    setConfirmed(false)
                  }}
                  disabled={applying || loading}
                  size="small"
                  data-xdrive-gallery-organize-description-choice
                >
                  <MenuItem value="">请选择描述</MenuItem>
                  {descriptionChoices.map((description) => (
                    <MenuItem key={description} value={description}>{description}</MenuItem>
                  ))}
                </TextField>
                <Typography variant="caption" color="text.secondary">
                  keeper 已有描述时只能保留其原文；若要采用另一份描述，请改选那份原文件为 keeper 并重新查看计划。
                  其他描述仍留在各自独立原文件里；不是归档所有描述，更不允许据此删除其他副本。
                </Typography>
              </Stack>
            ) : null}
            {plan.members.map((member) => (
              <Box key={member.node_id} sx={{ borderTop: 1, borderColor: 'divider', pt: 1 }}>
                <Stack spacing={0.35}>
                  <Typography variant="body2" fontWeight={700} noWrap>
                    {nameByID.get(member.node_id) || `文件 #${member.node_id}`}
                    {member.node_id === plan.keeper_node_id ? ' · 拟保留' : ''}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {member.favorite ? '已收藏' : '未收藏'} · 描述：{member.description || '无'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    标签：{joinLabels(member.tags ?? [])} · 人物备注：{joinLabels(member.people_labels ?? [])}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    相册／集合：{joinLabels((member.collections ?? []).map((collection) => `${collection.name} (${collection.kind})`))}
                    {' · '}持久人物：{joinLabels((member.durable_people ?? []).map((person) => person.name || person.person_key))}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    原始资源：{(member.original_resources ?? []).length} 项
                    {' · '}编辑：{member.has_edit_recipe ? '已有独立编辑配方' : '无编辑'}
                  </Typography>
                  {(member.original_resources ?? []).map((resource, index) => (
                    <Typography key={`${resource.role}-${resource.node_id}-${index}`} variant="caption" color="text.secondary">
                      {resource.role} · {resource.name} · SHA-256 {resource.sha256.slice(0, 16)}…
                    </Typography>
                  ))}
                  {(member.source_links ?? []).length > 0 ? (
                    <Stack
                      spacing={0.25}
                      data-xdrive-gallery-organize-source-links={member.node_id}
                    >
                      {member.source_links?.map((link) => (
                        <Typography
                          key={`${link.source_item_id}-${link.resource_node_id}`}
                          variant="caption"
                          color={link.may_reimport ? 'warning.main' : 'text.secondary'}
                        >
                          同步文件夹：{link.source_name} · {link.direction}/{link.sync_mode}
                          {' · '}资源 #{link.resource_node_id} · {link.path || '来源路径未知'}
                          {link.may_reimport
                            ? ' · 远端仍存在时再次同步可能重新导入'
                            : ' · 当前来源记录未标记为可重新导入（不代表删除安全）'}
                        </Typography>
                      ))}
                    </Stack>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      未发现已关联来源记录；不能据此判定远端不存在副本。
                    </Typography>
                  )}
                </Stack>
              </Box>
            ))}
            <Typography variant="body2" color="text.secondary">
              {plan.source_warning}
            </Typography>
            {keeperMirrorManaged ? (
              <Typography
                color="error"
                variant="body2"
                role="alert"
                data-xdrive-gallery-organize-mirror-keeper-warning
              >
                当前拟保留文件存在 Mirror 同步文件夹的真实资源绑定。远端删除后，该文件可能按 Mirror 规则移入回收站；为防止保全标注随后不可见，请改选不受 Mirror 管理的独立文件后重新审核。
              </Typography>
            ) : null}
            {applyPlan && plan.asset_comparison === 'identical' &&
             !keeperMirrorManaged &&
             (plan.ready_for_manual_review ||
               (plan.distinct_descriptions.length > 1 && selectedDescription !== null &&
                descriptionChoices.includes(selectedDescription))) ? (
              <Stack spacing={1}>
                <Typography variant="caption" color="text.secondary">
                  下一步仅把收藏、标签、人物备注、手动相册和持久人物关系补充到选定文件。
                  不会删除、移动或合并原文件、编辑版本、来源目录和共享 Blob，也不会节省更多空间。
                  若描述不同，只更新 keeper 的显示描述，其余文本仍留在各自原文件。
                </Typography>
                <FormControlLabel
                  control={<Checkbox
                    checked={confirmed}
                    disabled={applying || loading}
                    onChange={(_, nextChecked) => setConfirmed(nextChecked)}
                    data-xdrive-gallery-organize-confirm
                  />}
                  label="我已检查所有副本与保全计划，确认只合并标注、保留全部原文件"
                />
                <Button
                  variant="contained"
                  color="primary"
                  disabled={!confirmed || applying || loading}
                  onClick={requestConfirmedApply}
                  data-xdrive-gallery-organize-apply
                  sx={{ minHeight: 44 }}
                >
                  {applying ? <CircularProgress size={18} /> : '确认保全标注（不删除文件）'}
                </Button>
              </Stack>
            ) : (
              <Typography variant="caption" color="text.secondary">
                {keeperMirrorManaged
                  ? '当前 keeper 可能被 Mirror 自动回收，不能将其他副本的标注集中到这里。'
                  : applyPlan
                    ? '完整资源或编辑不可验证，或存在尚未明确选择的描述冲突；不能擅自合并。'
                  : '本客户端仅支持只读保全预览，升级服务端或 Desktop Agent 后才能确认标注合并。'}
              </Typography>
            )}
            <Typography variant="caption" fontWeight={700}>
              文件、原始资源与独立编辑配方不会被删除。下次同步仍按各自原始来源处理，
              不是删除式副本合并，也不释放 CAS 物理空间。
            </Typography>
          </Stack>
        </Paper>
      ) : null}
    </Stack>
  )
}
