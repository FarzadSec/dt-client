import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: false, logLevel: 'info' };

await build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.js' });
await build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload/preload.js' });
await build({ ...common, entryPoints: ['src/main/smoke.ts'], outfile: 'dist/smoke.js' });
await build({ ...common, entryPoints: ['src/main/l2tpCheck.ts'], outfile: 'dist/l2tp-check.js' });
await build({ ...common, entryPoints: ['src/helper/helper.ts'], outfile: 'dist/helper/helper.js' });
