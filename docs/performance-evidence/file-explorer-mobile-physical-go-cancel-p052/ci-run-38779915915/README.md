# P052 physical 100k real Mobile Web upstream cancellation evidence

Original SOURCE SHA: `a4dc597c5c4507c1cb0b7044146f888a138abd67`. Native CI [#38779915915](https://github.com/lazyxu/xdrive/actions/runs/38779915915) SUCCESS; first exact-head full [#38779915873](https://github.com/lazyxu/xdrive/actions/runs/38779915873) 25 required successes, including Final Gate.

Archive `raw-n3.tar.gz` stores the original **unchanged** `source.txt`, `summary.json` and six Grid/Details sample JSONs produced by that native run. It does not invent a new benchmark or reconstruct response durations. Verbatim source and exact sample JSON can also be retrieved from original [GitHub artifact](https://github.com/lazyxu/xdrive/actions/runs/38779915915/artifacts/11995333174), which includes full native process logs.

SHA256 of archive: `57f669e110da4d3c6fb95296c89dd4775488f3a12a421a10c418c40da1a0938e`; Git blob: `35d523b7b433229c3536f5bf07577807e4780035`.

Use `tar xzf raw-n3.tar.gz` to inspect. `metrics.json` is an authored index/projection, not a substitute for six original samples or performance data.

Each independent sample had 100k SHA-distinct physical originals in its own fresh PostgreSQL/CAS fixture; results measure six live thumbnail clients cancelled after real 390px Web virtual scroll, not 100k concurrent transfers or native Android/iOS/PWA. Historical invalid harness records `38778285379` and `38778786252` are retained separately and do not count as product RED.
