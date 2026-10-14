package com.legalwhat.spectra.collector

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class SpectraAndroidCollectorTest {
    @Test
    fun reportingEndpointEncodesDeviceRefAndKeepsCanonicalPath() {
        val endpoint = SpectraAndroidCollector.reportingEndpoint(
            "https://legalwhat.com/",
            "android device/01",
        )
        assertEquals(
            "https://legalwhat.com/api/geoconsole/telemetry/enrolled/android%20device%2F01/normalize/android-radio-collector",
            endpoint.toString(),
        )
    }

    @Test
    fun reportingEndpointRejectsNonHttps() {
        assertThrows(IllegalArgumentException::class.java) {
            SpectraAndroidCollector.reportingEndpoint(
                "http://legalwhat.com",
                "android-device-a",
            )
        }
    }

    @Test
    fun reportingEndpointRejectsBlankDeviceRef() {
        assertThrows(IllegalArgumentException::class.java) {
            SpectraAndroidCollector.reportingEndpoint(
                "https://legalwhat.com",
                " ",
            )
        }
    }
}
