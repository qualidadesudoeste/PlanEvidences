import { useState, type FormEvent } from 'react';
import { Loader2, LockKeyhole, Sparkles, UserRound } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/lib/utils';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError('Informe seu usuário e sua senha do SIG.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      setPassword('');
    } catch (loginError) {
      setError(getErrorMessage(loginError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-card card" aria-labelledby="login-title">
        <div className="login-brand">
          <div className="logo-icon">
            <Sparkles size={26} />
          </div>
          <div>
            <h1>PlanEvidences</h1>
            <span>QA Suite</span>
          </div>
        </div>

        <div className="login-heading">
          <h2 id="login-title">Entrar com o SIG</h2>
          <p>Use o mesmo usuário e senha que você utiliza no SIG v3.</p>
        </div>

        <form onSubmit={submit} className="login-form">
          <label>
            Usuário do SIG
            <span className="login-input">
              <UserRound size={18} />
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoFocus
                disabled={submitting}
              />
            </span>
          </label>

          <label>
            Senha
            <span className="login-input">
              <LockKeyhole size={18} />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                disabled={submitting}
              />
            </span>
          </label>

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? <Loader2 size={18} className="spin" /> : <LockKeyhole size={18} />}
            {submitting ? 'Entrando...' : 'Entrar'}
          </Button>
        </form>

        <p className="login-security">
          Sua senha é enviada somente para autenticação no SIG e não é salva pelo
          PlanEvidences.
        </p>
      </section>
    </main>
  );
}
