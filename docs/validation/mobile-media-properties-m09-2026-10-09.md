# M09：共享媒体属性身份与版本生命周期回归

日期：2026-10-09。受测仓库：`lazyxu/xdrive`。不可把 GitHub CI、React 模拟组件或源码检查当成 iOS/Android 真机验收。

## 范围

Files、Gallery 和 Web Viewer 共用 `XDriveMediaDetailsInspector`；可编辑标签、人物和描述必须由当前 `Node ID + Revision` 拥有。切换到另一媒体，或同 ID 更新 Revision 后，旧异步保存结果不得覆盖新媒体的草稿、忙碌及失败状态。Gallery 列表与已选中媒体的回写同样需要校验 Revision。

未索引、索引失败、缺失字段时保持明确的未知/不可用值，不从文件修改时间猜测拍摄时间，也不从名称构造同步来源路径。文件管理器媒体属性请求继续采用 AbortController 和 ID/Revision 守卫；无需新增播放器或重取整墙数据。

## Test-first 记录

- 固定工作基线：`eff2cd922ad644b7007bd00375aa0d8ad9769768`，测试文件 `desktop/tests/media-gallery-inspector-item-lifecycle.cjs`。
- 初次**测试专用**提交 `ff3d3fddb72a43cf74f3e27bf52a6e0266568720`，[CI #4757](https://github.com/lazyxu/xdrive/actions/runs/37900765270)：Gallery 版本归属断言按预期失败（原代码 0 处，要求 4 处）；但前两个 React 用例因关闭图标 mock 值错误，不能视为业务复现。
- 更正测试夹具 `cabc7c8534633c5d5abb9debf3bb8c02b3d5151a`：仅把模拟的默认图标类型改为可渲染字符串，不修改断言或生产代码。后续基线运行：[CI #4759](https://github.com/lazyxu/xdrive/actions/runs/37901044973)。
- 最终修复仍维持**一条**相对于固定基线的工作提交；正式全套 PR CI 才是合入门槛。与 M49.V07 关联，真机执行状态仍为 not-run。

## 既有不变的契约与验收

`desktop/tests/file-explorer-media-properties-shared.cjs`：Files 懒加载、请求取消、Node/Revision 检验；`desktop/tests/media-gallery-inspector-sections.cjs`：EXIF/技术字段、未知拍摄时间、不虚构路径；`desktop/tests/media-gallery-direct-viewer-properties.cjs`：Viewer 打开属性保持当前媒体且不重复挂载播放器。上述套件应与新测试一并保持通过。
