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
}
