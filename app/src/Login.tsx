import { useState } from 'react'

type User = {
  username: string
  role: 'admin' | 'technician'
}

type LoginProps = {
  onAuthenticated: (user: User) => void
}

export default function Login({ onAuthenticated }: LoginProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data: { user?: User, error?: string } = await response.json()
      if (!response.ok || !data.user) throw new Error(data.error ?? 'Login gagal.')
      onAuthenticated(data.user)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Login gagal.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0d0e0e] p-6 text-[#f5f5f3]">
      <form onSubmit={submit} className="w-full max-w-sm border border-white/10 bg-[#141515] p-6">
        <p className="text-xs font-semibold tracking-[0.22em] text-[#65d98c]">REMOTE RS</p>
        <h1 className="mt-3 text-xl font-medium">Masuk dashboard</h1>
        <p className="mt-1 text-sm text-white/45">Akses IT RS terotorisasi.</p>
        <label className="mt-7 block text-sm text-white/55">Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" className="mt-2 w-full rounded-md border border-white/10 bg-[#0d0e0e] px-3 py-2 text-[#f5f5f3] outline-none focus:border-[#65d98c]" required />
        </label>
        <label className="mt-4 block text-sm text-white/55">Password
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" className="mt-2 w-full rounded-md border border-white/10 bg-[#0d0e0e] px-3 py-2 text-[#f5f5f3] outline-none focus:border-[#65d98c]" required />
        </label>
        {error && <p className="mt-4 text-sm text-[#ffaaa5]">{error}</p>}
        <button type="submit" disabled={submitting} className="mt-6 w-full rounded-md bg-[#65d98c] px-4 py-2 text-sm font-semibold text-[#092012] disabled:opacity-50">{submitting ? 'Memeriksa...' : 'Login'}</button>
      </form>
    </main>
  )
}
