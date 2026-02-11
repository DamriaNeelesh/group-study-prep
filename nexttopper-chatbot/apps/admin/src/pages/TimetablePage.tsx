import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

type Course = { batch_key: string; batch_name: string };

type TimetableEntry = {
  id: string;
  batch_key: string;
  date: string;
  start_time: string;
  end_time: string;
  subject: string;
  teacher: string | null;
  meeting_link: string | null;
  notes: string | null;
};

export function TimetablePage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [batchKey, setBatchKey] = useState<string>('');
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const [rows, setRows] = useState<TimetableEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const empty = useMemo(
    () => ({
      batch_key: '',
      date: '',
      start_time: '18:00',
      end_time: '19:00',
      subject: '',
      teacher: '',
      meeting_link: '',
      notes: '',
    }),
    []
  );

  const [editing, setEditing] = useState<
    | (typeof empty & { id: string; mode: 'edit' | 'new' })
    | null
  >(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('nt_course_catalog')
        .select('batch_key, batch_name')
        .order('batch_key', { ascending: true });
      const list = ((data ?? []) as Course[]) ?? [];
      setCourses(list);
      if (!batchKey && list.length) setBatchKey(list[0].batch_key);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    if (!batchKey || !date) return;
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('nt_timetable_entries')
      .select('*')
      .eq('batch_key', batchKey)
      .eq('date', date)
      .order('start_time', { ascending: true });
    if (error) setError(error.message);
    setRows(((data ?? []) as TimetableEntry[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [batchKey, date]);

  function beginNew() {
    if (!batchKey) return;
    setEditing({
      ...empty,
      id: crypto.randomUUID(),
      mode: 'new',
      batch_key: batchKey,
      date,
    });
  }

  function beginEdit(t: TimetableEntry) {
    setEditing({
      id: t.id,
      mode: 'edit',
      batch_key: t.batch_key,
      date: t.date,
      start_time: t.start_time,
      end_time: t.end_time,
      subject: t.subject,
      teacher: t.teacher ?? '',
      meeting_link: t.meeting_link ?? '',
      notes: t.notes ?? '',
    });
  }

  async function save() {
    if (!editing) return;
    setError(null);

    const payload = {
      batch_key: editing.batch_key,
      date: editing.date,
      start_time: editing.start_time,
      end_time: editing.end_time,
      subject: editing.subject.trim(),
      teacher: editing.teacher?.trim() ? editing.teacher.trim() : null,
      meeting_link: editing.meeting_link?.trim() ? editing.meeting_link.trim() : null,
      notes: editing.notes?.trim() ? editing.notes.trim() : null,
    };

    if (!payload.subject) {
      setError('subject is required.');
      return;
    }

    if (editing.mode === 'new') {
      const { error } = await supabase.from('nt_timetable_entries').insert(payload);
      if (error) {
        setError(error.message);
        return;
      }
    } else {
      const { error } = await supabase
        .from('nt_timetable_entries')
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
    if (!confirm('Delete this entry?')) return;
    const { error } = await supabase.from('nt_timetable_entries').delete().eq('id', id);
    if (error) setError(error.message);
    await load();
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Timetable</h2>
        <select
          value={batchKey}
          onChange={(e) => setBatchKey(e.target.value)}
          style={inputStyle}
        >
          {courses.map((c) => (
            <option key={c.batch_key} value={c.batch_key}>
              {c.batch_name} ({c.batch_key})
            </option>
          ))}
        </select>
        <input value={date} onChange={(e) => setDate(e.target.value)} type="date" style={inputStyle} />
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
            {editing.mode === 'new' ? 'Create entry' : 'Edit entry'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Start">
              <input
                value={editing.start_time}
                onChange={(e) => setEditing((p) => (p ? { ...p, start_time: e.target.value } : p))}
                type="time"
              />
            </Field>
            <Field label="End">
              <input
                value={editing.end_time}
                onChange={(e) => setEditing((p) => (p ? { ...p, end_time: e.target.value } : p))}
                type="time"
              />
            </Field>
            <Field label="Subject">
              <input
                value={editing.subject}
                onChange={(e) => setEditing((p) => (p ? { ...p, subject: e.target.value } : p))}
                placeholder="Maths"
              />
            </Field>
            <Field label="Teacher">
              <input
                value={editing.teacher}
                onChange={(e) => setEditing((p) => (p ? { ...p, teacher: e.target.value } : p))}
                placeholder="Sir/Ma'am"
              />
            </Field>
            <Field label="Meeting link" span2>
              <input
                value={editing.meeting_link}
                onChange={(e) =>
                  setEditing((p) => (p ? { ...p, meeting_link: e.target.value } : p))
                }
                placeholder="https://..."
              />
            </Field>
            <Field label="Notes" span2>
              <textarea
                value={editing.notes}
                onChange={(e) => setEditing((p) => (p ? { ...p, notes: e.target.value } : p))}
                rows={4}
                placeholder="Extra notes…"
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
                <Th>Time</Th>
                <Th>Subject</Th>
                <Th>Teacher</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <Td>
                    {t.start_time} - {t.end_time}
                  </Td>
                  <Td>
                    <div style={{ fontWeight: 900 }}>{t.subject}</div>
                    {t.notes ? (
                      <div style={{ color: '#64748b', fontSize: 12 }}>{t.notes}</div>
                    ) : null}
                  </Td>
                  <Td>{t.teacher ?? '-'}</Td>
                  <Td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" onClick={() => beginEdit(t)} style={actionBtn}>
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(t.id)}
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
                    No entries for this date.
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

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 10,
  border: '1px solid #e2e8f0',
};

