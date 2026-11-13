# M15：iOS 原生地图断网、瓦片失败与定位恢复

本 PR 已补两条真实代码路径。

1. CoreLocation：只有用户主动按「我的位置」才会创建一次 CLLocationManager；15 秒后无回调就有界失败并给出手动重试提示，断开/关闭/成功/权限失败都会取消旧超时。旧 manager 与旧 callback 不会覆盖新请求。
2. 本机 PhotoKit MapKit 和云端 Owner MapKit 使用各自真实 MKMapViewDelegate 的 mapViewDidFailLoadingMap、mapViewDidFinishLoadingMap 反馈瓦片失败和恢复。失败提示是展示层状态，不是假冒照片来源；本机 GPS 仍仅 Full Access 可用，云端仍强制 Owner ACL。联网后地图原生重试加载时清除失败提示。

**未验收**：真机飞行模式→联网、MapKit 服务端瓦片故障模拟、不同网络接入、真实 15s 超时、极区和跨经线实时手势帧率。已有委托及源测试并不能证明系统网络故障下已经完美恢复。未增加离线地图瓦片缓存或绕过授权。
