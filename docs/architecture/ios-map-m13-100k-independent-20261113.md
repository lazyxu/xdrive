# M13 真实 10 万 PhotoKit 性能专项的独立增量 PR

此 PR 基于 P0 #4305 分支（stacked PR），不会再复制现有的 PhotoKit 扫描器、CPU、内存、CADisplayLink 和真实 EXIF 导入实现。前置 P0 合入后再把此 PR 改为针对 master。

本增量在三阶段性能报告中分别核验来源：scan 至少有五次真实完成的全库扫描；wall 必须有真实地点墙触控帧记录；zoom 必须同时包含 MapKit 手势帧和 verified viewport 零分页缓存命中。严禁 scan 的日志冒充 wall/zoom 报告；CI 一旦发现缺少阶段的原始事实就直接失败。新增审计器和单元测试阻止未核对的 stage 字段通过。

这不等于已测得 10 万 PhotoKit 的真实吞吐。100k 精确成员、首次扫描、帧回调、CPU、内存峰值及 P50/P95 必须以真实 iOS Simulator 和真机报告分别证明，不可用合成数据替代。