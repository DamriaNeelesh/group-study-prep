import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

type Lead = {
  id: string;
  persona: 'student' | 'parent' | 'lead';
  name: string | null;
  phone_e164: string;
  class_moving_to: string | null;
  target_exam: string | null;
  query_text: string | null;
  source: string;
  page_url: string | null;
  priority: 'normal' | 'high';
  status: 'new' | 'contacted' | 'closed';
  created_at: string;
};

const statuses: Lead['status'][] = ['new', 'contacted', 'closed'];

export function LeadsPage() {
  const [rows, setRows] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('nt_leads')
      .select(
        'id, persona, name, phone_e164, class_moving_to, target_exam, query_text, source, page_url, priority, status, created_at'
      )
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) setError(error.message);
    setRows(((data ?? []) as Lead[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function updateStatus(id: string, status: Lead['status']) {
    const { error } = await supabase.from('nt_leads').update({ status }).eq('id', id);
    if (error) {
      setError(error.message);
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Leads</h2>
        <button type="button" onClick={() => void load()} style={topBtn}>
          Refresh
        </button>
      </div>

      {error ? <ErrorBox text={error} /> : null}

      <div style={{ marginTop: 14 }}>
        {loading ? (
          <div>Loading…</div>
        ) : (
          <table style={table}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <Th>When</Th>
                <Th>Phone</Th>
                <Th>Persona</Th>
                <Th>Query</Th>
                <Th>Priority</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <Td>
                    <div style={{ fontWeight: 900, fontSize: 12 }}>
                      {new Date(l.created_at).toLocaleString()}
                    </div>
                    <div style={{ color: '#64748b', fontSize: 12 }}>{l.source}</div>
                  </Td>
                  <Td>
                    <div style={{ fontWeight: 900 }}>{l.phone_e164}</div>
                    {l.name ? (
                      <div style={{ color: '#64748b', fontSize: 12 }}>{l.name}</div>
                    ) : null}
                  </Td>
                  <Td>
                    <div style={{ fontWeight: 900 }}>{l.persona}</div>
                    <div style={{ color: '#64748b', fontSize: 12 }}>
                      class:{l.class_moving_to ?? '-'} exam:{l.target_exam ?? '-'}
                    </div>
                  </Td>
                  <Td>
                    <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
                      {l.query_text ?? '-'}
                    </div>
                  </Td>
                  <Td>{l.priority}</Td>
                  <Td>
                    <select
                      value={l.status}
                      onChange={(e) => void updateStatus(l.id, e.target.value as Lead['status'])}
                      style={inputStyle}
                    >
                      {statuses.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </Td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <Td colSpan={6} style={{ textAlign: 'center', color: '#64748b' }}>
                    No leads yet.
                  </Td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ErrorBox({ text }: { text: string }) {
  return (
    <div
      style={{
        marginTop: 12,
        padding: 10,
        borderRadius: 10,
        border: '1px solid #fecaca',
        background: '#fef2f2',
        color: '#7f1d1d',
        whiteSpace: 'pre-wrap',
      }}
    >
      {text}
    </div>
  );
}

const table: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'separate',
  borderSpacing: 0,
  border: '1px solid #e2e8f0',
  borderRadius: 14,
  overflow: 'hidden',
  background: '#fff',
};

const topBtn: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  background: '#fff',
  borderRadius: 10,
  padding: '8px 10px',
  cursor: 'pointer',
  fontWeight: 800,
};

const Th: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = (props) => (
  <th
    {...props}
    style={{
      textAlign: 'left',
      padding: '10px 12px',
      fontSize: 12,
      color: '#334155',
      borderBottom: '1px solid #e2e8f0',
      ...(props.style ?? {}),
    }}
  />
);

const Td: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = (props) => (
  <td
    {...props}
    style={{
      padding: '10px 12px',
      borderBottom: '1px solid #e2e8f0',
      verticalAlign: 'top',
      ...(props.style ?? {}),
    }}
  />
);

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 10,
  border: '1px solid #e2e8f0',
};

