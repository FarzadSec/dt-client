import { createCipheriv, createHmac, randomBytes } from 'node:crypto';
import dgram from 'node:dgram';
import net from 'node:net';

// The real delay of the servers a page request cannot reach without connecting (OpenVPN, L2TP/IPsec):
// the time the server itself takes to answer the first message of its handshake. With a relay in front
// (the usual tunnel to a server abroad), the answer comes from the server behind it, so the time is the
// whole way, not the relay's: what an ICMP or TCP ping to the relay's address could never show.

export interface OpenvpnProbeTarget {
  host: string;
  port: number;
  udp: boolean;
  // The first message, wrapped as the profile says (none, tls-auth, tls-crypt, tls-crypt-v2).
  packet: Buffer;
}

const P_CONTROL_HARD_RESET_CLIENT_V2 = 7;
const P_CONTROL_HARD_RESET_SERVER_V2 = 8;
const P_CONTROL_HARD_RESET_CLIENT_V3 = 10;

// A static key file (2048 bits) as OpenVPN writes it: hex lines between its markers.
export function staticKey(text: string): Buffer | null {
  const body = /-----BEGIN OpenVPN Static key V1-----([\s\S]*?)-----END OpenVPN Static key V1-----/.exec(text)?.[1];
  if (!body) return null;
  const hex = body.replace(/[^0-9a-fA-F]/g, '');
  return hex.length === 512 ? Buffer.from(hex, 'hex') : null;
}

function inlineBlock(profile: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(profile);
  return m ? m[1] : null;
}

function directive(profile: string, name: string): string[] | null {
  const m = new RegExp(`^[ \\t]*${name}(?:[ \\t]+([^\\r\\n]*))?$`, 'mi').exec(profile);
  return m ? (m[1] ?? '').trim().split(/\s+/).filter(Boolean) : null;
}

// Key direction: the client sends with the second key of the file (direction 1), as tls-crypt always does.
function keyPart(key: Buffer, index: 0 | 1, part: 'cipher' | 'hmac'): Buffer {
  const base = index * 128 + (part === 'cipher' ? 0 : 64);
  return key.subarray(base, base + 64);
}

function header(opcode: number, sessionId: Buffer): Buffer {
  return Buffer.concat([Buffer.from([opcode << 3]), sessionId]);
}

function replayId(now: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeUInt32BE(1, 0);
  b.writeUInt32BE(Math.floor(now / 1000) >>> 0, 4);
  return b;
}

// No acks yet, message 0, no payload.
const firstMessage = Buffer.from([0, 0, 0, 0, 0]);

// tls-crypt: the header and replay id are authenticated, the rest encrypted with AES-256-CTR, the IV the
// tag's first 16 bytes (OpenVPN's tls_crypt_wrap).
export function tlsCryptWrap(key: Buffer, opcode: number, sessionId: Buffer, now = Date.now(), plain = firstMessage): Buffer {
  const head = Buffer.concat([header(opcode, sessionId), replayId(now)]);
  const tag = createHmac('sha256', keyPart(key, 1, 'hmac').subarray(0, 32)).update(head).update(plain).digest();
  const cipher = createCipheriv('aes-256-ctr', keyPart(key, 1, 'cipher').subarray(0, 32), tag.subarray(0, 16));
  return Buffer.concat([head, tag, cipher.update(plain), cipher.final()]);
}

const digestSizes: Record<string, number> = { sha1: 20, sha224: 28, sha256: 32, sha384: 48, sha512: 64, md5: 16 };

// tls-auth: an HMAC over the replay id, the header and the message, placed after the header.
export function tlsAuthWrap(key: Buffer, direction: 0 | 1 | null, digest: string, opcode: number, sessionId: Buffer, now = Date.now()): Buffer {
  const alg = digest.toLowerCase().replace(/-/g, '');
  const size = digestSizes[alg] ?? 20;
  const k = keyPart(key, direction === 1 ? 1 : 0, 'hmac').subarray(0, size);
  const head = header(opcode, sessionId);
  const replay = replayId(now);
  const mac = createHmac(digestSizes[alg] ? alg : 'sha1', k).update(replay).update(head).update(firstMessage).digest();
  return Buffer.concat([head, mac, replay, firstMessage]);
}

