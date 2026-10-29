import { Button, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import type { XDriveServerBackupPage } from '../server-backup-admin'
import type { XDriveServerBackupSnapshotFilter } from '../server-backup-snapshot-query'
import { summarizeServerBackupRepositoryCoverage } from '../server-backup-repository-coverage'

const named: Record<string, string> = {
  v1: '传统 v1 完整备份',
  'v2-default': '默认 v2 增量仓库',
  'v2-configured': '宿主机配置的独立 v2 仓库',
}

/** Read-only Host namespace discovery; no direct path editing or dangerous
 * repository deletion is offered to Web/Desktop/DSM. */
export function XDriveBackupRepositoryInventory({ inventory, onSelectRepository }: {
  inventory: XDriveServerBackupPage['inventory']
  onSelectRepository?: (repository: XDriveServerBackupSnapshotFilter['repository']) => void
}) {
  const counts = inventory.repositories
  const coverage = summarizeServerBackupRepositoryCoverage(inventory)
  const expected = ['v1', 'v2-default', 'v2-configured']
  const valid = Array.isArray(counts) && counts.length === 3 &&
    typeof inventory.total_snapshots === 'number' &&
    Number.isSafeInteger(inventory.total_snapshots) &&
    counts.every((item, index) =>
      item.id === expected[index] && Number.isSafeInteger(item.snapshot_count) &&
      item.snapshot_count >= 0) &&
    counts.reduce((sum, item) => sum + item.snapshot_count, 0) === inventory.total_snapshots
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}
      data-xdrive-admin-backup-repository-inventory>
      <Stack spacing={1}>
        <Typography variant="subtitle1" fontWeight={600}>已发现的本地备份仓库</Typography>
        {valid && counts && coverage ? (
          <Table size="small" aria-label="备份仓库只读发现统计">
            <TableHead>
              <TableRow>
                <TableCell>本地仓库</TableCell>
                <TableCell align="right">发现总数</TableCell>
                <TableCell align="right">最新清单内</TableCell>
                <TableCell>已列结构状态（不是完整性校验）</TableCell>
                <TableCell align="right">未列出的旧代</TableCell>
                {onSelectRepository ? <TableCell /> : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {counts.map((item, index) => (
                <TableRow key={item.id}>
                  <TableCell>{named[item.id]}</TableCell>
                  <TableCell align="right">{item.snapshot_count.toLocaleString('zh-CN')} 代</TableCell>
                  <TableCell align="right" data-xdrive-backup-repository-listed>
                    {coverage[index].listed.toLocaleString('zh-CN')} 代
                  </TableCell>
                  <TableCell data-xdrive-backup-repository-structure>
                    <Typography variant="caption">
                      完整文件 {coverage[index].completeFiles} · 仅数据库 {coverage[index].databaseOnly} ·
                      不完整 {coverage[index].incomplete} · 不一致 {coverage[index].inconsistent}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" data-xdrive-backup-repository-unlisted>
                    {coverage[index].unlisted.toLocaleString('zh-CN')} 代
                  </TableCell>
                  {onSelectRepository ? (
                    <TableCell align="right">
                      <Button size="small" disabled={item.snapshot_count === 0}
                        data-xdrive-admin-backup-repository-filter
                        onClick={() => onSelectRepository(item.id)}>
                        筛选已列快照
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Typography variant="body2" color="text.secondary">
            当前宿主机尚未提供经过核验的仓库分项计数；不能推断各仓库为空。
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          仅统计宿主机在三个固定命名空间发现的规范快照目录，包含清单未展示的旧代；
          结构状态仅覆盖最新最多 100 代的 Host 清单，未列出的旧代当前状态未知，
          不得将其算作完整或异常；“完整文件”只表示结构上具备数据库与文件归档，不等于通过当前 SHA-256 校验或恢复演练；
          “筛选已列快照”仅作用于最近最多 100 代的可信清单，不能推断该仓库中其余快照不存在；
          不代表每一代可恢复，也不代表仓库目录、权限或 CAS 内容完整。
          当前不支持在浏览器输入、创建、迁移或删除任意宿主机目录；自定义仓库修改仍由本地管理员控制。
        </Typography>
      </Stack>
    </Paper>
  )
}
