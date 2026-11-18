package team.datacraft.dtclient.data

import android.util.Log
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import org.json.JSONObject

// code is the panel's error code (bad_login, device_limit, ...) or network / bad_response.
class ApiException(val code: String, val status: Int = 0) : Exception(code)

data class DeviceInfo(val deviceId: String, val deviceName: String, val os: String, val osVersion: String, val appVersion: String)

object Api {
    // The app API answers under the subscription link itself, on any of its paths.
    fun base(subLink: String): String {
        val uri = runCatching { URI(subLink.trim()) }.getOrNull() ?: throw ApiException("bad_link")
        val scheme = uri.scheme?.lowercase()
        if (scheme != "https" && scheme != "http") throw ApiException("bad_link")
        val path = (uri.rawPath ?: "").trimEnd('/')
        if (path.split('/').none { it.isNotEmpty() } || uri.rawAuthority.isNullOrEmpty()) throw ApiException("bad_link")
        return "$scheme://${uri.rawAuthority}$path/app/v1"
    }

    private fun call(url: String, method: String, userAgent: String, headers: Map<String, String> = emptyMap(), body: String? = null): JSONObject {
        val conn = try {
            (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 15_000
                readTimeout = 15_000
                setRequestProperty("User-Agent", userAgent)
                setRequestProperty("Accept", "application/json")
                headers.forEach { (k, v) -> setRequestProperty(k, v) }
                if (body != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    outputStream.use { it.write(body.toByteArray()) }
                }
            }
        } catch (e: Exception) {
            Log.w("DtApi", "$method ${url.substringAfterLast('/')}: $e")
            throw ApiException("network")
        }
        try {
            val status = try {
                conn.responseCode
            } catch (e: Exception) {
                Log.w("DtApi", "$method ${url.substringAfterLast('/')}: $e")
                throw ApiException("network")
            }
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            val json = runCatching { JSONObject(text) }.getOrNull()
            if (status !in 200..299) {
                val code = json?.optString("error")?.takeIf { it.isNotEmpty() } ?: if (status == 404) "not_found" else "bad_response"
                throw ApiException(code, status)
            }
            return json ?: throw ApiException("bad_response", status)
        } finally {
            conn.disconnect()
        }
    }

    fun login(base: String, username: String, device: DeviceInfo, userAgent: String): String {
        val body = JSONObject()
            .put("username", username)
            .put("deviceId", device.deviceId)
            .put("deviceName", device.deviceName)
            .put("os", device.os)
            .put("osVersion", device.osVersion)
            .put("appVersion", device.appVersion)
        val token = call("$base/login", "POST", userAgent, body = body.toString()).optString("token")
        if (token.isEmpty()) throw ApiException("bad_response", 200)
        return token
    }

    fun profile(base: String, token: String, deviceId: String, userAgent: String): Profile {
        val json = call("$base/profile", "GET", userAgent, mapOf("Authorization" to "Bearer $token", "X-HWID" to deviceId))
        if (!json.has("account") || !json.has("configs")) throw ApiException("bad_response", 200)
        return Profile.parse(json.toString())
    }

    fun logout(base: String, token: String, deviceId: String, userAgent: String) {
        call("$base/logout", "POST", userAgent, mapOf("Authorization" to "Bearer $token", "X-HWID" to deviceId), "{}")
    }
}
