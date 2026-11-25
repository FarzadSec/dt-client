package team.datacraft.dtclient.vpn

import android.net.TrafficStats
import android.os.Process
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.Socket
import java.net.URL
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

// Google's empty page, the one the panel's outbound test fetches.
const val TEST_URL = "https://www.google.com/generate_204"

// The test page through a local SOCKS port (Xray's) or the phone's own routes: any HTTP answer counts.
// Android keeps the connection alive between calls, so after the first (cold) request the next ones
// time a single round trip through the tunnel: the live ping.
class HttpProbe(private val socksPort: Int?) {
    fun once(timeoutMs: Int): Int? = runCatching {
        val proxy = socksPort?.let { Proxy(Proxy.Type.SOCKS, InetSocketAddress("127.0.0.1", it)) } ?: Proxy.NO_PROXY
        val conn = URL(TEST_URL).openConnection(proxy) as HttpURLConnection
        conn.connectTimeout = timeoutMs
        conn.readTimeout = timeoutMs
        conn.useCaches = false
        conn.instanceFollowRedirects = false
        val started = System.nanoTime()
        val code = conn.responseCode
        // Read to the end, so the connection goes back to the pool for the next request.
        (if (code < 400) conn.inputStream else conn.errorStream)?.use { it.readBytes() }
        if (code <= 0) null else ((System.nanoTime() - started) / 1_000_000).toInt().coerceAtLeast(1)
    }.getOrNull()

    // A cold request, then the warm one's time (the cold one's when it fails); null when none answered.
    fun measure(timeoutMs: Int): Int? {
        val cold = once(timeoutMs) ?: return null
        return once(timeoutMs) ?: cold
    }
}

// The bytes the app has moved since it started: the engines run in its process (Xray) or as its child
// (OpenVPN), so this is the tunnel's traffic.
object Traffic {
    fun totals(): Pair<Long, Long>? {
        val uid = Process.myUid()
        val rx = TrafficStats.getUidRxBytes(uid)
        val tx = TrafficStats.getUidTxBytes(uid)
        return if (rx < 0 || tx < 0) null else rx to tx
    }
}

// OpenVPN's real delay: the server's own answer to the first message of its handshake (wrapped as the
// profile says: none, tls-auth, tls-crypt, tls-crypt-v2), the same probe the desktop app sends. Behind a
// relay the answer comes from the server itself, so the time is the whole way.
object OpenVpnProbe {
    private const val HARD_RESET_CLIENT_V2 = 7
    private const val HARD_RESET_SERVER_V2 = 8
    private const val HARD_RESET_CLIENT_V3 = 10
    private val firstMessage = byteArrayOf(0, 0, 0, 0, 0)
    private val random = SecureRandom()

    class Target(val host: String, val port: Int, val udp: Boolean, val packet: ByteArray)

    fun staticKey(text: String): ByteArray? {
        val body = Regex("-----BEGIN OpenVPN Static key V1-----([\\s\\S]*?)-----END OpenVPN Static key V1-----").find(text)?.groupValues?.get(1) ?: return null
        val hex = body.filter { it.isDigit() || it.lowercaseChar() in 'a'..'f' }
        if (hex.length != 512) return null
        return ByteArray(256) { i -> hex.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
    }

    private fun block(profile: String, name: String): String? =
        Regex("<$name>([\\s\\S]*?)</$name>", RegexOption.IGNORE_CASE).find(profile)?.groupValues?.get(1)

    private fun directive(profile: String, name: String): List<String>? =
        Regex("^[ \\t]*$name(?:[ \\t]+([^\\r\\n]*))?$", setOf(RegexOption.MULTILINE, RegexOption.IGNORE_CASE)).find(profile)
            ?.let { m -> m.groupValues[1].trim().split(Regex("\\s+")).filter { it.isNotEmpty() } }

    // The client sends with the second key of the file (key direction 1), as tls-crypt always does.
    private fun part(key: ByteArray, index: Int, hmac: Boolean, length: Int): ByteArray {
        val base = index * 128 + if (hmac) 64 else 0
        return key.copyOfRange(base, base + length)
    }

    private fun header(opcode: Int, sid: ByteArray): ByteArray = byteArrayOf((opcode shl 3).toByte()) + sid

    private fun replayId(now: Long): ByteArray {
        val t = (now / 1000).toInt()
        return byteArrayOf(0, 0, 0, 1, (t ushr 24).toByte(), (t ushr 16).toByte(), (t ushr 8).toByte(), t.toByte())
    }

    fun tlsCryptWrap(key: ByteArray, opcode: Int, sid: ByteArray, now: Long = System.currentTimeMillis()): ByteArray {
        val head = header(opcode, sid) + replayId(now)
        val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(part(key, 1, true, 32), "HmacSHA256")) }
        mac.update(head)
        mac.update(firstMessage)
        val tag = mac.doFinal()
        val cipher = Cipher.getInstance("AES/CTR/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(part(key, 1, false, 32), "AES"), IvParameterSpec(tag.copyOfRange(0, 16)))
        return head + tag + cipher.doFinal(firstMessage)
    }

