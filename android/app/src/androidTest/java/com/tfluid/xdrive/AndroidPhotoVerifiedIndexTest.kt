package com.tfluid.xdrive

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import com.tfluid.xdrive.core.ServerAddress
import org.junit.After
import org.junit.Assert.*
import org.junit.Test

/** Real Android SQLite transactions, not an in-memory hashmap. */
class AndroidPhotoVerifiedIndexTest {
    private val context: Context =
        InstrumentationRegistry.getInstrumentation().targetContext
    private val name = "test-native-photo-verified-" + System.nanoTime() + ".db"
    private val owner = NativePhotoBackupOwner(
        ServerAddress.parse("https://drive.example").url,
        "server-installation-1", 51L, "owner", 1L, 3L, "android-device-1",
    )
    private val key = "a".repeat(64)
    private val version = "b".repeat(64)
    private val hash = "c".repeat(64)
    private val uuid = "00000000-0000-4000-8000-000000000092"

    private fun index(max: Int = 250_000) =
        AndroidPhotoVerifiedIndex(context, name, maxRows = max)

    private fun intent(
        ownerScope: NativePhotoBackupOwner = owner, asset: String = key,
        versionKey: String = version, checksum: String = hash,
        nodeId: Long = 42L,
    ) = NativePhotoBackupIntent(
        id = uuid, owner = ownerScope, assetKey = asset,
        versionKey = versionKey, resource = NativePhotoBackupResource.STILL,
        originalSha256 = checksum, sizeBytes = 4096L,
        phase = NativePhotoBackupPhase.VERIFIED,
        createdAtMillis = 1_800_000_000_000L,
        verifiedNodeId = nodeId, verifiedNodeRevision = 7L,
    )

    @After fun cleanup() { context.deleteDatabase(name) }

    @Test fun indexedVerifiedReceiptSurvivesRestartAndScopesOwnerDevice(): Unit {
        index().use { first ->
            first.recordVerified(intent())
            assertEquals(1L, first.totalIndexed())
        }
        index().use { reloaded ->
            assertEquals(NativePhotoIndexedReceipt(42, 7),
                reloaded.findVerified(
                    owner.copy(rootRevision = 300), key, version,
                    NativePhotoBackupResource.STILL, hash, 4096L))
            assertNull(reloaded.findVerified(
                owner.copy(ownerId = 99L), key, version,
                NativePhotoBackupResource.STILL, hash, 4096L))
            assertNull(reloaded.findVerified(
                owner.copy(instanceId = "second-install"), key, version,
                NativePhotoBackupResource.STILL, hash, 4096L))
            assertNull(reloaded.findVerified(
                owner.copy(deviceId = "second-device"), key, version,
                NativePhotoBackupResource.STILL, hash, 4096L))
            assertEquals(1L, reloaded.totalIndexed())
        }
    }

    @Test fun unknownAttemptCannotBecomeCompletedAndDifferentVersionRequiresReceipt(): Unit {
        index().use { db ->
            val verified = intent()
            val mayHaveSent = verified.copy(
                phase = NativePhotoBackupPhase.MAY_HAVE_SENT,
                verifiedNodeId = null, verifiedNodeRevision = null)
            assertThrows(IllegalArgumentException::class.java) {
                db.recordVerified(mayHaveSent)
            }
            assertEquals(0L, db.totalIndexed())
            db.recordVerified(verified)
            db.recordVerified(verified)
            assertEquals(1L, db.totalIndexed())
            assertNull(db.findVerified(
                owner, key, "d".repeat(64),
                NativePhotoBackupResource.STILL, hash, 4096L))
            assertNull(db.findVerified(
                owner, key, version,
                NativePhotoBackupResource.MOTION_STILL, hash, 4096L))
            db.recordVerified(verified.copy(
                versionKey = "d".repeat(64), originalSha256 = "e".repeat(64),
                verifiedNodeId = 55L))
            assertEquals(1L, db.totalIndexed())
            assertEquals(NativePhotoIndexedReceipt(55, 7),
                db.findVerified(owner, key, "d".repeat(64),
                    NativePhotoBackupResource.STILL, "e".repeat(64), 4096L))
            assertNull(db.findVerified(owner, key, version,
                NativePhotoBackupResource.STILL, hash, 4096L))
        }
    }

    @Test fun exhaustedQuotaDoesNotDropOtherOwnersOrUnknownRecords(): Unit {
        index(max = 2).use { db ->
            db.recordVerified(intent())
            db.recordVerified(intent(asset = "f".repeat(64), nodeId = 99))
            assertEquals(2L, db.totalIndexed())
            assertThrows(IllegalStateException::class.java) {
                db.recordVerified(intent(asset = "1".repeat(64), nodeId = 100))
            }
            assertEquals(2L, db.totalIndexed())
            assertEquals(NativePhotoIndexedReceipt(42, 7),
                db.findVerified(owner, key, version,
                    NativePhotoBackupResource.STILL, hash, 4096L))
        }
    }
}
