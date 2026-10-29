package com.tfluid.xdrive

/** Only the already-authorized current Gallery window can supply filmstrip tiles.
 * No token, URL, original bytes, or 100k-wide eager list is captured here. */
internal const val GALLERY_VIEWER_FILMSTRIP_MAX_TILES = 9

internal fun galleryViewerFilmstripWindow(loadedSize: Int, currentIndex: Int): IntRange {
    if (loadedSize <= 1 || currentIndex !in 0 until loadedSize) return IntRange.EMPTY
    val count = minOf(loadedSize, GALLERY_VIEWER_FILMSTRIP_MAX_TILES)
    val first = (currentIndex - count / 2).coerceIn(0, loadedSize - count)
    return first until first + count
}

/** Reject stale callbacks even if a later Owner reused identical Node IDs.
 * Membership is referential: a replaced list with equal-looking records is
 * NOT evidence that the old UI action still owns the current Viewer. */
internal fun <T : Any> galleryViewerFilmstripSelectionAllowed(
    current: T?, expectedCurrent: T, target: T,
    loaded: List<T>, currentSession: Boolean,
): Boolean = currentSession && current === expectedCurrent &&
    target !== expectedCurrent &&
    loaded.any { it === expectedCurrent } && loaded.any { it === target }
