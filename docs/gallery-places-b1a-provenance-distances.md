# P1-Places-B1A · GeoNames 最近城市来源及距离证据

**2026-10-20 · 本阶段仅建立可信 GeoNames label 持久化，尚未交付国家→地区→城市 UI。** Baidu 仍是唯一地图 Provider，GeoNames cities500 只是最近城市点，不是可靠行政边界。

## 实际数据变更

- `xd_photo_place_labels.input_fingerprint`：同一 PhotoAnalysisState GPS 数据输入指纹。旧行 default '' 明确表示**未核实/待重算**；PlaceRunner 下轮按原 Owner + live Node + 合法 WGS84 重新解析，不将旧地名当新事实。
- `region_code` 保留原始 GeoNames Admin1Code，未来须与 country_code 组合稳定地区 identity，不可按相似名字反查。
- `city_geo_name_id` 保留最近城市点原始 GeoNames ID，同名不同地域不得合并。
- `distance_km` 使用可空 float64；NULL 表示 legacy/没有结果，精确零是有效测距，不能混为“未知”。
- 原有 resolver / resolver_version / latitude / longitude 及 Ready 分析状态保留，新增证据同数据库事务 upsert；对未来 Facet API 必须验证 resolver 版本和当前 PhotoMetadata GPS，而不是盲目信任尚未完成重算的标签。

## 验收及剩余

现有 GeoNames 单元测试检查城市原始 ID、Admin1Code 与 Haversine 距离；PostgreSQL PlaceRunner 集成测试新增持久化、GPS 变动、resolver 版本和旧 fingerprint 空值重算。无新路由、没有网页/移动/桌面端状态变更，不会主动请求百度。

后续 B1-B 要实现 Owner 可见真实 distinct PhotoAsset 分层 facet、有界分页及 count；B1-C 在现有 Media Range 加入可信稳定 identity 过滤，B1-D 才进入共用 MUI 地点列表和 Viewer 锚点。近期部署/数据库迁移、真实 100k 性能、iOS27/Android/Desktop 验收均不由源码模拟代替；仅在 source-exact 77+ CI（含实际 PostgreSQL Go API Race）与 fresh GitHub clean 后才允许 Rebase Merge。

## 2026-10-23 · 旧数据重算候选与 Facet 信任谓词一致性

B1-B/C 会拒绝 GPS 指纹过期、分析状态与标签不一致、或旧数据缺失
匹配距离的地点。原 B1-A 重算队列只判断版本、空标签指纹与标签经纬度，
可能出现“Facet 不显示，但后台永不重算”的旧记录。新增候选校验：
- `PhotoPlaceLabel.input_fingerprint` 与 `PhotoAnalysisState.input_fingerprint` 必须一致。
- 标签指纹还须对应当前 `PhotoMetadata` WGS84 两个 float64 的 IEEE754 字节。
- 已解析城市的旧记录缺少 `distance_km` 或含负距离，重新解析。
- GeoNames 确实找不到城市时允许空标签/空距离，不重复排队。

真实 PostgreSQL Owner 隔离测试证明这五类错误可以重算并稳定退出队列；
但用户实例中旧数据是否已经跑完，依旧不能从源码或 CI 判断。
