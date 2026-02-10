import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

const linkStyle: React.CSSProperties = {
  display: 'block',
  padding: '10px 12px',
  borderRadius: 10,
  textDecoration: 'none',
  color: '#0f172a',
};

export function AdminLayout() {
  const navigate = useNavigate();

  async function signOut() {
    await supabase.auth.signOut();
    navigate('/login');
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '260px 1fr',
        minHeight: '100vh',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <aside
        style={{
          borderRight: '1px solid #e2e8f0',
          padding: 16,
          background: 'linear-gradient(180deg, #f8fafc, #ffffff)',
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Next Toppers</div>
        <div style={{ color: '#64748b', marginBottom: 16 }}>
          AI Counselor Admin
        </div>

        <nav style={{ display: 'grid', gap: 6 }}>
          <NavLink
            to="/courses"
            style={({ isActive }) => ({
              ...linkStyle,
              background: isActive ? '#e0f2fe' : 'transparent',
            })}
          >
            Courses
          </NavLink>
          <NavLink
            to="/offers"
            style={({ isActive }) => ({
              ...linkStyle,
              background: isActive ? '#dcfce7' : 'transparent',
            })}
          >
            Offers
          </NavLink>
          <NavLink
            to="/timetable"
            style={({ isActive }) => ({
              ...linkStyle,
              background: isActive ? '#ffedd5' : 'transparent',
            })}
          >
            Timetable
          </NavLink>
          <NavLink
            to="/leads"
            style={({ isActive }) => ({
              ...linkStyle,
              background: isActive ? '#fef3c7' : 'transparent',
            })}
          >
            Leads
          </NavLink>
          <NavLink
            to="/tickets"
            style={({ isActive }) => ({
              ...linkStyle,
              background: isActive ? '#fce7f3' : 'transparent',
            })}
          >
            Tickets
          </NavLink>
        </nav>

        <div style={{ marginTop: 18 }}>
          <button
            type="button"
            onClick={() => void signOut()}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid #e2e8f0',
              background: '#fff',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main style={{ padding: 22 }}>
        <Outlet />
      </main>
    </div>
  );
}

