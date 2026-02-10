import { useEffect, useMemo, useState } from 'react';
import bot from '@nexttoppers/widget';

function getLs(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setLs(key: string, val: string) {
  try {
    localStorage.setItem(key, val);
  } catch {}
}

function delLs(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

export default function App() {
  const projectRef =
    (import.meta.env.VITE_SUPABASE_PROJECT_REF as string | undefined) ??
    'ibsisfnjxeowvdtvgzff';

  const config = useMemo(() => ({ supabaseProjectRef: projectRef }), [projectRef]);

  const [userId, setUserId] = useState<string | null>(() => getLs('user_id'));
  const [userName, setUserName] = useState<string | null>(() => getLs('userName'));
  const [userMobile, setUserMobile] = useState<string | null>(() => getLs('userMobile'));

  useEffect(() => {
    bot.init(config);
    return () => bot.destroy();
  }, [config]);

  function refreshState() {
    setUserId(getLs('user_id'));
    setUserName(getLs('userName'));
    setUserMobile(getLs('userMobile'));
  }

  function setGuest() {
    delLs('user_id');
    delLs('userName');
    delLs('userMobile');
    refreshState();
  }

  function setRahul() {
    setLs('user_id', 'TEST_NT_1001');
    setLs('userName', 'Rahul');
    setLs('userMobile', '9999999999');
    refreshState();
  }

  function clearBotData() {
    delLs('nt_bot_visitor_id');
    refreshState();
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 840 }}>
      <h2 style={{ margin: 0 }}>Next Toppers Counselor Bot Demo</h2>
      <p style={{ color: '#64748b', marginTop: 6 }}>
        This page simulates the Next Toppers website localStorage keys so you can test
        greeting + flows end-to-end.
      </p>

      <div
        style={{
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          marginTop: 12,
        }}
      >
        <button type="button" onClick={setGuest} style={btn}>
          Set Guest
        </button>
        <button type="button" onClick={setRahul} style={btnPrimary}>
          Simulate Logged-in (Rahul)
        </button>
        <button type="button" onClick={clearBotData} style={btn}>
          Clear Bot Visitor ID
        </button>
      </div>

      <div style={{ marginTop: 16, border: '1px solid #e2e8f0', borderRadius: 14, padding: 14, background: '#fff' }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Current localStorage</div>
        <Row k="user_id" v={userId} />
        <Row k="userName" v={userName} />
        <Row k="userMobile" v={userMobile} />
        <Row k="nt_bot_visitor_id" v={getLs('nt_bot_visitor_id')} />
      </div>

      <div style={{ marginTop: 14, color: '#0f172a' }}>
        Widget should be running: open the floating chat button bottom-right.
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | null }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ color: '#334155', fontWeight: 800 }}>{k}</div>
      <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>
        {v ?? 'null'}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  background: '#fff',
  borderRadius: 10,
  padding: '10px 12px',
  cursor: 'pointer',
  fontWeight: 800,
};

const btnPrimary: React.CSSProperties = {
  border: 'none',
  background: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
  color: '#fff',
  borderRadius: 10,
  padding: '10px 12px',
  cursor: 'pointer',
  fontWeight: 900,
};

