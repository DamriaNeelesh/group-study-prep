import { createRoot, type Root } from 'react-dom/client';
import { Widget, type WidgetProps } from './widget';
import './styles.css';

export type WidgetConfig = {
  supabaseProjectRef: string;
  /**
   * Defaults to `https://${supabaseProjectRef}.supabase.co/functions/v1`
   */
  functionsBaseUrl?: string;
};

export function createWidgetController() {
  let rootEl: HTMLDivElement | null = null;
  let reactRoot: Root | null = null;

  function init(config: WidgetConfig) {
    if (!config?.supabaseProjectRef) {
      throw new Error('NT Bot: `supabaseProjectRef` is required.');
    }

    const props: WidgetProps = {
      functionsBaseUrl:
        config.functionsBaseUrl ??
        `https://${config.supabaseProjectRef}.supabase.co/functions/v1`,
    };

    if (!rootEl) {
      rootEl = document.createElement('div');
      rootEl.id = 'nt-counselor-widget-root';
      document.body.appendChild(rootEl);
    }

    if (!reactRoot) {
      reactRoot = createRoot(rootEl);
    }

    reactRoot.render(<Widget {...props} />);
  }

  function destroy() {
    try {
      reactRoot?.unmount();
    } finally {
      reactRoot = null;
      rootEl?.remove();
      rootEl = null;
    }
  }

  return { init, destroy };
}

