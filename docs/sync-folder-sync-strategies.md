# 同步文件夹同步策略

本文档说明 xDrive 当前各类“同步文件夹”的文件发现、变更判断和字节传输策略。它描述的是现有实现约束，不把尚未证明可靠的 provider 能力写成已支持功能。

> **核心区分**
>
> - **全量扫描（full inventory scan）**：每轮重新枚举完整远端/本地清单。
> - **增量下载/传输（incremental transfer）**：扫描可以是全量，但只对新增或内容变化的文件传输 bytes。
> - **增量扫描（incremental change scan）**：从持久 checkpoint 继续，只读取 provider 明确返回的 create/update/move/delete 变化。
>
> 当前三个 Pull connector 都是 **全量扫描 + 增量传输**。真正的 `ScanChanges(checkpoint)` 目前没有对任何 Pull connector 启用。

## 统一 Source planner

所有同步文件夹最终都把文件清单转换为 `SourceObservation`，由 Server 与已有 `SourceItem` 比较并生成动作。

```text
完整文件清单
  -> SourceObservation
  -> Source planner
       -> ignore
       -> unchanged
       -> create
       -> update
       -> move
       -> move_update
  -> transfer executor
```

动作与字节传输的关系固定如下：

| Planner action | 本地动作 | 是否传输文件 bytes |
| --- | --- | --- |
| `ignore` | 忽略 | 否 |
| `unchanged` | 保持现状 | **否** |
| `move` | 仅移动/重命名已有 Node | **否** |
| `create` | 创建新 Node/File | **是**，除非 Server 命中可信 CAS instant reuse |
| `update` | 覆盖已有文件内容 | **是**，除非 Server 命中可信 CAS instant reuse |
| `move_update` | 先移动，再更新内容 | **是**，除非 Server 命中可信 CAS instant reuse |

内容变化判断按以下优先级进行：

1. 文件类型或 size 不同：视为内容变化；
2. 双方都有 SHA-256：比较 SHA-256；
3. 否则双方都有 `RemoteRevision`：比较 provider/source revision；
4. 否则比较 `ModifiedAt`。

路径变化与内容变化独立判断，因此稳定 identity 下：

```text
same identity + same content + new path -> move           -> 0-byte
same identity + changed content         -> update         -> transfer
same identity + changed content + path  -> move_update    -> transfer
same identity + same content + same path-> unchanged      -> 0-byte
```

这就是当前“增量下载”的核心：**每轮可以完整扫描，但未变化文件不会重复下载。**

## 一刻相册 Pull — `yike_photos`

### 扫描策略

每轮执行完整清单扫描：

1. 从根媒体列表开始分页；
2. 再遍历相册及相册文件，用于补足根列表无法发现的文件和保存 collection provenance；
3. 同一稳定文件 identity 在一轮 inventory 内去重；
4. 分页 `cursor` 只用于本轮分页，不持久化为 change checkpoint。

因此：

```text
当前：ScanFull
未启用：ScanChanges(checkpoint)
```

### Identity

文件 identity：

```text
yike:<owner_uk>:<fsid>
```

`owner_uk + fsid` 是内容/path 变化之外的稳定文件身份。

### Revision 与增量下载

一刻列表提供 MD5 时：

```text
RemoteRevision = md5:<provider-md5>
```

同时 planner 始终先比较 size。

因此典型判断为：

```text
same FSID + same size + same MD5 + same path -> unchanged -> 0-byte
same FSID + same size + same MD5 + new path  -> move      -> 0-byte
same FSID + different size/MD5               -> update    -> transfer
```

如果某一轮没有可比较的 MD5 revision，则共享 planner 最终回退到 `ModifiedAt`。

### Digest / CAS fast path

Yike 的 provider MD5 还会传给 xDrive upload pipeline：

1. Server 在真正收到文件 bytes 后同时验证 MD5 和计算 SHA-256；
2. 验证成功后保存 owner-scoped `MD5 + size -> SHA256` alias；
3. 后续同一 owner 再遇到已验证的相同 MD5+size 时，可直接复用已有 CAS；
4. 这种 instant reuse 的 `TransferredBytes = 0`。

所以 Yike 有两层节省：

```text
planner unchanged/move
  -> 根本不开始下载

planner create/update 但 MD5 已有可信 CAS alias
  -> Server 直接复用 CAS
  -> 0-byte network transfer
```

MD5 只用于内容 revision / 完整性 / CAS 复用，**不能代替稳定 FSID，也不能作为 change cursor**。

## Synology Photos Pull — `synology_photos`

### 扫描策略

每轮完整扫描启用的 Personal / Shared space：

1. 完整枚举 folder graph；
2. 完整分页枚举 Photos item；
3. 可选扫描 album/collection；
4. album API 失败不能把已经完成的文件 inventory 变成空清单或阻断普通文件备份。

当前仍是：

```text
ScanFull only
```

### Identity

文件 identity：

