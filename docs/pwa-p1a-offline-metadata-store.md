# PWA P1-A — 有界、明确授权的目录元数据 IndexedDB 基础层

状态：**阶段性源码实现，不是 P1 完成，也不是用户已可离线浏览全部文件**。

## 前置与基线

P0-A App Shell #2246、P0-B 旧哈希静态资源兼容和 P0-C0/C1/C2 BEFORE 已合并。
已记录真实 Chromium 390px 公开 Shell n9 首次/二次/模拟离线 FCP p50 为 296/132/120 ms
（准确历史代码来源及 CI 见 `docs/pwa-ios-p0c-browser-baseline.md`）。
100k 混合图库 2761.342 ms 是独立、不同负载的 CURRENT/BEFORE；不是本阶段的 AFTER。
P1 属于新能力，绝不按不同 Runner 或缓存状态计算加速倍数。

## P1-A 能力边界

新增 `web/src/pwaOfflineDirectory.ts`，无自动启动、无预取、无 UI、无 SW 拦截。
调用者后续必须取得在线 `/me` 验证后的账号 ID、用户名及当前 Origin，
**由用户明确开启** `xDrivePwaSetOfflineConsent(owner, true)` 才能写入。
禁用会在同一 IndexedDB 事务删除此账号缓存。
退出、账号切换调用 `xDrivePwaClearOfflineMetadata()` 删除本站所有账号的这类元数据。

每个账号最多 10 个曾访问目录、每目录 20 个文件/文件夹摘要、
合计 200 条、192 KiB、最长 7 日；必须来自用户在线已获授权、成功返回的当前目录读取。
仅保留 ID、显示名称、file/dir 类型、大小、修订号、日期、目录总数（可未知）和采集时间。
输入使用 `slice(0, 20)`，100k 原始数组也不在缓存逻辑中完整复制。
明确不存储原图、视频、Live、EXIF、GPS、SHA256、下载票据、JWT、Cookie、URL、
文件原始字节、缩略图与文件体。非安全环境/IndexedDB 不可用时拒绝写入。

同一 Origin 内按 **Server 授权的用户 ID + 用户名** 分区；当前同 Origin 服务端重置
或反向代理改绑后的服务器实例 ID **尚无可信固定标识**，因此不能将 P1-A
误称为已经实现跨服务器实例的完整隔离。上线前应增加 Server 持久实例标识、
重新联网的身份/ACL 复核、会话生命周期自动清理、跨标签页登出与禁用回归测试。

读取结果强制 `revalidated: false`；不能注入在线 FileExplorer，
不替换 Owner API/JWT/ACL，更不能被当作下载、搜索、预览、写入权限。
联网后必须重新从服务器读取授权范围；断网时只可能展示「本地历史、未验证」的只读副本。
当前 PR **没有启用这条展示路径**，所以不能声称已经能离线查看文件列表。

## 后续独立验收

P1-B：接入已登录用户的明确 opt-in 设置、验证成功后的当前目录有限写入、
登录/登出及账号切换、真实 Chromium IndexedDB 存储、丢网/重连权限负例，
所有读路径始终 fail-closed。P1-C：图库集合摘要的有界只读离线展示。
P2：得到独立授权后再考虑有限缩略图 Cache/IndexedDB 配额与清理；不得预缓存整个图库。

P0 真实物理 iPhone Safari/Home Screen、WAN、用户生产流量并未由 Chromium 基线证明。
生产环境不可访问的安全验收：**按用户决定跳过（未验收）**；源码级权限、
Owner、撤销、隔离、CI、安全负例不可跳过。
