package team.datacraft.dtclient.vpn

import org.json.JSONArray
import org.json.JSONObject

// The same configuration the desktop app writes: the panel's outbound behind a local SOCKS inbound.
object XrayConfig {
    val defaultDns = listOf("1.1.1.1", "8.8.8.8")

    fun dnsServers(setting: String): List<String> {
        val list = setting.split(Regex("[\\s,]+")).filter { it.matches(Regex("^[0-9a-fA-F.:]+$")) }
        return list.ifEmpty { defaultDns }
    }

    fun build(outbound: JSONObject, socksPort: Int, iranDirect: Boolean, adBlock: Boolean, dns: List<String>): String {
        val proxy = JSONObject(outbound.toString()).put("tag", "proxy")
        val stream = proxy.optJSONObject("streamSettings") ?: JSONObject()
        val sockopt = stream.optJSONObject("sockopt") ?: JSONObject()
        sockopt.put("domainStrategy", "UseIPv4")
        stream.put("sockopt", sockopt)
        proxy.put("streamSettings", stream)

        val rules = JSONArray()
        if (adBlock) rules.put(JSONObject().put("type", "field").put("domain", JSONArray().put("geosite:category-ads-all")).put("outboundTag", "block"))
        rules.put(JSONObject().put("type", "field").put("ip", JSONArray().put("geoip:private")).put("outboundTag", "direct"))
        if (iranDirect) {
            rules.put(JSONObject().put("type", "field").put("domain", JSONArray().put("geosite:category-ir").put("regexp:\\.ir$")).put("outboundTag", "direct"))
            rules.put(JSONObject().put("type", "field").put("ip", JSONArray().put("geoip:ir")).put("outboundTag", "direct"))
        }
        val socks = JSONObject()
            .put("tag", "socks")
            .put("listen", "127.0.0.1")
            .put("port", socksPort)
            .put("protocol", "socks")
            .put("settings", JSONObject().put("auth", "noauth").put("udp", true))
            .put("sniffing", JSONObject().put("enabled", true).put("destOverride", JSONArray().put("http").put("tls").put("quic")).put("routeOnly", true))
        return JSONObject()
            .put("log", JSONObject().put("loglevel", "warning"))
            .put("dns", JSONObject().put("servers", JSONArray(dns)).put("queryStrategy", "UseIPv4"))
            .put("inbounds", JSONArray().put(socks))
            .put("outbounds", JSONArray().put(proxy).put(JSONObject().put("tag", "direct").put("protocol", "freedom")).put(JSONObject().put("tag", "block").put("protocol", "blackhole")))
            .put("routing", JSONObject().put("domainStrategy", "IPIfNonMatch").put("rules", rules))
            .toString()
    }
}
