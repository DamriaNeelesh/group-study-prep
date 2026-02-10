import { createWidgetController, type WidgetConfig } from './widget/controller';

export type { WidgetConfig };

type WidgetApi = {
  init: (config: WidgetConfig) => void;
  destroy: () => void;
  version: string;
};

let controller: ReturnType<typeof createWidgetController> | null = null;

const api: WidgetApi = {
  init(config) {
    controller ??= createWidgetController();
    controller.init(config);
  },
  destroy() {
    controller?.destroy();
    controller = null;
  },
  version: '0.1.0',
};

declare global {
  interface Window {
    NextToppersCounselorBot?: WidgetApi;
    NT_BOT_CONFIG?: Partial<WidgetConfig> & { autoInit?: boolean };
  }
}

if (typeof window !== 'undefined') {
  window.NextToppersCounselorBot = api;
  const cfg = window.NT_BOT_CONFIG;
  if (cfg?.autoInit === false) {
    // do nothing
  } else if (cfg?.supabaseProjectRef) {
    api.init(cfg as WidgetConfig);
  }
}

export default api;

