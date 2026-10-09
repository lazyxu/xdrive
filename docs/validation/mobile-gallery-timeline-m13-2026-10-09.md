# M13 — Gallery 时间线导航与日期返回定位

日期：2026-10-09。固定基线：bd96b2b1946f7bc31a2dbd27c57a74ed978839ec（M12 已合入）。

## 变更范围

保留原有年／月／日／所有照片时间尺度、每尺度独立密度偏好、原比例开关、IANA 拍摄/添加时区以及通过 anchor_node_id 的 Server 排序锚点。不改 SQL 排序、图片加载器、虚拟列表分页或缩略图数据链路。

在“日”视图显示原生 date 输入，按 Server 的 timeline_group_sets.day 做 O(log groups) 查询。准确命中直接跳对应 start_index；没有对应照片的日期，跳按日历距离最近的**真实存在的日分组**并显示实际日期，绝不将空日说成有照片。未知日期继续在独立 unknown 组，不猜时间；无有效日期时保留当前位置、明确反馈。

年/月继续使用已有有界月份索引下拉，日视图额外提供精确日期输入。当前浏览日期来自可见锚点与实际分组，虚拟100k时间线跟随窗口的首个可见逻辑项，非虚拟集合用已挂载的日期标题加二分搜索按帧更新。只在日期**分组**改变时更新 React 状态，快速滚动不会造成每行一次状态重绘。

跳转前保存当前逻辑锚点，提供“返回刚才位置”操作；时间尺度/密度/比例切换仍走原有 virtual Grid/Timeline restoreAnchorRevision。集合、排序、时区或集合数量变化时清空旧返回锚点以避免错误恢复；全屏移动 Web 无全局底栏/Tab 改动。

## 验证范围

- `desktop/tests/media-gallery-timeline-navigation.cjs`：日期有效性、精确/最近/未知日语义、升降序、同距离更早日期、100k 索引 O(log N) 读取数量及 UI 原有滚动锚点接线。
- `desktop/tests/media-gallery-virtual.cjs`：虚拟范围与分组排布；`media-gallery-sort-anchor.cjs`：排序保留原始逻辑照片位置；共享 `media-gallery.cjs` 及 Web build/Desktop typecheck 为回归门槛。
- M49.V11：短横屏、日期原生输入、200%字体、打开 Viewer 返回、iOS Safari 与 Android Chrome 普通/安装模式必须单独留证，目前 **NOT RUN**。Chrome/Puppeteer/静态验证不等于真机触控/软件键盘验收。

状态：在开发与 CI 验收中，禁止先行宣称已合并或真机通过。
