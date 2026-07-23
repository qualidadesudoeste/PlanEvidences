import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@/hooks/useTheme';
import { ToastsProvider } from '@/hooks/useToast';
import Evidences from '@/routes/Evidences';
import QAAssistant from '@/routes/QAAssistant';
import Login from '@/routes/Login';
import { AuthProvider, useAuth } from '@/auth/AuthContext';

function AuthenticatedApp() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <main className="auth-loading" aria-label="Verificando sessão">
        <div className="logo-icon">PE</div>
        <span>Verificando sua sessão no SIG...</span>
      </main>
    );
  }
  if (!user) return <Login />;

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/evidences" replace />} />
      <Route path="/qa" element={<QAAssistant />} />
      <Route path="/evidences" element={<Evidences />} />
      <Route path="/evidences/:id" element={<Evidences />} />
      <Route path="*" element={<Navigate to="/evidences" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastsProvider>
        <AuthProvider>
          <BrowserRouter>
            <AuthenticatedApp />
          </BrowserRouter>
        </AuthProvider>
      </ToastsProvider>
    </ThemeProvider>
  );
}
