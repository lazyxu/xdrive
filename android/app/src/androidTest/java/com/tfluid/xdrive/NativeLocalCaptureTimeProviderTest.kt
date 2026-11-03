package com.tfluid.xdrive

import android.content.ContentValues
import android.graphics.Bitmap
import android.net.Uri
import android.os.CancellationSignal
import android.os.Environment
import android.provider.MediaStore
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Actual Android MediaProvider SQL acceptance, not a mocked Cursor.
 * Photos are created by this test in an isolated directory and deleted in finally.
 * No photos outside the test directory are opened, decoded or modified.
 */
@RunWith(AndroidJUnit4::class)
class NativeLocalCaptureTimeProviderTest {
    @Test fun actualProviderAcceptsCaptureTimeKeysetAndUnknownTimestamp() = runBlocking {
        val resolver = InstrumentationRegistry.getInstrumentation()
            .targetContext.contentResolver
        val collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val folder = Environment.DIRECTORY_PICTURES +
            "/xdrive-capture-time-test-" + System.nanoTime() + "/"
        val created = mutableListOf<Uri>()
        try {
            repeat(2) { index ->
                val pending = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, "capture-$index.jpg")
                    put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
                    put(MediaStore.MediaColumns.RELATIVE_PATH, folder)
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val uri = requireNotNull(resolver.insert(collection, pending))
                created += uri
                requireNotNull(resolver.openOutputStream(uri)).use { stream ->
                    val bitmap = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888)
                    try {
                        assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG, 90, stream))
                    } finally {
                        bitmap.recycle()
                    }
                }
                val publish = ContentValues().apply {
                    put(MediaStore.MediaColumns.IS_PENDING, 0)
                }
                assertEquals(1, resolver.update(uri, publish, null, null))
            }

            val bucketId = resolver.query(
                created.first(), arrayOf(MediaStore.Images.ImageColumns.BUCKET_ID),
                null, null, null,
            )?.use { cursor ->
                require(cursor.moveToFirst())
                cursor.getString(0)
            }
            require(!bucketId.isNullOrBlank())

            // This exercises the actual CASE expression in both SQL selection
            // and sort order. A provider that rejects it fails the Android job.
            val signal = CancellationSignal()
            val first = NativeLocalMediaStore.pageAfter(
                resolver, limit = 1, albumId = bucketId,
                cancellationSignal = signal)
            assertEquals(1, first.size)
            val second = NativeLocalMediaStore.pageAfter(
                resolver, after = first.single().pageKey, limit = 1,
                albumId = bucketId, cancellationSignal = signal)
            assertEquals(1, second.size)
            assertTrue(first.single().id != second.single().id)
            assertTrue(nativeLocalStrictPageOrder(first.single().pageKey,
                listOf(second.single().pageKey)))
            // A bounded two-row read must match the two independent keyset
            // pages even when the real MediaProvider has unknown timestamps.
            val combined = NativeLocalMediaStore.pageAfter(
                resolver, limit = 2, albumId = bucketId,
                cancellationSignal = signal)
            assertEquals(listOf(first.single().pageKey, second.single().pageKey),
                combined.map { it.pageKey })
            val third = NativeLocalMediaStore.pageAfter(
                resolver, after = second.single().pageKey, limit = 1,
                albumId = bucketId, cancellationSignal = signal)
            assertTrue(third.isEmpty())
        } finally {
            created.forEach { uri -> runCatching { resolver.delete(uri, null, null) } }
        }
    }
}
