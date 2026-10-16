# P053 / M005-j · real native Desktop 100k physical JPEG Go cancellation

The original source HEAD is `c5219d6d6a79c761a4a5e770e4aef362b723accb` (one work commit on `6229ac6a922ed12da47e618d2ab4f56ab95cde56`); [native CI #38831695299](https://github.com/lazyxu/xdrive/actions/runs/38831695299) and [full CI #38831695498](https://github.com/lazyxu/xdrive/actions/runs/38831695498) succeeded.

The compressed `raw-n3.tar.gz` permanently preserves **unaltered bytes** for source.txt, summary.json, and nine original Desktop sample-*.json output files from [GitHub Actions artifact #12018225428](https://github.com/lazyxu/xdrive/actions/runs/38831695299/artifacts/12018225428). The original CI artifact includes the native fixture-1/2/3 and Electron run logs separately.

* SHA256 of the permanent raw tar.gz: `6d6303d7acba46d6d7ad54bc823ca2dd31de3dbf899acc875acc05c6703e8e6a`.
* Git blob SHA of raw tar.gz: `7fda058f2c02e5190def31dc4c7a4a8ee2f6c393`.
* SHA256 of the original GitHub Actions ZIP (which includes native logs): `aacfda97a7ed334fc51120b4fd298f3c082cbf58ee80dd9adfc3b1601b0d3645`.

`metrics.json` is a readable projection of the original n3 summary for dashboard/registry consumption; the raw archive is the authoritative sample source.

Three independent genuine PostgreSQL17/Gin/Local CAS fixtures held 100,000 SHA-distinct, decodable 80×64 JPEG physical sources (70,893,376 B source payload per fixture). Nine real Desktop Electron Renderer→Preload→Main→Go Agent lifecycles generated 54 real signed JPEG requests and 54 Go Request.Context.Done handler cancellations. Original worst notification 50.226 ms within the frozen 160 ms budget; 0 old handlers and 0 bytes wasted after 160 ms. All nine Owner middle pages remained authenticated/correct. No production optimization was made: AFTER=N/A, percentage speedup=N/A.

**Delivery state:** valid original CURRENT only, requires new exact-evidence-head native and full CI/final-gate after this archive commit. Does not prove a real Windows/macOS computer, OS-installed Desktop/iOS/Android PWA, Live Motion/RAW/HEVC/LIVP, slow WAN or durable background task cancellation.