// The first message of a connection to this profile's server, or null when the profile cannot be read.
export function openvpnProbeTarget(profile: string, sessionId = randomBytes(8), now = Date.now()): OpenvpnProbeTarget | null {
  const remote = /^[ \t]*remote[ \t]+(\S+)(?:[ \t]+(\d+))?(?:[ \t]+(\S+))?/m.exec(profile);
  if (!remote) return null;
  const port = Number(remote[2] ?? directive(profile, 'port')?.[0] ?? 1194);
  const proto = (remote[3] ?? directive(profile, 'proto')?.[0] ?? 'udp').toLowerCase();
  const udp = proto.startsWith('udp');
  let packet: Buffer;
  const v2 = inlineBlock(profile, 'tls-crypt-v2');
  const crypt = inlineBlock(profile, 'tls-crypt');
  const auth = inlineBlock(profile, 'tls-auth');
  if (v2) {
    const b64 = /-----BEGIN OpenVPN tls-crypt-v2 client key-----([\s\S]*?)-----END OpenVPN tls-crypt-v2 client key-----/.exec(v2)?.[1];
    if (!b64) return null;
    const raw = Buffer.from(b64.replace(/\s+/g, ''), 'base64');
    if (raw.length <= 256) return null;
    packet = Buffer.concat([tlsCryptWrap(raw.subarray(0, 256), P_CONTROL_HARD_RESET_CLIENT_V3, sessionId, now), raw.subarray(256)]);
  } else if (crypt) {
    const key = staticKey(crypt);
    if (!key) return null;
    packet = tlsCryptWrap(key, P_CONTROL_HARD_RESET_CLIENT_V2, sessionId, now);
  } else if (auth) {
    const key = staticKey(auth);
    if (!key) return null;
    const dir = directive(profile, 'key-direction')?.[0];
    const direction = dir === '1' ? 1 : dir === '0' ? 0 : null;
    const digest = directive(profile, 'auth')?.[0] ?? 'SHA1';
    packet = tlsAuthWrap(key, direction, digest, P_CONTROL_HARD_RESET_CLIENT_V2, sessionId, now);
  } else {
    packet = Buffer.concat([header(P_CONTROL_HARD_RESET_CLIENT_V2, sessionId), firstMessage]);
  }
  return { host: remote[1], port, udp, packet };
}

function isServerReset(packet: Buffer): boolean {
  return packet.length > 9 && packet[0] >> 3 === P_CONTROL_HARD_RESET_SERVER_V2;
}

// Sends the first message and times the server's answer; UDP sends it again once, a lost packet being
// common. null when no answer came in time.
export function openvpnHandshakeMs(target: OpenvpnProbeTarget, timeoutMs = 5000): Promise<number | null> {
  return target.udp ? udpExchange(target.host, target.port, target.packet, isServerReset, timeoutMs) : tcpOpenvpn(target, timeoutMs);
}

function udpExchange(host: string, port: number, packet: Buffer, accept: (reply: Buffer) => boolean, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const family = net.isIPv6(host) ? 'udp6' : 'udp4';
    const socket = dgram.createSocket(family);
    let started = 0;
    let settled = false;
    const finish = (ms: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(again);
      socket.close();
      resolve(ms);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    let again: NodeJS.Timeout | undefined;
    socket.on('error', () => finish(null));
    socket.on('message', (msg) => {
      if (accept(msg)) finish(Math.max(1, Math.round(performance.now() - started)));
    });
    socket.connect(port, host, () => {
      started = performance.now();
      socket.send(packet);
      again = setTimeout(() => {
        if (settled) return;
        started = performance.now();
        socket.send(packet);
      }, Math.min(2000, timeoutMs / 2));
    });
  });
}

function tcpOpenvpn(target: OpenvpnProbeTarget, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: target.host, port: target.port });
    let started = 0;
    let buf = Buffer.alloc(0);
    const finish = (ms: number | null) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(ms);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.once('error', () => finish(null));
    socket.once('connect', () => {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(target.packet.length);
      started = performance.now();
      socket.write(Buffer.concat([len, target.packet]));
    });
    socket.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length < 2) return;
      const size = buf.readUInt16BE(0);
      if (buf.length < 2 + size) return;
      finish(isServerReset(buf.subarray(2, 2 + size)) ? Math.max(1, Math.round(performance.now() - started)) : null);
    });
  });
}

