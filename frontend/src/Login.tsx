import { useState, type FormEvent } from 'react';
import { login } from './api.ts';

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(password);
      onSuccess();
    } catch {
      setError('Mot de passe incorrect.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="masthead">
        <div className="wordmark">
          <span className="glyph">◎</span> SUIVI<span className="thin">·anime</span>
        </div>
      </div>
      <form className="login-form" onSubmit={handleSubmit}>
        <input
          type="password"
          className="login-input"
          placeholder="Mot de passe"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus
        />
        <button type="submit" className="login-submit" disabled={submitting || password.length === 0}>
          {submitting ? 'Connexion…' : 'Se connecter'}
        </button>
        {error && (
          <div className="hint err" role="alert">
            {error}
          </div>
        )}
      </form>
    </div>
  );
}
