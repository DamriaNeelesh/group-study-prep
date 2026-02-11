import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

type Ticket = {
  id: string;
  issue_type: 'video_not_playing' | 'pdf_not_opening' | 'payment_failed' | 'other';
  issue_details: string | null;
  nt_user_id: string | null;
  nt_user_name: string | null;
  nt_user_mobile: string | null;
  phone_e164: string | null;
  page_url: string | null;
  status: 'open' | 'in_progress' | 'resolved';
  created_at: string;
};

const statuses: Ticket['status'][] = ['open', 'in_progress', 'resolved'];

export function TicketsPage() {
  const [rows, setRows] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('nt_support_tickets')
      .select(
        'id, issue_type, issue_details, nt_user_id, nt_user_name, nt_user_mobile, phone_e164, page_url, status, created_at'
      )
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) setError(error.message);
    setRows(((data ?? []) as Ticket[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function updateStatus(id: string, status: Ticket['status']) {
    const { error } = await supabase
      .from('nt_support_tickets')
      .update({ status })
      .eq('id', id);
    if (error) {
      setError(error.message);
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Support Tickets</h2>
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
                <Th>Issue</Th>
                <Th>User</Th>
                <Th>Details</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <Td>
                    <div style={{ fontWeight: 900, fontSize: 12 }}>
                      {new Date(t.created_at).toLocaleString()}
                    </div>
                  </Td>
                  <Td>
                    <div style={{ fontWeight: 900 }}>{t.issue_type}</div>
                    {t.page_url ? (
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        {t.page_url}
                      </div>
                    ) : null}
                  </Td>
                  <Td>
                    <div style={{ fontWeight: 900 }}>{t.nt_user_name ?? '-'}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      nt_user_id:{t.nt_user_id ?? '-'}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      mobile:{t.nt_user_mobile ?? t.phone_e164 ?? '-'}
                    </div>
                  </Td>
                  <Td>
                    <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
                      {t.issue_details ?? '-'}
                    </div>
                  </Td>
                  <Td>
                    <select
                      value={t.status}
                      onChange={(e) =>
                        void updateStatus(t.id, e.target.value as Ticket['status'])
                      }
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
                  <Td colSpan={5} style={{ textAlign: 'center', color: '#64748b' }}>
                    No tickets yet.
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

