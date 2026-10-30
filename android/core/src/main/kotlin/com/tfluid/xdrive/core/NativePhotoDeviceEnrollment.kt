package com.tfluid.xdrive.core

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/** One explicitly initiated registration after live Owner + Root proof. */
object NativePhotoDeviceEnrollment {
    suspend fun register(
        service: XDriveService,
        origin: String,
        accessToken: String,
        expectedUsername: String,
        deviceName: String,
        clientVersion: String,
        currentSession: () -> Boolean,
    ): Pair<NativePhotoBackupScope, NativeAndroidDeviceEnrollment> {
        // This step is NOT a background retry path. Owner changes after the
        // request must not publish a credential to another login session.
        val owner = NativePhotoOwnerPreflight.verify(
            service, origin, accessToken, expectedUsername, currentSession)
        currentCoroutineContext().ensureActive()
        check(currentSession()) { "Android device Owner session changed" }
        val device = service.registerNativeAndroidDevice(
            accessToken, deviceName, clientVersion)
        currentCoroutineContext().ensureActive()
        check(currentSession()) { "Android device Owner session changed after POST" }
        return owner to device
    }
}
