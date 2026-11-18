import fs from 'node:fs';
import path from 'node:path';

import { addConnectionScript, l2tpConnectionName, type L2tpAccount } from '../configs/l2tp';
import { allowL2tpBehindNat } from '../system/l2tpNat';
import { powershell, run } from '../system/run';
import { applyZone, restoreZone } from '../system/timezone';
import { protectWebrtc, restoreWebrtc } from '../system/webrtc';
import type { SystemKit } from './kit';

// Windows' own L2TP/IPsec client: a connection added with Add-VpnConnection, dialled with rasdial.
const l2tp = {
  async connect(account: L2tpAccount) {
    const rebootNeeded = await allowL2tpBehindNat();
    const notice = rebootNeeded ? 'reboot_for_l2tp' : undefined;
    if ((await powershell(addConnectionScript(account))).code !== 0) return { ok: false, notice };
    const dial = await run('rasdial.exe', [l2tpConnectionName, account.username, account.password], 90_000);
    return { ok: dial.code === 0, notice };
  },
  async isUp() {
    return (await run('rasdial.exe', [])).stdout.includes(l2tpConnectionName);
  },
  async disconnect() {
    await run('rasdial.exe', [l2tpConnectionName, '/disconnect']);
  },
};

export const windowsKit: SystemKit = {
  os: 'windows',
  exe: (name) => `${name}.exe`,
  openvpnBinary(binDir) {
    const exe = path.join(binDir, 'openvpn', 'openvpn.exe');
    return fs.existsSync(exe) ? exe : null;
  },
  openvpnUp: async () => undefined,
  l2tp,
  applyZone,
  restoreZone,
  protectWebrtc,
  restoreWebrtc,
  tunName: 'DT Connect',
};
