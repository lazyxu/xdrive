# P0-01 · 百度 JSAPI4 Child 来源、许可与资源边界审计

日期：2026-10-24（根据当前 master 重新核查）。仅审查源码与公开文档；不等于实际商业授权、线上资源全量观测、第三方脚本可信或生产环境安全验收。生产不可接触验收按用户决定跳过（未验收）。

## 已证实的源码约束

| 位置 | 已有边界 | 尚不能证明 |
| --- | --- | --- |
| Gallery Parent | Caddyfile.parent.example 的 frame-src 仅允许配置的独立 Child，script-src 仅同源 | 所有实际部署已启用该可选 CSP |
| Child Host | Caddyfile.example 只服务三个本地静态资源，Session 与 _BMapService 仅代理 Go，其他 404 | 实际域名、证书、Cookie/Storage 隔离和不同浏览器兼容 |
| Child SDK | child.js 使用本机同源 serviceHost 和 /_BMapService/api?v=4.0，不向浏览器参数添加 AK | 已覆盖全部真实 SDK 子脚本、瓦片、字体、WASM 路径 |
| Go Resource | 单一 source-approved Baidu serviceHost 资源族，严格请求字段、Content-Type、签名 release、Owner Cookie、AK revision、配额限制 | 已观测所有真实上游域名，或资源族相当于逐条审计 |
| Session | 一次性 25 秒 Ticket；PSL 不同站点；Child 独立 Partitioned HttpOnly Cookie；旧 Gallery Session 禁用 | 真实 Safari/PWA/Desktop Cookie/Session 生命周期通过 |

新增 desktop/tests/gallery-places-p0-01-provider-resource-audit.cjs 仅检查上述原源码约束，防止直接外部脚本/通配 Caddy 代理、CSP 退化、Policy 版本或签名/隔离代码被移除。它不发外网请求、不访问真实 AK、不采集用户数据。

## 官方参考与未解决证据

- 百度 JSAPI4 服务端保护 AK 的 serviceHost 代理模式：https://lbs.baidu.com/docs/jsapi?title=jsapi4/guide/concepts/proxy
- JSAPI4 Loader 与版本：https://lbs.baidu.com/docs/jsapi?title=jsapi4/guide/concepts/load
- 坐标转换及源 WGS84 与 BD09 区别：https://lbs.baidu.com/docs/webapi?title=geoconv/guide/changeposition
- 服务条款及商业使用条件：https://lbs.baidu.com/docs/pcsa?title=law/open/law

本轮没有取得对具体账户和场景有效的许可、衍生 BD09 坐标存储/保留/导出规则，也没有完整真实运行的版本化外部子资源清单；不能推导出“可以永久存储”、“所有子资源已批准”或“实际地图三端已通过”。不凭诊断日志扩大资源 allowlist，未知资源或版本漂移一律拒绝。独立 Child 失败后仅保留可信图库的地点列表和照片墙，不请求、不展示静态百度地图。

## 后续可控工程工作

1. 非生产受控环境采集去敏的实际 JSAPI4 子资源域名/路径/查询/Content-Type/版本，逐项核对 Go 规则；确认许可时只记录授权结论及适用范围，不公开凭证。
2. 验证真实独立 HTTPS Host、Parent/Child 响应 CSP、跨站 Cookie、AK 轮换、后台恢复、Child 失败粘滞隔离、无静态回退与恶意 Child 浏览器对抗测试。
3. 复用 #2330 的 Owner/Consent/Revision 与 #2336 的 Child 生命周期和手势取消回归测试；P0-09 单独测地图真实 100k PostgreSQL Cell 查询、P50/P95、CPU/RSS 和 Abort→Go ctx.Done；普通图库 100k 不可代替。
4. 源码安全完成后依次处理 B1-B/C/D → B2 → B3；生产环境不可接触安全验收仍按用户决定跳过（未验收）。

## 2026-10-24 合并前源码审计说明

当前 JSAPI4 同页原型与独立 HTTPS Child 是两条明确不同的运行路径；同页模式直接运行第三方脚本，不能声称拥有 Child 的独立 Origin 保障。本文件只审计隔离版固定资源入口，不代表同页版也具有相同隔离强度。生产环境不可接触的安全验收为 **按用户决定跳过（未验收）**，不阻塞源码级安全回归、CI 或 PR 合并。
