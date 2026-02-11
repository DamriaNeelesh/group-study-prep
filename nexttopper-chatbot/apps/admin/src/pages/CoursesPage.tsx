import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

type Course = {
  id: string;
  batch_key: string;
  batch_name: string;
  class_group: '9' | '10' | '11_12';
  target_exam: 'board' | 'jee' | 'neet' | 'mixed';
  price_inr: number;
  start_date: string | null;
  status: 'open' | 'full' | 'closed';
  syllabus_url: string | null;
  purchase_url: string | null;
  highlights: string[];
  updated_at: string;
};

const classGroups: Course['class_group'][] = ['9', '10', '11_12'];
const exams: Course['target_exam'][] = ['board', 'jee', 'neet', 'mixed'];
const statuses: Course['status'][] = ['open', 'full', 'closed'];

export function CoursesPage() {
  const [rows, setRows] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const empty = useMemo(
    () => ({
      batch_key: '',
      batch_name: '',
      class_group: '10' as Course['class_group'],
      target_exam: 'board' as Course['target_exam'],
      price_inr: 0,
      start_date: '',
      status: 'open' as Course['status'],
      syllabus_url: '',
      purchase_url: '',
      highlightsText: '',
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
      .from('nt_course_catalog')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) setError(error.message);
    setRows(((data ?? []) as Course[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  function beginNew() {
    setEditing({ ...empty, id: crypto.randomUUID(), mode: 'new' });
  }

  function beginEdit(c: Course) {
    setEditing({
      id: c.id,
      mode: 'edit',
      batch_key: c.batch_key,
      batch_name: c.batch_name,
      class_group: c.class_group,
      target_exam: c.target_exam,
      price_inr: c.price_inr,
      start_date: c.start_date ?? '',
      status: c.status,
      syllabus_url: c.syllabus_url ?? '',
      purchase_url: c.purchase_url ?? '',
      highlightsText: (c.highlights ?? []).join('\n'),
    });
  }

  async function save() {
    if (!editing) return;
    setError(null);

    const payload = {
      batch_key: editing.batch_key.trim(),
      batch_name: editing.batch_name.trim(),
      class_group: editing.class_group,
      target_exam: editing.target_exam,
      price_inr: Number.parseInt(String(editing.price_inr), 10) || 0,
      start_date: editing.start_date ? editing.start_date : null,
      status: editing.status,
      syllabus_url: editing.syllabus_url?.trim() ? editing.syllabus_url.trim() : null,
      purchase_url: editing.purchase_url?.trim() ? editing.purchase_url.trim() : null,
      highlights: editing.highlightsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    };

    if (!payload.batch_key || !payload.batch_name) {
      setError('batch_key and batch_name are required.');
      return;
    }

    if (editing.mode === 'new') {
      const { error } = await supabase.from('nt_course_catalog').insert(payload);
      if (error) {
        setError(error.message);
        return;
      }
    } else {
      const { error } = await supabase
        .from('nt_course_catalog')
        .update(payload)
        .eq('id', editing.id);
      if (error) {
        setError(error.message);
        return;
      }
    }

    setEditing(null);
    await load();
  }

  async function remove(id: string) {
    if (!confirm('Delete this course?')) return;
    const { error } = await supabase.from('nt_course_catalog').delete().eq('id', id);
    if (error) setError(error.message);
    await load();
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Courses</h2>
        <button
          type="button"
          onClick={beginNew}
          style={{
            border: '1px solid #e2e8f0',
            background: '#fff',
            borderRadius: 10,
            padding: '8px 10px',
            cursor: 'pointer',
            fontWeight: 800,
          }}
        >
          + New
        </button>
        <button
          type="button"
          onClick={() => void load()}
          style={{
            border: '1px solid #e2e8f0',
            background: '#fff',
            borderRadius: 10,
            padding: '8px 10px',
            cursor: 'pointer',
            fontWeight: 800,
          }}
        >
          Refresh
        </button>
      </div>

      {error ? (
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
          {error}
        </div>
      ) : null}

      {editing ? (
        <div
          style={{
            marginTop: 14,
            border: '1px solid #e2e8f0',
            borderRadius: 14,
            padding: 14,
            background: '#fff',
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 10 }}>
            {editing.mode === 'new' ? 'Create course' : 'Edit course'}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Batch Key">
              <input
                value={editing.batch_key}
                onChange={(e) =>
                  setEditing((p) => (p ? { ...p, batch_key: e.target.value } : p))
                }
                placeholder="abhay_10"
              />
            </Field>

            <Field label="Batch Name">
              <input
                value={editing.batch_name}
                onChange={(e) =>
                  setEditing((p) => (p ? { ...p, batch_name: e.target.value } : p))
                }
                placeholder="Abhay Batch (Class 10)"
              />
            </Field>

            <Field label="Class Group">
              <select
                value={editing.class_group}
                onChange={(e) =>
                  setEditing((p) =>
                    p ? { ...p, class_group: e.target.value as Course['class_group'] } : p
                  )
                }
              >
                {classGroups.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Target Exam">
              <select
                value={editing.target_exam}
                onChange={(e) =>
                  setEditing((p) =>
                    p ? { ...p, target_exam: e.target.value as Course['target_exam'] } : p
                  )
                }
              >
                {exams.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Price (INR)">
              <input
                value={editing.price_inr}
                onChange={(e) =>
                  setEditing((p) =>
                    p ? { ...p, price_inr: Number.parseInt(e.target.value || '0', 10) } : p
                  )
                }
                type="number"
                min={0}
              />
            </Field>

            <Field label="Start Date">
              <input
                value={editing.start_date}
                onChange={(e) =>
                  setEditing((p) => (p ? { ...p, start_date: e.target.value } : p))
                }
                type="date"
              />
            </Field>

            <Field label="Status">
              <select
                value={editing.status}
                onChange={(e) =>
                  setEditing((p) =>
                    p ? { ...p, status: e.target.value as Course['status'] } : p
                  )
                }
              >
                {statuses.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Syllabus URL">
              <input
                value={editing.syllabus_url}
                onChange={(e) =>
                  setEditing((p) => (p ? { ...p, syllabus_url: e.target.value } : p))
                }
                placeholder="https://..."
              />
            </Field>

            <Field label="Purchase URL">
              <input
                value={editing.purchase_url}
                onChange={(e) =>
                  setEditing((p) => (p ? { ...p, purchase_url: e.target.value } : p))
                }
                placeholder="https://..."
              />
            </Field>

            <Field label="Highlights (one per line)" span2>
              <textarea
                value={editing.highlightsText}
                onChange={(e) =>
                  setEditing((p) => (p ? { ...p, highlightsText: e.target.value } : p))
                }
                rows={6}
                placeholder="Live classes\nNotes\nDPPs"
              />
            </Field>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button
              type="button"
              onClick={() => void save()}
              style={{
                border: 'none',
                background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                color: '#fff',
                borderRadius: 10,
                padding: '10px 12px',
                cursor: 'pointer',
                fontWeight: 900,
              }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              style={{
                border: '1px solid #e2e8f0',
                background: '#fff',
                borderRadius: 10,
                padding: '10px 12px',
                cursor: 'pointer',
                fontWeight: 900,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 14 }}>
        {loading ? (
          <div>Loading…</div>
        ) : (
          <table
            style={{
              width: '100%',
              borderCollapse: 'separate',
              borderSpacing: 0,
              border: '1px solid #e2e8f0',
              borderRadius: 14,
              overflow: 'hidden',
              background: '#fff',
            }}
          >
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <Th>Batch</Th>
                <Th>Class</Th>
                <Th>Exam</Th>
                <Th>Price</Th>
                <Th>Status</Th>
                <Th>Start</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <div style={{ fontWeight: 900 }}>{c.batch_name}</div>
                    <div style={{ color: '#64748b', fontSize: 12 }}>{c.batch_key}</div>
                  </Td>
                  <Td>{c.class_group}</Td>
                  <Td>{c.target_exam}</Td>
                  <Td>₹{c.price_inr}</Td>
                  <Td>{c.status}</Td>
                  <Td>{c.start_date ?? '-'}</Td>
                  <Td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => beginEdit(c)}
                        style={actionBtn}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(c.id)}
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
                  <Td colSpan={7} style={{ textAlign: 'center', color: '#64748b' }}>
                    No courses yet.
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
      <div
        style={{
          display: 'grid',
        }}
      >
        {children}
      </div>
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