```text
synology:personal:<item_id>
synology:shared:<item_id>
```

Photos item ID 是 canonical file identity。

### Revision 与增量下载

当前 revision：

```text
有 thumbnail cache_key:
  cache:<cache_key>:size:<filesize>

没有 cache_key:
  indexed:<indexed_time>:size:<filesize>
```

`cache_key` / `indexed_time` 在这里是 **provider revision hint**，不是内容 digest。

所以：

```text
same item_id + same revision + same path -> unchanged -> 0-byte
same item_id + same revision + new path  -> move      -> 0-byte
revision/size changed                     -> update    -> Range/resume transfer
```

xDrive **不会**把 Synology thumbnail `cache_key` 当作 MD5/SHA，也不会用它做 CAS digest alias。

### 当前限制

如果 Synology Photos 没有提供可证明的内容 digest，changed item 就正常下载并由 xDrive 本地计算 SHA-256。不能为了减少一次下载把 thumbnail cache key、indexed time 或 provider media metadata 当成内容哈希。

## Synology FileStation Pull — `synology_files`

### 扫描策略

每轮从用户配置的多个 root 做完整递归目录遍历：

```text
root
  -> list folder
  -> recurse subfolders
  -> observe arbitrary regular files/directories
```

它是通用文件同步，不假设文件一定是照片或视频。

当前仍是：

```text
ScanFull only
```

### Identity

当前没有被证明稳定的 DSM file item ID，因此使用保守的 path identity：

```text
synology-file-path:<sha256(normalized-remote-path)>
```

这保证不会错误合并两个不同文件，但意味着远端 rename/move 会改变 identity。

### Revision 与增量下载

DSM 能提供 change/create time 时：

```text
v2:mtime:<mtime>:ctime:<ctime>:crtime:<crtime>:size:<size>
```

兼容旧数据或 DSM 不提供 change/create time 时：

```text
mtime:<mtime>:size:<size>:dir:<bool>
```

因此**同一路径**下：

```text
same revision + same size -> unchanged -> 0-byte
revision/size changed     -> update    -> Range/resume transfer
```

`SYNO.FileStation.MD5` 已做 capability detection，但**不会在 full scan 中给整个 NAS 逐文件计算 MD5**。这样做会让初次同步先完整读一遍文件算 MD5，再完整读一遍下载，明显放大 NAS I/O。

未来若使用 FileStation MD5，只允许作为已经缩小到少量候选文件后的按需完整性/CAS 优化，不能成为全盘扫描步骤，也不能用 `MD5 + size + path` 猜远端 identity。

### Rename / move 限制

因为当前 canonical identity 是 path-based：

```text
/documents/a.bin
    ↓ remote rename
/documents/b.bin
```

会得到两个不同 ExternalID。

当前安全行为是：

```text
new path -> create
old path -> missing（仅完整成功 inventory 后）
```

Backup 模式会保留旧 xDrive Node，所以远端 rename 目前可能形成一个新下载的文件和一个被标为 missing 的旧 SourceItem。

**不会**根据相同 size、MD5、mtime 或文件名相似度猜测 rename。只有以后获得可靠稳定 provider identity 或确定性 alias evidence，才能把这种情况提升为 0-byte `move`。

## Synology NAS Push — source-agent

Push 与三个 Pull 不同：scanner 和原始 bytes 都在 NAS 本地。

### 扫描策略

每轮对配置的 Personal / Shared filesystem root 做完整 `WalkDir`。因此它当前也不是 checkpoint-based incremental scan。

Synology Photos API 只可作为 identity enrichment：

```text
filesystem complete inventory
  + optional Photos item/folder index
  -> deterministic path + size match
  -> promote to synology:<space>:<item_id>
```

Photos API 失败时，filesystem inventory 仍然完整有效。

### Identity

优先级：

1. 已确定映射到 Photos item 时使用 `synology:<space>:<item_id>`；
2. 否则使用稳定 filesystem identity / alias；
3. 旧 filesystem identity 通过 `SourceItemAlias` 保留，不能凭 path/name/size/time 猜合并。

同一文件在同一文件系统内 rename/move 时，如果底层 filesystem identity 保持稳定，planner 可以产生 `move` 而不是重新上传。

### Revision 与增量上传

Push scanner 使用本地：

```text
stable filesystem identity
path
size
mtime
```

进行 planner 比较。

未变化项同样不会进入上传：

```text
unchanged -> 0-byte
move      -> 本地 xDrive Node move，0-byte
update    -> 上传变化内容
```

Push executor 在传输前会读取本地文件计算 SHA-256 和 chunk hashes。Server 因此可以：

- 对完整 SHA-256 做 owner-scoped CAS instant reuse；
- 对 overwrite 做 resumable/chunk reuse；
- 只把实际缺失的 bytes 计入 `TransferredBytes`。

这里的本地 hashing 不是 provider API 扫描成本，因为 source-agent 本来就在 NAS 本地直接读取文件。

