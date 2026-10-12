# xDrive 本地存储缓存作用范围

> 2026-10-12 · Sidebar P1 范围澄清。不是容量或清理算法优化。

## Web / Mobile Web

- 「本地存储 → 浏览器存储」是当前**浏览器资料**下当前 xDrive 站点（同一 Origin）的 `navigator.storage.estimate()` 与 `Cache Storage`。浏览器报告的 `usage` 可含 IndexedDB 等站点数据，非单个账号配额，也不等于可释放字节数；缓存字节估计不是浏览器必需提供的指标。
- `clearWebBrowserCache()` 仅枚举并删除该 Origin 的全部 Cache Storage 容器，不按 xDrive 登录账号筛选。其他曾在同一站点登录的账号也可能共用可重新生成的资源。操作不会清理浏览器 HTTP 缓存、Cookie、token、localStorage、sessionStorage、IndexedDB 或其他 Origin。
- 不同浏览器资料相互隔离。站点的总空间与可清理 Cache Storage 应分别显示，不得据此承诺释放确切字节数。

## Desktop

- 「浏览器存储」来自当前 Electron 应用 `session.defaultSession` 的 HTTP 缓存 `getCacheSize()/clearCache()`，不等于 Web Cache Storage，也不按登录账号划分。既有清理方法不执行 `clearStorageData`，不会清除 Cookie 或登录偏好。
- 「Desktop 存储」来自当前设备 xdrive-agent 的可回收按需文件缓存及离线保留策略。继续调用 `agent.releaseCache()`；固定内容和“始终保留”受到保护，与个人云端配额、服务端全局 CAS 回收不是同一层。
- 两类清理确认明确标示范围，缓存重新下载的影响和实际释放量的不确定性。不会改变持久后台上传/下载/同步、用户源文件或 Server 存储操作。

## 验收边界

- Web、Mobile Web 与 Desktop 复用同一个 `XDriveLocalStoragePage`，通过不同 Adapter 表达真实可清理范围。继续检验权限、移动端布局、取消确认和原清理路径；对真实物理空间释放和性能不作新的断言。
- 这轮只调整呈现文案、专项测试与规范，无新增 Web、Electron、Go 清理 API，不涉及 Race 或性能主线。

参考 [AGENTS.md](../AGENTS.md)、[系统维护](system-maintenance.md)、[存储清单](storage-inventory.md)。
