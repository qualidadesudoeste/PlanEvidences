import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface SigUser {
  name: string;
  username: string;
  userId: string;
  pesCod: string | null;
  groups: string[];
  isAdmin: boolean;
}

interface AuthResponse {
  ok?: boolean;
  error?: string;
  user?: SigUser;
}

interface AuthContextValue {
  user: SigUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function readAuthResponse(response: Response): Promise<AuthResponse> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as AuthResponse;
  } catch {
    return {};
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SigUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/session', { credentials: 'include' })
      .then(async (response) => {
        const data = await readAuthResponse(response);
        if (active) setUser(response.ok && data.user ? data.user : null);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => setUser(null);
    window.addEventListener('planevidences:unauthorized', handleUnauthorized);
    return () =>
      window.removeEventListener('planevidences:unauthorized', handleUnauthorized);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }).catch(() => {
      throw new Error(
        'Não foi possível conectar ao PlanEvidences. Verifique a rede e tente novamente.'
      );
    });
    const data = await readAuthResponse(response);
    if (!response.ok || !data.user) {
      throw new Error(data.error || 'Não foi possível entrar com seu usuário do SIG.');
    }
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    setUser(null);
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout }),
    [user, loading, login, logout]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider.');
  return context;
}

