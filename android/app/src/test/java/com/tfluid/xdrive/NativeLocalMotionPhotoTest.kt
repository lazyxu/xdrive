package com.tfluid.xdrive

import org.junit.Assert.*
import org.junit.Test

/** Candidate metadata is not proof of an actual playable video frame. */
class NativeLocalMotionPhotoTest {
    private fun packet(
        enabled: String = "1",
        length: String = "2929880",
        mime: String = "video/mp4",
        semantic: String = "MotionPhoto",
    ) = """
        <x:xmpmeta xmlns:x="adobe:ns:meta/">
        <rdf:Description GCamera:MotionPhoto="$enabled" />
        <Container:Directory>
          <Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0"/>
          <Container:Item Item:Length="$length" Item:Semantic="$semantic"
             Item:Mime="$mime"/>
        </Container:Directory></x:xmpmeta>
        """.toByteArray(Charsets.UTF_8)

    @Test fun acceptsModernMotionXmpWithRealVideoLength() {
        assertTrue(nativeLocalMotionXmpCandidate(packet()))
        assertTrue(nativeLocalMotionXmpCandidate(packet(mime = "video/quicktime")))
        val prefixed = packet().toString(Charsets.UTF_8)
            .replace("Container:Item", "GContainer:Item").toByteArray(Charsets.UTF_8)
        assertTrue(nativeLocalMotionXmpCandidate(prefixed))
    }

    private fun legacyPacket(
        enabled: String = "1", offset: String = "248989",
        namespace: String = "GCamera",
    ): ByteArray = """
        <x:xmpmeta xmlns:x="adobe:ns:meta/">
          <rdf:Description ${namespace}:MicroVideoOffset="${offset}"
              ${namespace}:MicroVideo="${enabled}" />
        </x:xmpmeta>
    """.trimIndent().toByteArray(Charsets.UTF_8)

    @Test fun acceptsLegacyPixelMotionPhotoOnlyWithRealTrailingVideoBytes() {
        assertTrue(nativeLocalMotionXmpCandidate(legacyPacket()))
        assertTrue(nativeLocalMotionXmpCandidate(legacyPacket(namespace = "Camera")))
        assertTrue(nativeLocalMotionXmpCandidate(legacyPacket(offset = "1")))
        assertTrue(nativeLocalMotionXmpCandidate(
            legacyPacket(offset = (512L * 1024 * 1024).toString())))
        assertTrue(nativeLocalMotionXmpCandidate(
            ("<rdf:Description GCamera:MicroVideo='1' " +
                "GCamera:MicroVideoOffset='5115'/>").toByteArray()))
        // The existing modern Container format remains independently valid.
        assertTrue(nativeLocalMotionXmpCandidate(packet()))
    }

    @Test fun rejectsLegacyMissingDisabledOrAmbiguousVideoOffset() {
        assertFalse(nativeLocalMotionXmpCandidate(legacyPacket(enabled = "0")))
        assertFalse(nativeLocalMotionXmpCandidate(legacyPacket(offset = "0")))
        assertFalse(nativeLocalMotionXmpCandidate(legacyPacket(offset = "-15")))
        assertFalse(nativeLocalMotionXmpCandidate(legacyPacket(offset = "not-a-number")))
        assertFalse(nativeLocalMotionXmpCandidate(
            legacyPacket(offset = Long.MAX_VALUE.toString())))
        assertFalse(nativeLocalMotionXmpCandidate(
            legacyPacket(offset = (512L * 1024 * 1024 + 1).toString())))
        assertFalse(nativeLocalMotionXmpCandidate(
            "<rdf:Description GCamera:MicroVideo='1'/>".toByteArray()))
        assertFalse(nativeLocalMotionXmpCandidate(
            "<rdf:Description GCamera:MicroVideoOffset='100'/>".toByteArray()))
        assertFalse(nativeLocalMotionXmpCandidate(
            ("<rdf:Description GCamera:MicroVideo='1' " +
                "GCamera:MicroVideoOffset='100' " +
                "GCamera:MicroVideoOffset='200'/>").toByteArray()))
    }

    @Test fun rejectsDisabledMissingTruncatedAndNonVideoMetadata() {
        assertFalse(nativeLocalMotionXmpCandidate(null))
        assertFalse(nativeLocalMotionXmpCandidate(byteArrayOf()))
        assertFalse(nativeLocalMotionXmpCandidate(packet(enabled = "0")))
        assertFalse(nativeLocalMotionXmpCandidate(packet(length = "0")))
        assertFalse(nativeLocalMotionXmpCandidate(packet(length = "-1")))
        assertFalse(nativeLocalMotionXmpCandidate(packet(length = "not-a-length")))
        assertFalse(nativeLocalMotionXmpCandidate(packet(length = Long.MAX_VALUE.toString())))
        assertFalse(nativeLocalMotionXmpCandidate(packet(semantic = "Primary")))
        assertFalse(nativeLocalMotionXmpCandidate(packet(mime = "image/jpeg")))
        assertFalse(nativeLocalMotionXmpCandidate("normal still photo".toByteArray()))
        assertFalse(nativeLocalMotionXmpCandidate(ByteArray(256 * 1024 + 1)))
    }

    @Test fun localMotionPlaybackRequiresCurrentForegroundHoldReadyStillAndOneX() {
        assertTrue(nativeLocalMotionMayPlay(
            candidate = true, stillReady = true, held = true,
            foreground = true, atDefaultZoom = true,
        ))
        assertFalse(nativeLocalMotionMayPlay(false, true, true, true, true))
        assertFalse(nativeLocalMotionMayPlay(true, false, true, true, true))
        assertFalse(nativeLocalMotionMayPlay(true, true, false, true, true))
        assertFalse(nativeLocalMotionMayPlay(true, true, true, false, true))
        assertFalse(nativeLocalMotionMayPlay(true, true, true, true, false))
    }
}