## 删除、missing 与 Mirror-to-trash

当前 Pull 和 Push 的 deletion safety 都依赖**完整 inventory**，但 Backup 与 Mirror 的本地结果不同。

Backup 语义保持不变：

```text
完整 inventory 中未再次观察到 SourceItem
  -> SourceItem missing
  -> xDrive Node/File/CAS 保留
```

Mirror 是显式 opt-in 的本地回收站语义，不会写回远端。Server 为每个 SourceItem 持久化删除确认：

```text
第一次完整成功 inventory missing
  -> mirror_missing_full_scans = 1
  -> mirror_missing_since = now
  -> 不删除

后续完整成功 inventory 仍 missing
  -> mirror_missing_full_scans = min(2, count + 1)

count >= 2
AND now - mirror_missing_since >= 24h
AND run 是 sync
AND Source 配置仍与 run snapshot 一致
AND Node/path/revision 仍与最后同步状态一致
  -> 移入 xDrive 回收站
  -> 不做永久删除
```

安全规则：

- **只有最终状态为 completed 且 complete_inventory=true 的运行才推进 Mirror 删除确认**；
- partial、failed、cancelled 永远不能推进 Mirror 删除确认；
- scan-only 运行可形成完整 inventory 证据，但不会执行回收；真正 trash 只发生在 sync run；
- Source 的 sync mode、target 或 ignore 规则变化会使旧删除证据失效/复位；活动 run 也必须匹配其启动时的 Source revision；
- SourceItem 一旦重新被观察到，missing 次数与 grace 起点立即清零；
- Node revision、Node 类型或实际相对路径与 SourceItem 最后绑定不一致时，视为存在本地改动，自动回收 fail closed；
- 若一个远端目录下混有未归属该 Source 的本地内容，则不会把整个目录作为 trash root；只处理能够独立证明安全的 Source 子项；
- 用户恢复/修改一个 Source 目录后，该目录 revision 变化会同时保护其仍然 missing 的后代，避免恢复后下一轮被拆散再次回收；
- Mirror 只设置 xDrive `deleted_at / trash_root_id`，CAS/文件版本不永久删除；用户仍可从回收站恢复；
- 每个实际自动 trash root 记录一条 `source.mirror.trash` system audit，并关联 source/run/remote path；
- provider 仍保持只读，Mirror 不调用远端 delete；
- Web/Desktop 共用同一同步策略选择器，默认值始终为 Backup；Mirror 必须由用户显式选择，并在创建、设置和详情中显示 2 次完整扫描 + 24 小时 + 仅回收站的安全说明；
- Mirror + 仅扫描会明确提示：扫描可以累计可靠缺失证据但不会执行回收，之后切换到同步时已经成熟的证据可能在下一次完整成功同步中生效。

未来若实现真正 `ScanChanges(checkpoint)`，只有 provider 明确返回可靠 delete tombstone 时，delta run 才能参与删除证据；“这一轮没出现”永远不能替代 tombstone。

## 当前增量能力矩阵

| 同步文件夹 | Inventory scan | Stable identity | Content/revision hint | Unchanged 0-byte | Pure move 0-byte | Digest/CAS fast path | 真正 change cursor |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 一刻相册 Pull | Full | `owner_uk + fsid` | MD5，fallback mtime | ✅ | ✅ | ✅ verified MD5+size → SHA256/CAS | ❌ |
| Synology Photos Pull | Full | Photos item ID | cache key + size，fallback indexed time + size | ✅ | ✅ | 无可靠 provider digest；正常本地 SHA-256 | ❌ |
| Synology FileStation Pull | Full recursive | 当前为 path identity | mtime+ctime+crtime+size，fallback mtime+size | ✅（同 path） | ❌ 远端 rename 会换 identity | MD5 仅保留为未来窄范围按需优化；不全盘 hash | ❌ |
| Synology NAS Push | Full filesystem walk | Photos item ID 或稳定 filesystem identity+alias | size + mtime；稳定 identity 分离 path | ✅ | ✅（identity 保持稳定时） | ✅ 本地 SHA-256/chunk hash → CAS/chunk reuse | ❌ |

## 关于未来 Incremental ChangeScanner

真正的增量扫描必须独立于上面的增量传输。

只有 provider 能证明以下全部条件时，才能启用 `ScanChanges(checkpoint)`：

- checkpoint 可持久化并可靠恢复，或有明确 reset contract；
- stable file identity；
- create/update/move 语义明确；
- **可靠 delete tombstone**；
- checkpoint 分页不会漏项/重复导致状态错误；
- 可以安全 fallback 到 `ScanFull`；
- 仍有周期性 full reconciliation 修复漂移。

否则继续使用：

```text
full inventory scan
    +
incremental transfer
```

不要使用 `mtime > last_sync_time`、indexed time、pagination cursor、MD5 或 size/path 组合作为伪 change cursor。
