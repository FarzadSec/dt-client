import type { DtApi } from '../shared/types';

declare global {
  interface Window {
    dt: DtApi;
  }
}

declare global {
  const __APP_VERSION__: string;
}
