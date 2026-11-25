import { login } from './actions'

export const dynamic = 'force-dynamic'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  return <main className="login-shell"><form action={login} className="login-card"><div className="brand-mark">♥</div><p className="eyebrow">MEDICARE HOSPITAL MANAGEMENT</p><h1>Staff sign in</h1><p>Use your hospital account to access patient and operational records.</p>{error && <div className="form-error">Email or password is incorrect.</div>}<label>Email<input type="email" name="email" required autoComplete="username" /></label><label>Password<input type="password" name="password" required autoComplete="current-password" /></label><button className="primary-button" type="submit">Sign in</button><small>Initial admin account: run <code>npm run db:seed</code> after configuring the environment.</small></form></main>
}
