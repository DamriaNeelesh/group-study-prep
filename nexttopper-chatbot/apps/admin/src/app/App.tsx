import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from '../components/AdminLayout';
import { RequireAdmin } from '../components/RequireAdmin';
import { LoginPage } from '../pages/LoginPage';
import { CoursesPage } from '../pages/CoursesPage';
import { OffersPage } from '../pages/OffersPage';
import { TimetablePage } from '../pages/TimetablePage';
import { LeadsPage } from '../pages/LeadsPage';
import { TicketsPage } from '../pages/TicketsPage';
import { useSession } from '../lib/useSession';

export function App() {
  const { session, loading } = useSession();

  if (loading) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        Loading…
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={session ? <Navigate to="/courses" replace /> : <LoginPage />}
      />

      <Route
        path="/"
        element={
          session ? (
            <RequireAdmin>
              <AdminLayout />
            </RequireAdmin>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      >
        <Route index element={<Navigate to="/courses" replace />} />
        <Route path="courses" element={<CoursesPage />} />
        <Route path="offers" element={<OffersPage />} />
        <Route path="timetable" element={<TimetablePage />} />
        <Route path="leads" element={<LeadsPage />} />
        <Route path="tickets" element={<TicketsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

