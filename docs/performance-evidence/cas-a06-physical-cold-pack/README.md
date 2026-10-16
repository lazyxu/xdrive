# CAS-A06 · 100k实际小Blob Linux FADV_DONTNEED cold/warm原始A/B（2026-10-17）

[真实n3专项 #38932992440](https://github.com/lazyxu/xdrive/actions/runs/38932992440) 准确源码 `c0a0951d577676755f82196ea58ac1da02ac0c52`：每组100,000个不同SHA、实际生产Local.Put fsync/不可变CAS原片，每个1KiB、Linux `st_blocks`分配409,600,000B，离线独立Pack文件/Index/HEAD物理107,204,608B。Linux `FADV_DONTNEED`提示后两者完成同源**2,000不同原片完整SHA及256B Range**，明确检查双方内核实际`read_bytes>0`，紧接同源Warm 2,000次。POSIX hint**不能保证所有平台真正冷缓存**，更不是在线Pack/API、Pg owner/GC、Desktop/Web/PWA使用体验。

| n3准确文件原片 | Local Cold 2k wall | Pack Cold 2k wall | Cold 请求P95/99 Local | Cold 请求P95/99 Pack | Cold kernel真实read_bytes Local/Pack | Warm 2k Local/Pack | RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 322.421ms | 247.882ms | 205/338μs | 149/215μs | 8192000/8192000 B | 61.187/17.015ms | 34428KiB |
| 2 | 315.122ms | 248.592ms | 193/268μs | 149/209μs | 8192000/8192000 B | 63.948/17.068ms | 38060KiB |
| 3 | 309.441ms | 247.861ms | 183/236μs | 149/197μs | 8192000/8204288 B | 60.375/16.860ms | 34244KiB |
| P50/max | **315.122ms** | **247.882ms** | **193/268μs** | **149/209μs** | **8192000/8192000B** | **61.187/17.015ms** | **38060KiB** |

[永久tar.gz](ci-run-38932992440.tar.gz) 将 **11份原始字节文件完全不修改**（每个sample一份 JSON、Go stdout和 `/usr/bin/time -v`，另`summary.json`和`source.txt`），以确定性gzip mtime0，tar排序、uid/gid/mtime0存入Git。SHA256 **`4207d853cbed2f3c1311b08aee19be3ac2e3d332e72923fb6e237333982cfc47`**，Git blob `cb7686e0d5bcc2eae53c2ccfdfbc63b355a4d63c`；原始[GitHub Artifact #12059453194](https://github.com/lazyxu/xdrive/actions/runs/38932992440/artifacts/12059453194) ZIP SHA256 `1c414e5716a5dfab9df8cd7a7a01e56bee6867056d822e085ad19f372a96e861`。可自行`sha256sum ci-run-38932992440.tar.gz && tar -tzf ci-run-38932992440.tar.gz`。源码身份在`source.txt`中记录4个实际Go文件SHA；最新证据HEAD专项CI会在执行真实100k之前验证原始包和源码完全未改变。

**状态**：Accepted OFFLINE Advised Cold candidate；原版CURRENT，生产AFTER=N/A。首次`0cc9c5e...` [CI #38932274121](https://github.com/lazyxu/xdrive/actions/runs/38932274121) gofmt Invalid(n0)和`ed417dc...` [CI #38932483756](https://github.com/lazyxu/xdrive/actions/runs/38932483756) Go int64浮点预算编译Invalid(n0)已单独[机器登记](invalid-harness.json)，不是产品RED。有效 `c0a0951...` n3专项成功；**本次证据修订新HEAD仍需准确专项三轮100k及全仓FinalGate成功**才允许合入。

更多[CAS-A06性能规范](../../cas-small-pack-cold-performance.md)、[中央登记簿](../../performance-test-registry.md)、[六端矩阵](../../performance-platform-coverage.md)。

**证据归档纠错（2026-10-17）：** [最初证据HEAD CI #38934142527](https://github.com/lazyxu/xdrive/actions/runs/38934142527) 发现错误压缩Blob校验失败，有效100k=0；[诊断 CI #38936913161](https://github.com/lazyxu/xdrive/actions/runs/38936913161) 计算损坏包实际SHA256为 `84ace7a2a3fde658cfa95b83f701e47c7ccd9d1ee0bdae0dedeaec8aa4d15fd2` 且gzip CRC错误。重新从原始 Artifact #12059453194 中的**全部11个原始未改写成员**构造确定性gzip（原ZIP SHA256 `1c414e5716a5dfab9df8cd7a7a01e56bee6867056d822e085ad19f372a96e861`），本仓库真实文件Git Blob修正为 `cb7686e0d5bcc2eae53c2ccfdfbc63b355a4d63c`、SHA256 `4207d853cbed2f3c1311b08aee19be3ac2e3d332e72923fb6e237333982cfc47`。准确新HEAD 专项CI重新严格检验gzip SHA、Git Blob身份、11成员、四源码SHA并实测100k；完整CI FinalGate通过前仍不合并。历史原样保留，未改变产品。
