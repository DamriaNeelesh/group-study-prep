import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

type Offer = {
  id: string;
  title: string;
  description: string;
  active: boolean;
  valid_from: string | null;
  valid_to: string | null;
};

export function OffersPage() {
  const [rows, setRows] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const empty = useMemo(
    () => ({
      title: '',
      description: '',
      active: true,
      valid_from: '',
      valid_to: '',
    }),
    []
  );

  const [editing, setEditing] = useState<
    | (typeof empty & { id: string; mode: 'edit' | 'new' })
    | null
  >(null);

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('nt_offers')
      .select('*')
      .order('active', { ascending: false });
    if (error) setError(error.message);
    setRows(((data ?? []) as Offer[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  function beginNew() {
    setEditing({ ...empty, id: crypto.randomUUID(), mode: 'new' });
  }

  function beginEdit(o: Offer) {
    setEditing({
      id: o.id,
      mode: 'edit',
      title: o.title,
      description: o.description,
      active: o.active,
      valid_from: o.valid_from ?? '',
      valid_to: o.valid_to ?? '',
    });
  }

  async function save() {
    if (!editing) return;
    setError(null);

    const payload = {
      title: editing.title.trim(),
      description: editing.description.trim(),
      active: !!editing.active,
      valid_from: editing.valid_from ? editing.valid_from : null,
      valid_to: editing.valid_to ? editing.valid_to : null,
    };

    if (!payload.title || !payload.description) {
      setError('title and description are required.');
      return;
    }

    if (editing.mode === 'new') {
      const { error } = await supabase.from('nt_offers').insert(payload);
      if (error) {
        setError(error.message);
        return;
      }
    } else {
      const { error } = await supabase.from('nt_offers').update(payload).eq('id', editing.id);
      if (error) {
        setError(error.message);
        return;
      }
    }

    setEditing(null);
    await load();
  }

  async function remove(id: string) {
    if (!confirm('Delete this offer?')) return;
    const { error } = await supabase.from('nt_offers').delete().eq('id', id);
    if (error) setError(error.message);
    await load();
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Offers</h2>
        <button type="button" onClick={beginNew} style={topBtn}>
          + New
        </button>
        <button type="button" onClick={() => void load()} style={topBtn}>
          Refresh
        </button>
      </div>

      {error ? <ErrorBox text={error} /> : null}

      {editing ? (
        <div style={card}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>
            {editing.mode === 'new' ? 'Create offer' : 'Edit offer'}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Title">
              <input
                value={editing.title}
                onChange={(e) =>
                  setEditing((p) => (p ? { ...p, title: e.target.value } : p))
                }
                placeholder="Festival Offer"
              />
            </Field>

            <Field label="Active">
              <select
                value={editing.active ? 'true' : 'false'}
                onChange={(e) =>
                  setEditing((p) =>
                    p ? { ...p, active: e.target.value === 'true' } : p
                  )
                }
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </Field>

            <Field label="Valid From">
              <input
                value={editing.valid_from}
                onChange={(e) =>
                  setEditing((p) => (p ? { ...p, valid_from: e.target.value } : p))
                }
                type="date"
              />
            </Field>

            <Field label="Valid To">
              <input
                value={editing.valid_to}
                onChange={(e) =>
                  setEditing((p) => (p ? { ...p, valid_to: e.target.value } : p))
                }
                type="date"
              />
            </Field>

            <Field label="Description" span2>
              <textarea
                value={editing.description}
                onChange={(e) =>
                  setEditing((p) => (p ? { ...p, description: e.target.value } : p))
                }
                rows={5}
                placeholder="Get extra discount on early enrollment…"
              />
            </Field>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button type="button" onClick={() => void save()} style={saveBtn}>
              Save
            </button>
            <button type="button" onClick={() => setEditing(null)} style={topBtn}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 14 }}>
        {loading ? (
          <div>Loading…</div>
        ) : (
          <table style={table}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <Th>Title</Th>
                <Th>Active</Th>
                <Th>Valid</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <Td>
                    <div style={{ fontWeight: 900 }}>{o.title}</div>
                    <div style={{ color: '#64748b', fontSize: 12 }}>{o.description}</div>
                  </Td>
                  <Td>{o.active ? 'true' : 'false'}</Td>
                  <Td>
                    {(o.valid_from ?? '-') + ' → ' + (o.valid_to ?? '-')}
                  </Td>
                  <Td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" onClick={() => beginEdit(o)} style={actionBtn}>
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(o.id)}
                        style={{ ...actionBtn, borderColor: '#fecaca', color: '#7f1d1d' }}
                      >
                        Delete
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <Td colSpan={4} style={{ textAlign: 'center', color: '#64748b' }}>
                    No offers yet.
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

function Field({
  label,
  children,
  span2,
}: {
  label: string;
  children: React.ReactNode;
  span2?: boolean;
}) {
  return (
    <div style={{ gridColumn: span2 ? '1 / span 2' : undefined }}>
      <div style={{ fontWeight: 800, marginBottom: 6, fontSize: 12, color: '#0f172a' }}>
        {label}
      </div>
      {children}
      <style>
        {`
          input, select, textarea {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid #e2e8f0;
            border-radius: 10px;
            font: inherit;
          }
          textarea { resize: vertical; }
        `}
      </style>
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

const card: React.CSSProperties = {
  marginTop: 14,
  border: '1px solid #e2e8f0',
  borderRadius: 14,
  padding: 14,
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

const saveBtn: React.CSSProperties = {
  border: 'none',
  background: 'linear-gradient(135deg, #22c55e, #16a34a)',
  color: '#fff',
  borderRadius: 10,
  padding: '10px 12px',
  cursor: 'pointer',
  fontWeight: 900,
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

const actionBtn: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  background: '#fff',
  borderRadius: 10,
  padding: '6px 10px',
  cursor: 'pointer',
  fontWeight: 800,
};

