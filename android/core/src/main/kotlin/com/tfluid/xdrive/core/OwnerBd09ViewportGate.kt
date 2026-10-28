package com.tfluid.xdrive.core

/** One unique read-only Owner BD09 viewport request, tied to the current
 * in-memory session epoch and camera motion. Not a JWT or a Server grant. */
internal data class Bd09ViewportPermit(
    val bounds: OwnerBd09Bounds,
    val sessionEpoch: Long,
    val motionEpoch: Long,
    val requestId: Long,
)

internal sealed interface Bd09ViewportDecision {
    data class Fetch(val permit: Bd09ViewportPermit) : Bd09ViewportDecision
    data class Cached(
        val bounds: OwnerBd09Bounds,
        val cells: OwnerBd09MapCells,
    ) : Bd09ViewportDecision
}

/** Deterministic client-side throttle for the existing authenticated Go
 * /media/places/baidu-jsapi/cells read. It does NOT convert WGS84, provide
 * provider keys, mint authority, or schedule a background transfer.
 *
 * Callers must supply monotonic elapsed milliseconds (elapsedRealtime,
 * never wall-clock time) and must replace/clear this object on Owner logout.
 * 500ms idle, one request/1000ms and at most one in flight, with latest
 * viewport winning. Failure blocks same-viewport auto-retries. Cached
 * 64-cell summaries never persist or cross Owner sessions.
 */
internal class OwnerBd09ViewportGate(
    private val idleMillis: Long = 500L,
    private val startIntervalMillis: Long = 1_000L,
    private val maxCacheEntries: Int = 32,
) {
    init {
        require(idleMillis >= 500L && startIntervalMillis >= 1_000L)
        require(maxCacheEntries in 1..32)
    }
    private val cache = object :
        LinkedHashMap<OwnerBd09Bounds, OwnerBd09MapCells>(maxCacheEntries, 0.75f, true) {
        override fun removeEldestEntry(
            eldest: MutableMap.MutableEntry<OwnerBd09Bounds, OwnerBd09MapCells>,
        ): Boolean = size > maxCacheEntries
    }
    private var sessionEpoch = 0L
    private var motionEpoch = 0L
    private var requestId = 0L
    private var viewport: OwnerBd09Bounds? = null
    private var lastMotionMillis: Long? = null
    private var lastStartMillis: Long? = null
    private var inFlight: Bd09ViewportPermit? = null
    private var blockedAfterFailure: OwnerBd09Bounds? = null
    private var delivered = false

    /** Latest BD09 camera rectangle wins. Invalid coordinates cannot be
     * used to render or dispatch the previous viewport by accident. */
    @Synchronized
    fun moved(bounds: OwnerBd09Bounds, elapsedMillis: Long): Boolean {
        require(elapsedMillis >= 0L) { "Monotonic timestamp required" }
        motionEpoch++
        lastMotionMillis = elapsedMillis
        delivered = false
        if (!bounds.valid()) {
            viewport = null
            blockedAfterFailure = null
            return false
        }
        viewport = bounds
        if (blockedAfterFailure != bounds) blockedAfterFailure = null
        return true
    }

    /** Called from the real SDK adapter after camera stops; it only returns
     * permission to call XDriveService, never issues an HTTP request itself. */
    @Synchronized
    fun poll(elapsedMillis: Long): Bd09ViewportDecision? {
        if (elapsedMillis < 0L || delivered || inFlight != null) return null
        val bounds = viewport ?: return null
        val movedAt = lastMotionMillis ?: return null
        if (elapsedMillis < movedAt ||
            elapsedMillis - movedAt < idleMillis ||
            blockedAfterFailure == bounds) return null
        cache[bounds]?.let {
            delivered = true
            return Bd09ViewportDecision.Cached(bounds, it)
        }
        val lastStart = lastStartMillis
        if (lastStart != null && (elapsedMillis < lastStart ||
            elapsedMillis - lastStart < startIntervalMillis)) return null
        val permit = Bd09ViewportPermit(bounds, sessionEpoch, motionEpoch, ++requestId)
        inFlight = permit
        lastStartMillis = elapsedMillis
        return Bd09ViewportDecision.Fetch(permit)
    }

    /** True only for the exact session AND latest camera motion. An obsolete
     * non-cooperative response must not be cached or painted. */
    @Synchronized
    fun succeeded(permit: Bd09ViewportPermit, cells: OwnerBd09MapCells): Boolean {
        if (inFlight != permit || permit.sessionEpoch != sessionEpoch) return false
        inFlight = null
        if (viewport != permit.bounds || motionEpoch != permit.motionEpoch) return false
        if (!validCellSnapshot(permit.bounds, cells)) {
            // An invalid Owner response is a failed read, not a new permit to
            // issue the same GET every frame until rate limits are exhausted.
            blockedAfterFailure = permit.bounds
            return false
        }
        cache[permit.bounds] = cells
        delivered = true
        return true
    }

    /** Never auto-retry a failed current viewport on each frame. User retry
     * or a genuinely new viewport may opt in to another one-shot read. */
    @Synchronized
    fun failed(permit: Bd09ViewportPermit): Boolean {
        if (inFlight != permit || permit.sessionEpoch != sessionEpoch) return false
        inFlight = null
        if (viewport == permit.bounds && motionEpoch == permit.motionEpoch) {
            blockedAfterFailure = permit.bounds
            return true
        }
        return false
    }

    @Synchronized
    fun retryAfterFailure(elapsedMillis: Long): Boolean {
        if (elapsedMillis < 0L || inFlight != null || viewport == null ||
            blockedAfterFailure != viewport) return false
        blockedAfterFailure = null
        lastMotionMillis = elapsedMillis
        delivered = false
        motionEpoch++
        return true
    }

    /** Called on Owner/server change or map-session shutdown. Rejects old
     * tickets even if the same Owner logs back in (A→B→A). */
    @Synchronized
    fun clearSession() {
        sessionEpoch++
        motionEpoch++
        viewport = null
        lastMotionMillis = null
        lastStartMillis = null
        inFlight = null
        blockedAfterFailure = null
        delivered = false
        cache.clear()
    }

    @Synchronized
    fun cachedCount(): Int = cache.size

    private fun validCellSnapshot(
        bounds: OwnerBd09Bounds, value: OwnerBd09MapCells,
    ): Boolean {
        val cells = value.cells
        if (value.totalPhotoCount < 0L || cells.size > 64 ||
            (cells.isEmpty() != (value.totalPhotoCount == 0L))) return false
        if (cells.map { it.cellX to it.cellY }.toSet().size != cells.size) return false
        var total = 0L
        for (cell in cells) {
            if (cell.cellX !in 0..7 || cell.cellY !in 0..7 ||
                cell.photoCount <= 0L || cell.assetId <= 0L || cell.nodeId <= 0L ||
                cell.nodeRevision <= 0L ||
                !bounds.contains(cell.latitude, cell.longitude) ||
                total > value.totalPhotoCount - cell.photoCount) return false
            total += cell.photoCount
        }
        return total == value.totalPhotoCount
    }
}
