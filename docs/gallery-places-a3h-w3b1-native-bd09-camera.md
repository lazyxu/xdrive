# P0-Places-A3h-W3b1 · Native BD09 Camera/Zoom 可信返回

> 范围：**W3b 的第一项源码能力**，不是全部 W3b/P0-05 验收。
> 原有 A3h-W1/W2/W3a 可信 Owner Cell Range、VirtualCollection、Viewer 保持不变。

## 实际问题与根因

- Static Map 使用 `XDrivePlacesCameraSnapshot` 保存 WGS84，已有 10 分钟、最多 8 Owner scope 的短期内存快照。
- 原 Native JSAPI4 地图从真实照片 WGS84 sample 调用百度官方 Convertor，再以 BD09 显示。平移/缩放后的 `BMap.getCenter()` 直接属于 **BD09LL**，不能当作 WGS84/EXIF 保存、混用或再执行一次 1→5 转换。
- Native Surface 初始 Loader 与 React 生命周期依赖 camera 值；若每次地图移动都改其初始 camera，会在移动过程中反复卸载、重建 SDK 地图，引起空白、位置跳动与资源抖动。
- Viewer/页面导航可能卸载 Places 视图。需要重新进入时恢复独立 Native camera，而不是恢复原始首个地点坐标。

## 本阶段交付

1. **独立 BD09LL 类型/缓存**：`media-gallery-baidu-native-camera-session.ts`，固定 `coordinate_space='bd09ll'`，验证经纬度与 Zoom，不含任何原照片、Node、Token/AK、缩略图或用户私有对象；Owner scope 隔离、10 分钟 TTL、最多 8 个记录、深拷贝、明确清除；仅内存，不写 URL/Storage/SW。
2. **可信 Native 坐标来源**：只在已签名 Map SDK 的 `getCenter()/getZoom()` 且数值合法时捕获，在 `moveend/zoomend` 时更新；卸载/授权失效时解除监听，旧请求不会覆盖后续 Owner。
3. **明确初始化坐标系**：首次原照片 WGS84 仍走百度官方 1→5 Convertor。只有带合法 `coordinate_space='bd09ll'` 的回访相机才使用 `BMap.Point` 直接设置；不会误当作 GPS Range 或转换两次。
4. **页面恢复无抖动**：PlacesMap 的 `nativeRestoreRef` 冻结一次进入的相机，父组件接收平移结果时不会反复改变已挂载地图的初始化参数；主动切换地点则清除旧 BD09，使用新地点真实 WGS84 样本。
5. **不扩权**：`/cells`、`/cell-items`、Owner/Consent/Session 及一切现有服务端请求均不修改；动态地图 Provider 仍只有百度，Static Baidu 保留；不将 BD09 直接交给 A4 WGS84 BBox。

## 有界源测试

`desktop/tests/gallery-places-w3b1-native-bd09-camera.cjs` 从**实际源码**加载 TS 模块进行运行断言，覆盖 BD09/WGS84 拒绝、超界/非数/缩放拒绝、两个 Owner 隔离、快照防污染、10 分钟 TTL、失效的 BMap 属性、无隐式持久化，以及 Surface/PlacesMap/Gallery/Loader 的源码传递合同。CI 的 Web/Desktop TS 构建覆盖编译。

## 未交付和下一步

- **W3b2**：返回地图的选中 Cell identity、排序、VirtualCollection/列表滚动锚点和 Viewer 返回时的原聚合高亮仍待实现。
- **W3b3**：Desktop HTTPS 独立地图与 Agent/Viewer 完整等价；受控真实 iOS27 375/390/899/900/横屏、弱网、快速切换和 100k/Go ctx.Done 实测仍待验证。
- **P0-03**：当前第三方可执行 JS 仍与可信 Gallery 同文档，尚未实现独立 Origin iframe/严格 postMessage 沙箱；本阶段**不冒充解决 JS 隔离**。
- **生产安全验收**：根据用户已经合入 `AGENTS.md` 的永久指令，**按用户决定跳过（未验收）**，不请求生产 AK/HAR/访问权限，不作为源码 CI/PR 合并门槛。Owner/Consent/CSP/撤销、第三方 JS Origin 隔离等可控工程要求仍有效。

本阶段应独立执行准确 HEAD 77+ CI、Final Gate、GitHub clean 后再决定合并；不沿用 W3a 或父主线的 CI 成绩。

## 2026-10-20 · 第一次准确 HEAD CI 真实失败及修正

- 初次 `2361d3c` [CI #39450861177](https://github.com/lazyxu/xdrive/actions/runs/39450861177) 的原 Desktop `gallery-places-viewport-quiet-navigation.cjs` 因直接编译并安装 `MediaGalleryPlacesMap.tsx`，却没有提供 W3b1 新增的可选、独立 BD09 相机模块替身，发生 `MODULE_NOT_FOUND`。已保留原始静态地图 mounted 测试及所有断言，仅为该旧夹具注入拒绝 Native 路径的惰性可选模块，不能绕过 Owner 授权来触发真实 Native 地图。
- W3b1 原模块自身的真实 TypeScript 转换和 BD09 验证、Owner 内存缓存、BMap 错误分支测试在同一次 CI 中均 **PASS**；旧环境缺少模块不等于产品运行失败。
- 重建同一 Draft PR 为唯一 scoped 工作提交时，保留所有原非 AGENTS Blob SHA、五个被动注入模块相关源码文件及用户已合入的 AGENTS 永久生产验收跳过规则；新 HEAD 必须重新跑完整 CI/Final Gate，不沿用旧红色测试或独立 W3a 的 CI。