    private val digests = mapOf("sha1" to ("HmacSHA1" to 20), "sha256" to ("HmacSHA256" to 32), "sha384" to ("HmacSHA384" to 48), "sha512" to ("HmacSHA512" to 64), "md5" to ("HmacMD5" to 16))

    fun tlsAuthWrap(key: ByteArray, direction: Int?, digest: String, opcode: Int, sid: ByteArray, now: Long = System.currentTimeMillis()): ByteArray {
        val (alg, size) = digests[digest.lowercase().replace("-", "")] ?: ("HmacSHA1" to 20)
        val head = header(opcode, sid)
        val replay = replayId(now)
        val mac = Mac.getInstance(alg).apply { init(SecretKeySpec(part(key, if (direction == 1) 1 else 0, true, size), alg)) }
        mac.update(replay)
        mac.update(head)
        mac.update(firstMessage)
        return head + mac.doFinal() + replay + firstMessage
    }

    fun target(profile: String): Target? {
        val remote = Regex("^[ \\t]*remote[ \\t]+(\\S+)(?:[ \\t]+(\\d+))?(?:[ \\t]+(\\S+))?", RegexOption.MULTILINE).find(profile) ?: return null
        val port = remote.groupValues[2].toIntOrNull() ?: directive(profile, "port")?.firstOrNull()?.toIntOrNull() ?: 1194
        val proto = remote.groupValues[3].ifEmpty { directive(profile, "proto")?.firstOrNull() ?: "udp" }.lowercase()
        val sid = ByteArray(8).also { random.nextBytes(it) }
        val v2 = block(profile, "tls-crypt-v2")
        val crypt = block(profile, "tls-crypt")
        val auth = block(profile, "tls-auth")
        val packet = when {
            v2 != null -> {
                val b64 = Regex("-----BEGIN OpenVPN tls-crypt-v2 client key-----([\\s\\S]*?)-----END OpenVPN tls-crypt-v2 client key-----").find(v2)?.groupValues?.get(1) ?: return null
                val raw = runCatching { android.util.Base64.decode(b64.filterNot { it.isWhitespace() }, android.util.Base64.DEFAULT) }.getOrNull() ?: return null
                if (raw.size <= 256) return null
                tlsCryptWrap(raw.copyOfRange(0, 256), HARD_RESET_CLIENT_V3, sid) + raw.copyOfRange(256, raw.size)
            }
            crypt != null -> tlsCryptWrap(staticKey(crypt) ?: return null, HARD_RESET_CLIENT_V2, sid)
            auth != null -> {
                val dir = directive(profile, "key-direction")?.firstOrNull()?.toIntOrNull()
                tlsAuthWrap(staticKey(auth) ?: return null, dir, directive(profile, "auth")?.firstOrNull() ?: "SHA1", HARD_RESET_CLIENT_V2, sid)
            }
            else -> header(HARD_RESET_CLIENT_V2, sid) + firstMessage
        }
        return Target(remote.groupValues[1].trim('[', ']'), port, proto.startsWith("udp"), packet)
    }

    private fun isServerReset(p: ByteArray, n: Int): Boolean = n > 9 && (p[0].toInt() and 0xff) ushr 3 == HARD_RESET_SERVER_V2

    // The time to the server's answer in ms, or null. A UDP message is sent again once, a lost one being common.
    fun handshakeMs(target: Target, timeoutMs: Int = 5000, protect: ((DatagramSocket) -> Unit)? = null, protectTcp: ((Socket) -> Unit)? = null): Int? = runCatching {
        val address = InetAddress.getByName(target.host)
        if (target.udp) {
            DatagramSocket().use { socket ->
                protect?.invoke(socket)
                socket.connect(address, target.port)
                val buf = ByteArray(2048)
                for (attempt in 0..1) {
                    val started = System.nanoTime()
                    socket.send(DatagramPacket(target.packet, target.packet.size))
                    socket.soTimeout = if (attempt == 0) minOf(2000, timeoutMs / 2) else timeoutMs / 2
                    val deadline = started + socket.soTimeout * 1_000_000L
                    while (System.nanoTime() < deadline) {
                        val reply = DatagramPacket(buf, buf.size)
                        try {
                            socket.receive(reply)
                        } catch (e: java.net.SocketTimeoutException) {
                            break
                        }
                        if (isServerReset(buf, reply.length)) return@runCatching ((System.nanoTime() - started) / 1_000_000).toInt().coerceAtLeast(1)
                    }
                }
                null
            }
        } else {
            Socket().use { socket ->
                protectTcp?.invoke(socket)
                socket.connect(InetSocketAddress(address, target.port), timeoutMs)
                socket.soTimeout = timeoutMs
                val out = ByteArrayOutputStream()
                out.write(target.packet.size ushr 8)
                out.write(target.packet.size and 0xff)
                out.write(target.packet)
                val started = System.nanoTime()
                socket.getOutputStream().apply { write(out.toByteArray()); flush() }
                val input = DataInputStream(socket.getInputStream())
                val size = input.readUnsignedShort()
                val reply = ByteArray(size)
                input.readFully(reply)
                if (isServerReset(reply, reply.size)) ((System.nanoTime() - started) / 1_000_000).toInt().coerceAtLeast(1) else null
            }
        }
    }.getOrNull()
}
