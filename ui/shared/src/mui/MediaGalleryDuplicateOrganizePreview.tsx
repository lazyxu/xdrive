import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  CircularProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type {
  MediaDuplicateOrganizePlan,
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
}: {
  nodeIDs: number[]
  items: MediaItem[]
  requestPlan?: (
    keeperNodeID: number,
    nodeIDs: number[],
  ) => Promise<MediaDuplicateOrganizePlan>
}) {
  const [keeperNodeID, setKeeperNodeID] = useState(nodeIDs[0] ?? 0)
  const [plan, setPlan] = useState<MediaDuplicateOrganizePlan | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestID = useRef(0)
  useEffect(() => {
    requestID.current += 1
    setKeeperNodeID(nodeIDs[0] ?? 0)
    setPlan(null)
    setLoading(false)
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
    if (!requestPlan) return
    const generation = ++requestID.current
    setLoading(true)
    setError('')
    setPlan(null)
    void requestPlan(keeperNodeID, [...nodeIDs]).then((next) => {
      if (generation !== requestID.current) return
      const expected = new Set(nodeIDs)
      if (!next.no_mutation || next.keeper_node_id !== keeperNodeID ||
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

  const nameByID = new Map(items.map((item) => [item.node.id, item.node.name]))
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
            setError('')
          }}
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
          disabled={!requestPlan || loading}
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
            {plan.distinct_descriptions.length > 1 ? (
              <Typography variant="body2" color="error">
                描述冲突：{plan.distinct_descriptions.join(' / ')}。必须人工处理，不能静默覆盖。
              </Typography>
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
                </Stack>
              </Box>
            ))}
            <Typography variant="body2" color="text.secondary">
              {plan.source_warning}
            </Typography>
            <Typography variant="caption" fontWeight={700}>
              这是一份只读预览。相册及用户信息未发生合并，文件和配方未被删除；
              后续保全整理需要单独确认及事务验收。
            </Typography>
          </Stack>
        </Paper>
      ) : null}
    </Stack>
  )
}
