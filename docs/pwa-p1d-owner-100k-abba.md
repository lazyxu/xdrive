# PWA P1D - Genuine Owner 100k A-B-B-A test order attribution (2026-10-23)

The already merged P1C #2420 used one frozen before→after ordering.
Its 390px real Owner 100k logical/115k metadata Go/PG17/CAS n3 result
showed Go Context.Done P50 57.505 ms before versus 105.760 ms after,
and renderer peak RSS growth P50 24.473 versus 30.992 MiB.
Both met the existing 160 ms cancellation gate, but the difference is
not proof of a systematic improvement or regression without isolating
run-order, thermal, OS scheduler, HTTP/CAS load and random seed effects.

P1D reuses the two EXACT immutable historical production Web release SHA's
from #2420, the byte-identical original browser benchmark and one real
compiled Go test binary. On the SAME GitHub Runner, use A-B-B-A sequential
order; each session is 3 fresh Go/PG17/LocalCAS fixtures and 390px native
Electron browser runs with 100k logical assets, 115k metadata nodes and only
4-6 genuine in-flight JPEG response streams. Verify all actual Context.Done,
Handler cancellation, <160ms, zero wasted Go bytes and realistic CPU/RSS.
Both order directions A→B and B→A must report independent deltas.

Even if the observed order-balanced gap is small, this does NOT establish
100k cold App/Gallery first paint, 100k different originals, video/Live
decode or a corrected code bottleneck. Result MUST say
causalConclusion NOT_ESTABLISHED until repeated independent randomized
runs and attribution markers justify a precise fix. No production Web,
Go, PWA or SW changes in this increment. PR stays Draft until its own
true specialty + full source-exact CI / Final Gate and fresh mergeability.

True physical iOS/Android/Installed OS lifecycle NOT RUN. Inaccessible
production-only safety acceptance SKIPPED (UNVERIFIED) by user decision
without blocking source/CI; Owner/ACL/permission/cancellation negatives
remain mandatory. Related #2260.
