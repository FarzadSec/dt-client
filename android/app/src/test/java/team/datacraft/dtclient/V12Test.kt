package team.datacraft.dtclient

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import team.datacraft.dtclient.data.Account
import team.datacraft.dtclient.data.AccountEntry
import team.datacraft.dtclient.ui.planWarnings
import team.datacraft.dtclient.ui.siteName
import team.datacraft.dtclient.vpn.GuardPacket
import team.datacraft.dtclient.vpn.OpenVpnProbe

class V12Test {
    private val key = "-----BEGIN OpenVPN Static key V1-----\n" +
        (0 until 16).joinToString("\n") { i -> "%02x".format(i).repeat(16) } + "\n-----END OpenVPN Static key V1-----"

    // An IPv4/UDP DNS query for name, type A, from 10.0.0.5:40000 to 10.111.222.1:53.
    private fun query(name: String, type: Int = 1): ByteArray {
        val dns = java.io.ByteArrayOutputStream()
        dns.write(byteArrayOf(0x12, 0x34, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0))
        for (label in name.split('.')) {
            dns.write(label.length)
            dns.write(label.toByteArray())
        }
        dns.write(byteArrayOf(0, 0, type.toByte(), 0, 1))
        return GuardPacket.ipv4Udp(byteArrayOf(10, 0, 0, 5), 40000, byteArrayOf(10, 111, 222.toByte(), 1), 53, dns.toByteArray())
    }

    @Test
    fun readsADnsQueryAndBlocksIt() {
        val packet = query("www.Binance.com")
        val q = GuardPacket.parse(packet, packet.size)!!
        assertEquals("www.binance.com", q.name)
        assertEquals(1, q.type)
        assertEquals(40000, q.srcPort)
        assertEquals("binance.com", GuardPacket.locked(q.name, listOf("binance.com")))
        assertNull(GuardPacket.locked("notbinance.com", listOf("binance.com")))
        val answer = GuardPacket.blockedAnswer(q)
        // Back to the asking app's address and port, from the lock's DNS address.
        assertArrayEquals(byteArrayOf(10, 111, 222.toByte(), 1), answer.copyOfRange(12, 16))
        assertArrayEquals(byteArrayOf(10, 0, 0, 5), answer.copyOfRange(16, 20))
        assertEquals(40000, ((answer[22].toInt() and 0xff) shl 8) or (answer[23].toInt() and 0xff))
        val dns = answer.copyOfRange(28, answer.size)
        assertEquals(0x12, dns[0].toInt())
        assertEquals(0x81, dns[2].toInt() and 0xff)
        assertEquals(1, dns[7].toInt()) // one answer
        assertArrayEquals(ByteArray(4), dns.copyOfRange(dns.size - 4, dns.size)) // 0.0.0.0
        // The header checksum adds up.
        var sum = 0
        for (i in 0 until 20 step 2) sum += ((answer[i].toInt() and 0xff) shl 8) or (answer[i + 1].toInt() and 0xff)
        while (sum ushr 16 != 0) sum = (sum and 0xffff) + (sum ushr 16)
        assertEquals(0xffff, sum)
    }

    @Test
    fun answersOtherTypesWithNoSuchName() {
        val packet = query("binance.com", 65)
        val dns = GuardPacket.blockedAnswer(GuardPacket.parse(packet, packet.size)!!).let { it.copyOfRange(28, it.size) }
        assertEquals(3, dns[3].toInt() and 0x0f)
        assertEquals(0, dns[7].toInt())
    }

    @Test
    fun ignoresWhatIsNotADnsQuery() {
        val packet = query("a.com")
        packet[9] = 6 // TCP
        assertNull(GuardPacket.parse(packet, packet.size))
    }

    @Test
    fun wrapsTheFirstOpenVpnMessageAsTlsCryptDoes() {
        val k = OpenVpnProbe.staticKey(key)!!
        assertEquals(256, k.size)
        val sid = ByteArray(8) { 7 }
        val packet = OpenVpnProbe.tlsCryptWrap(k, 7, sid, 1_700_000_000_000)
        assertEquals(54, packet.size)
        assertEquals(7 shl 3, packet[0].toInt())
        val t = OpenVpnProbe.target("client\nremote vpn.example.com 1194\n<tls-crypt>\n$key\n</tls-crypt>\n")!!
        assertEquals("vpn.example.com", t.host)
        assertEquals(1194, t.port)
        assertTrue(t.udp)
        val auth = OpenVpnProbe.target("client\nproto tcp-client\nremote 1.2.3.4 443\nauth SHA256\nkey-direction 1\n<tls-auth>\n$key\n</tls-auth>\n")!!
        assertEquals(false, auth.udp)
        assertEquals(54, auth.packet.size)
    }

    @Test
    fun readsSiteNamesAsTyped() {
        assertEquals("binance.com", siteName(" https://www.Binance.com/en/login "))
        assertEquals("chatgpt.com", siteName("*.chatgpt.com"))
        assertNull(siteName("localhost"))
        assertNull(siteName("1.2.3.4"))
    }

    @Test
    fun warnsTwoDaysAndThreeGigabytesBeforeTheEnd() {
        val now = 1_800_000_000_000L
        val a = Account("u", true, 0, 0, 0, 0, 0, 0)
        assertTrue(planWarnings(a.copy(expiryTime = now + 3 * 86_400_000L), now).isEmpty())
        assertEquals("expiry", planWarnings(a.copy(expiryTime = now + 86_400_000L), now).single().kind)
        val total = 20L * 1024 * 1024 * 1024
        assertTrue(planWarnings(a.copy(total = total, download = total - 4L * 1024 * 1024 * 1024), now).isEmpty())
        val w = planWarnings(a.copy(total = total, download = total), now).single()
        assertTrue(w.ended)
    }

    @Test
    fun keepsOneIdPerSubscriptionAndUsername() {
        assertEquals(AccountEntry.idOf("https://s/sub/a", "Dana"), AccountEntry.idOf(" https://s/sub/a", "dana "))
        val e = AccountEntry.fromJson(AccountEntry("x", "https://s/sub/a", "dana", "tok", null).toJson())
        assertNotNull(e)
        assertEquals("tok", e!!.token)
        assertEquals(false, e.signedIn)
    }
}
