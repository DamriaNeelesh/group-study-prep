import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import bot from './index';

bot.init({
  // Dev default (matches your Supabase project in MCP settings)
  supabaseProjectRef: 'ibsisfnjxeowvdtvgzff',
});

function Dev() {
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h2>Next Toppers Widget (Dev)</h2>
      <p>Use the floating "Chat" button at bottom-right.</p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Dev />
  </StrictMode>
);
