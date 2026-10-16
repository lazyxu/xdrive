# CAS-A03-d3 · real HTTP 4GiB original n3, source-exact numeric evidence

- Stable workload: `CAS-A03-d3 / S001-d3`.
- First valid code SHA: `877054f3bcb60b2247ac7ae3092fc8570c4a6f61`.
- Specialized original CI: [#38951921025](https://github.com/lazyxu/xdrive/actions/runs/38951921025) — genuine PostgreSQL17 64MiB smoke and independent 3×4GiB tests passed.
- Full CI: [#38951920350](https://github.com/lazyxu/xdrive/actions/runs/38951920350) — source-exact initial HEAD successful.
- Complete GitHub [original 11-file short-retention ZIP](https://github.com/lazyxu/xdrive/actions/runs/38951921025/artifacts/12067754796) — SHA256 `d2f3988d46aa81a16bfb6c1f82d27a9dd5566d3420c0bab1b335c1134f59c7e2`, raw ZIP size 83,519 bytes. Do not claim this transient file is permanently committed.
- Permanent [original 8 numeric/source/resource files preserved byte-for-byte](ci-run-38951921025-numeric.tar.gz) + README of all original 11 per-file SHA256. Deterministic `tar.gz` SHA256 `c032c767cbf5b452f14d45b3de551c2032a35b4e13ee5cb57316a8d6d5ad2337`, Git Blob SHA `68015cf60d7eab3b6126a6dc32f0e721d8ad3f48` (2,746 B).
- All three original `sample-i.log` verbose Go stdout are only in the original ZIP, **not** in this permanent subset. Preserve this limitation; do not report 11 permanently stored files.
- Source & summary are genuine original CI bytes, source SHA and CI run ID in `source.txt`. Initial baseline `B_postseed_rss_growth_bytes=0` is the **end-start** delta, *not peak RSS*. The next work HEAD adds a 25ms peak monitor and real handler request counter to close that test gap without any product changes.
- Real CURRENT P50 initial A upload 50,157.046ms; B init old-CAS scan 2,310.343ms; B one 8MiB PUT 46.204ms; B full 4GiB finalize 25,075.655ms; 4,303,355,904 B new B kernel write; two-version 8,589,942,784 B allocated; final verified GC 408.452ms. Production AFTER=N/A. All six client versions not measured.

## 第二次 n3：HTTP PUT 与 25ms RSS 峰值仪表（2026-10-17）

- Exact Go+workflow test source: `2b57dfc029a794ab20db1b7effebe7765cbd7453`；[真实 n3 专项 CI #38953556661](https://github.com/lazyxu/xdrive/actions/runs/38953556661) 为 Success，完整验证 Artifact [#12069796643](https://github.com/lazyxu/xdrive/actions/runs/38953556661/artifacts/12069796643)，原始ZIP SHA256 `87826d6b5e6ac20e54157adea8154f992e72289abfd01264d04980a24303e813` / 80,322 字节。
- [新的不可变数字档案](ci-run-38953556661-verified-numeric.tar.gz) 2,854 B，deterministic tar.gz SHA256 `401e75c553a3f33ab1bda37ff13795d1a40fdae910a9fd99e6f88dcd2b4f0305`；Git blob `4ee066f1bbf2501da7c225e788a46cb4e7c9c375`。保存3份sample.json、3份time资源txt、summary/source原始字节，再加 README.txt 和MANIFEST.json（原始11个文件SHA256和长度）。3份原始大Go stdout只保留在Artifact（有到期时间），不是永久文件。
- 真实 n3 每轮分别4GiB / 512×8MiB A初传，B中部1MiB异或，511块重用、1个8MiB PUT；保留两代完整SHA并最后Owner HTTP永久删回收。旧B完整CAS再次存4GiB，生产数据存储没有压缩或分块改造。
- P50 B Init 3,117.744ms；B changed PUT 28.165ms；B full CAS Finalize 16,756.892ms；新增内核写4,303,355,904B；A+B持久占用8,589,942,784B；B 阶段25ms RSS峰值增长P50 126,976B，3轮最高573,440B；GC P50 429.078ms。
- 以上新旧两次源准确CI相互独立，并非同环境优化A/B；生产 AFTER=N/A。终版文档/证据提交仍要求再执行当前提交完整CI及原生专项通过后才可合入。
