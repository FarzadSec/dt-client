package team.datacraft.dtclient.vpn

// The lock's packets, read and written by hand: an IPv4/UDP DNS query that reached the lock's tunnel,
// the answer that blocks a name (0.0.0.0 or ::), and an upstream answer sent back to the asking app.
object GuardPacket {
    class Query(
        val src: ByteArray,
        val srcPort: Int,
        val dst: ByteArray,
        val dstPort: Int,
        // The DNS message itself (the UDP payload).
        val dns: ByteArray,
        val name: String,
        val type: Int,
    )

    private fun u16(b: ByteArray, at: Int): Int = ((b[at].toInt() and 0xff) shl 8) or (b[at + 1].toInt() and 0xff)

    fun parse(packet: ByteArray, length: Int): Query? {
        if (length < 28 || (packet[0].toInt() ushr 4) != 4) return null
        val ihl = (packet[0].toInt() and 0x0f) * 4
        if (ihl < 20 || length < ihl + 8 || (packet[9].toInt() and 0xff) != 17) return null
        val total = minOf(length, u16(packet, 2))
        val dstPort = u16(packet, ihl + 2)
        if (dstPort != 53) return null
        val dns = packet.copyOfRange(ihl + 8, total)
        if (dns.size < 12 || (dns[2].toInt() and 0x80) != 0 || u16(dns, 4) < 1) return null
        val labels = mutableListOf<String>()
        var at = 12
        while (at < dns.size) {
            val len = dns[at].toInt() and 0xff
            if (len == 0) break
            if (len > 63 || at + 1 + len > dns.size) return null
            labels += String(dns, at + 1, len, Charsets.US_ASCII)
            at += 1 + len
        }
        if (at + 5 > dns.size) return null
        val type = u16(dns, at + 1)
        return Query(packet.copyOfRange(12, 16), u16(packet, ihl), packet.copyOfRange(16, 20), dstPort, dns, labels.joinToString(".").lowercase(), type)
    }

    // name is one of the sites, or under one of them.
    fun locked(name: String, sites: Collection<String>): String? = sites.firstOrNull { name == it || name.endsWith(".$it") }

    // The question echoed with one answer that points nowhere (A 0.0.0.0, AAAA ::), so the app fails at once;
    // other types get "no such name".
    fun blockedAnswer(q: Query): ByteArray {
        val dns = q.dns
        var at = 12
        while (at < dns.size && dns[at].toInt() != 0) at += 1 + (dns[at].toInt() and 0xff)
        val questionEnd = minOf(dns.size, at + 5)
        val out = java.io.ByteArrayOutputStream()
        out.write(dns, 0, 2) // id
        val answerData = when (q.type) {
            1 -> ByteArray(4)
            28 -> ByteArray(16)
            else -> null
        }
        out.write(0x80 or (dns[2].toInt() and 0x01)) // response; recursion desired as the question asked
        out.write(if (answerData == null) 0x83 else 0x80) // recursion available; NXDOMAIN for other types
        out.write(byteArrayOf(0, 1, 0, if (answerData == null) 0 else 1, 0, 0, 0, 0))
        out.write(dns, 12, questionEnd - 12)
        if (answerData != null) {
            out.write(byteArrayOf(0xc0.toByte(), 12)) // the name: a pointer to the question's
            out.write(byteArrayOf(0, q.type.toByte(), 0, 1, 0, 0, 0, 30, 0, answerData.size.toByte()))
            out.write(answerData)
        }
        return reply(q, out.toByteArray())
    }

    // An answer from the tunnel's DNS address back to the app's port.
    fun reply(q: Query, dns: ByteArray): ByteArray = ipv4Udp(q.dst, q.dstPort, q.src, q.srcPort, dns)

    fun ipv4Udp(src: ByteArray, srcPort: Int, dst: ByteArray, dstPort: Int, payload: ByteArray): ByteArray {
        val total = 20 + 8 + payload.size
        val p = ByteArray(total)
        p[0] = 0x45
        p[2] = (total ushr 8).toByte()
        p[3] = total.toByte()
        p[8] = 64 // TTL
        p[9] = 17 // UDP
        src.copyInto(p, 12)
        dst.copyInto(p, 16)
        var sum = 0
        for (i in 0 until 20 step 2) sum += u16(p, i)
        while (sum ushr 16 != 0) sum = (sum and 0xffff) + (sum ushr 16)
        val check = sum.inv() and 0xffff
        p[10] = (check ushr 8).toByte()
        p[11] = check.toByte()
        p[20] = (srcPort ushr 8).toByte()
        p[21] = srcPort.toByte()
        p[22] = (dstPort ushr 8).toByte()
        p[23] = dstPort.toByte()
        val udpLen = 8 + payload.size
        p[24] = (udpLen ushr 8).toByte()
        p[25] = udpLen.toByte()
        // UDP checksum 0: none, which IPv4 allows.
        payload.copyInto(p, 28)
        return p
    }
}
