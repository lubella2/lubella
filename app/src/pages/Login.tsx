import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Field, Input } from '../components/ui';
import { homeForRole, useAuth } from '../lib/auth';

/**
 * One sign-in screen for owners, staff and suppliers.
 *
 * The destination follows the role recorded in the database, so a supplier can
 * never land in the shop's admin area even if they type the URL.
 */
export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const profile = await signIn(email.trim(), password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from || homeForRole(profile.role), { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <h1 className="text-lg font-semibold text-brand-ink">Sign in</h1>
      <p className="text-sm text-brand-muted mt-1 mb-4">
        For the shop owner, staff and suppliers. Customers do not need an account.
      </p>

      {error && (
        <div className="mb-4 rounded-xl border border-state-red/25 bg-state-red/5 px-3.5 py-2.5">
          <p className="text-sm text-state-red">{error}</p>
        </div>
      )}

      <Field label="Email" required>
        <Input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="you@lubella.shop" autoComplete="username" autoCapitalize="none"
          required
        />
      </Field>

      <Field label="Password" required>
        <Input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••" autoComplete="current-password" required
        />
      </Field>

      <Button type="submit" className="w-full mt-1" loading={busy}>
        Sign in
      </Button>

      <p className="text-xs text-brand-muted text-center mt-4">
        Trouble signing in? Ask the shop owner to check your account.
      </p>
    </form>
  );
}