// IKEv1 Main Mode's first message (an SA offer of the proposals Windows and phones use) to UDP 500.
// Any answer carrying the same initiator cookie, an SA or a refusal, means the IPsec server answered.
export function ikeProbePacket(cookie = randomBytes(8)): Buffer {
  type Attr = [number, number];
  const offers: Attr[][] = [];
  // [encryption, key length, hash, group]: AES-256/128, SHA-1/SHA-256, MODP 2048/1024, and 3DES.
  for (const [enc, keyLen, hash, group] of [
    [7, 256, 2, 14], [7, 256, 4, 14], [7, 128, 2, 14], [7, 256, 2, 2], [7, 128, 2, 2], [5, 0, 2, 2], [5, 0, 1, 2],
  ]) {
    const attrs: Attr[] = [[1, enc]];
    if (keyLen) attrs.push([14, keyLen]);
    attrs.push([2, hash], [3, 1], [4, group], [11, 1], [12, 28800]);
    offers.push(attrs);
  }
  const transforms = offers.map((attrs, i) => {
    const body = Buffer.alloc(8 + attrs.length * 4);
    body[0] = i === offers.length - 1 ? 0 : 3; // next payload: another transform
    body.writeUInt16BE(body.length, 2);
    body[4] = i + 1; // transform number
    body[5] = 1; // KEY_IKE
    attrs.forEach(([type, value], j) => {
      body.writeUInt16BE(0x8000 | type, 8 + j * 4);
      body.writeUInt16BE(value, 10 + j * 4);
    });
    return body;
  });
  const tBytes = Buffer.concat(transforms);
  const proposal = Buffer.alloc(8);
  proposal.writeUInt16BE(8 + tBytes.length, 2);
  proposal[4] = 1; // proposal number
  proposal[5] = 1; // PROTO_ISAKMP
  proposal[7] = transforms.length;
  const sa = Buffer.alloc(12);
  sa.writeUInt16BE(12 + proposal.length + tBytes.length, 2);
  sa.writeUInt32BE(1, 4); // DOI: IPsec
  sa.writeUInt32BE(1, 8); // situation: identity only
  const payload = Buffer.concat([sa, proposal, tBytes]);
  const head = Buffer.alloc(28);
  cookie.copy(head, 0);
  head[16] = 1; // next payload: SA
  head[17] = 0x10; // version 1.0
  head[18] = 2; // exchange: identity protection (main mode)
  head.writeUInt32BE(28 + payload.length, 24);
  return Buffer.concat([head, payload]);
}

export function ikeHandshakeMs(host: string, timeoutMs = 5000, port = 500): Promise<number | null> {
  const packet = ikeProbePacket();
  const cookie = packet.subarray(0, 8);
  return udpExchange(host, port, packet, (reply) => reply.length >= 28 && reply.subarray(0, 8).equals(cookie), timeoutMs);
}

// L2TP without IPsec: a Start-Control-Connection-Request to UDP 1701; the server answers with its reply
// (or a refusal), either one an answer from the server itself.
export function l2tpProbePacket(tunnelId = 1 + Math.floor(Math.random() * 65000)): Buffer {
  const avp = (attr: number, value: Buffer) => {
    const b = Buffer.alloc(6);
    b.writeUInt16BE(0x8000 | (6 + value.length), 0); // mandatory
    b.writeUInt16BE(0, 2);
    b.writeUInt16BE(attr, 4);
    return Buffer.concat([b, value]);
  };
  const u16 = (n: number) => Buffer.from([n >> 8, n & 0xff]);
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  const avps = Buffer.concat([avp(0, u16(1)), avp(2, Buffer.from([1, 0])), avp(3, u32(3)), avp(7, Buffer.from('dtconnect')), avp(9, u16(tunnelId))]);
  const head = Buffer.alloc(12);
  head.writeUInt16BE(0xc802, 0); // control, length, sequence; version 2
  head.writeUInt16BE(12 + avps.length, 2);
  return Buffer.concat([head, avps]);
}

export function l2tpHandshakeMs(host: string, timeoutMs = 5000, port = 1701): Promise<number | null> {
  return udpExchange(host, port, l2tpProbePacket(), (reply) => reply.length >= 12 && (reply.readUInt16BE(0) & 0x800f) === 0x8002, timeoutMs);
}
