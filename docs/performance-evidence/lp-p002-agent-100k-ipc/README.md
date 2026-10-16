# LP-P002 实体100k Agent 本机 HTTP IPC 性能原始证据 — 2026-10-16

**真实范围：** [首轮有效真实专项CI #38917769347](https://github.com/lazyxu/xdrive/actions/runs/38917769347)，源码原始commit `d2fd14f8f1ecbdc5ed772aa2e1c00be08cfc56d4`。每组独立Linux文件根100,000个**不同SHA、不同(dev,inode)、非硬链接的真1KiB文件**，100目录、逻辑102,400,000B、Linux st_blocks分配409,600,000B；Go Agent真实loopback HTTP/Bearer认证→**只用于测试的Manager Adapter**→正式LocalPush Go Scanner/Journal/Delta。**不是真实用户授权的生产agentController、远端Server、Electron/Windows UI或实际Push。**

**结果 ORIGINAL CURRENT（无生产优化）：** 三独立源样本、1000文件smoke；第一次IPC保存P50 **985.176ms**、第二次**997.674ms**、增量GET**2416.314ms**，Go进程maxRSS **25,944KiB**；每组Agent HTTP摘要响应 256/255/223B，匿名前置HTTP401、无Root/path/token泄漏。真两代Snapshot Delta 1000 added /1001 changed（含目录）/98099 metadata stable /1000 absent candidates，均为non-authoritative。源seed P50 4189.337ms另计，个样本CPU、`/proc/self/io write_bytes`都在原始JSON内。原版≤180s/阶段、RSS≤512MiB等冻结预算全部通过；**CURRENT Accepted，生产 AFTER=N/A、speedup=N/A**。

**11个原始文件永久逐字节归档：** [ci-run-38917769347.tar.gz](ci-run-38917769347.tar.gz) 内容为 `sample-{1,2,3}.json`、`sample-{1,2,3}.log`、`sample-{1,2,3}.resources.txt`、`source.txt`、`summary.json`（11件）。ZIP原始 [Artifact #12053226928](https://github.com/lazyxu/xdrive/actions/runs/38917769347/artifacts/12053226928) SHA256 `4e4250866393a44a67e29f4616713ec8478fe75a4c6f14b499aa5b248595847a`；本仓库确定性tar.gz SHA256 **`90b85c99a7543b7436a143de24e3ef272730323249405f289be485b743c85ee4`**，Git Blob `f53fc45c716883b5452de14bfc31d8c084b84a22`；记录源具体8个Go文件SHA。归档保留原始文件bytes、不截取或修改原始资源统计。

**严谨验收：** 首轮Go代码在runner做过`gofmt`后编译，机器`source.txt` SHA为该规范化代码（`17c3adad0db9d2d9b375b3ac7b9b142a69942ccb455ef0da19727b1d4883e4ce`），同一内容已在本修订作为格式化源文件保存。最终证据HEAD专用CI将先校验原始压缩包SHA、11个完整文件、源8个Go文件SHA，才执行新的3×100k；完整CI的 single-commit+final-gate 成功之前不能 Ready/合入。

参见 [LP-P002规范](../../localpush-desktop-agent-ipc-100k-performance.md)、[中央登记簿](../../performance-test-registry.md)、[六平台矩阵](../../performance-platform-coverage.md)。
