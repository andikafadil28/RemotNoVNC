import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import Login from './Login'
import RemoteScreen from './RemoteScreen'

type Device = {
  id: string
  name: string
  group: string
  location: string
  ip: string
  status: 'VNC reachable' | 'VNC unreachable' | 'Unknown'
}

type DeviceForm = {
  name: string
  group: string
  location: string
  ip: string
}

type Candidate = { ip: string; hostname: string | null }

type User = {
  username: string
  role: 'admin' | 'technician'
}

type AuditEntry = {
  id: string
  timestamp: string
  username: string | null
  action: string
  target: string | null
  sourceIp: string
}

type UserForm = {
  username: string
  password: string
  role: 'admin' | 'technician'
}

const emptyForm: DeviceForm = {
  name: '',
  group: '',
  location: '',
  ip: '',
}

const emptyUserForm: UserForm = {
  username: '',
  password: '',
  role: 'technician',
}

const livePageSize = 16

const gridColumns = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
  5: 'sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5',
}

function App() {
  const [devices, setDevices] = useState<Device[]>([])
  const [user, setUser] = useState<User | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [activeGroup, setActiveGroup] = useState('')
  const [currentPage, setCurrentPage] = useState(0)
  const [columns, setColumns] = useState<keyof typeof gridColumns>(3)
  const [autoCycle, setAutoCycle] = useState(true)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null)
  const [subnet, setSubnet] = useState('192.168.106.0/23')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [scanning, setScanning] = useState(false)
  const [audits, setAudits] = useState<AuditEntry[]>([])
  const [userForm, setUserForm] = useState(emptyUserForm)
  const [userFormError, setUserFormError] = useState('')
  const [creatingUser, setCreatingUser] = useState(false)

  const reachableCount = devices.filter((device) => device.status === 'VNC reachable').length
  const groups = [...new Set(devices.map((device) => device.group))]
  const displayedGroup = groups.includes(activeGroup) ? activeGroup : groups[0] ?? ''
  const groupDevices = devices.filter((device) => device.group === displayedGroup)
  const pageCount = Math.max(1, Math.ceil(groupDevices.length / livePageSize))
  const visibleDevices = groupDevices.slice(currentPage * livePageSize, (currentPage + 1) * livePageSize)

  const refreshStatus = async () => {
    try {
      const response = await fetch('/api/status')
      if (!response.ok) throw new Error('Status request failed')

      const data: { devices: Device[] } = await response.json()

      setDevices(data.devices)
    } catch {
      setDevices((currentDevices) => currentDevices.map((device) => ({
        ...device,
        status: 'Unknown',
      })))
    }
  }

  const refreshAudits = async () => {
    if (user?.role !== 'admin') return
    const response = await fetch('/api/audits')
    if (!response.ok) return
    const data: { audits: AuditEntry[] } = await response.json()
    setAudits(data.audits)
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    setAudits([])
  }

  useEffect(() => {
    const loadSession = async () => {
      try {
        const response = await fetch('/api/auth/session')
        if (!response.ok) return
        const data: { user: User } = await response.json()
        setUser(data.user)
      } finally {
        setAuthChecked(true)
      }
    }
    void loadSession()
  }, [])

  useEffect(() => {
    if (!user) return
    void refreshStatus()
    const interval = window.setInterval(refreshStatus, 30_000)

    return () => window.clearInterval(interval)
  }, [user])

  useEffect(() => {
    if (user?.role !== 'admin') return

    const loadAudits = async () => {
      const response = await fetch('/api/audits')
      if (!response.ok) return
      const data: { audits: AuditEntry[] } = await response.json()
      setAudits(data.audits)
    }

    void loadAudits()
  }, [user])

  useEffect(() => {
    if (!autoCycle || pageCount < 2) return

    const interval = window.setInterval(() => {
      setCurrentPage((page) => page === pageCount - 1 ? 0 : page + 1)
    }, 20_000)

    return () => window.clearInterval(interval)
  }, [autoCycle, pageCount])

  const submitDevice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const updatedGroup = editingDeviceId ? form.group : null
    setSaving(true)
    setFormError('')

    try {
      const response = await fetch(editingDeviceId ? `/api/devices/${editingDeviceId}` : '/api/devices', {
        method: editingDeviceId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      if (!response.ok) {
        const data: { error?: string } = await response.json()
        throw new Error(data.error ?? `Gagal ${editingDeviceId ? 'mengubah' : 'menambah'} PC.`)
      }

      setForm(emptyForm)
      setEditingDeviceId(null)
      if (updatedGroup) setActiveGroup(updatedGroup)
      await refreshStatus()
      await refreshAudits()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : `Gagal ${editingDeviceId ? 'mengubah' : 'menambah'} PC.`)
    } finally {
      setSaving(false)
    }
  }

  const editDevice = (device: Device) => {
    setEditingDeviceId(device.id)
    setForm({ name: device.name, group: device.group, location: device.location, ip: device.ip })
    setFormError('')
  }

  const cancelEdit = () => {
    setEditingDeviceId(null)
    setForm(emptyForm)
    setFormError('')
  }

  const deleteDevice = async (device: Device) => {
    if (!window.confirm(`Hapus ${device.name} (${device.ip}) dari inventory?`)) return

    setSaving(true)
    setFormError('')
    try {
      const response = await fetch(`/api/devices/${device.id}`, { method: 'DELETE' })
      if (!response.ok) {
        const data: { error?: string } = await response.json()
        throw new Error(data.error ?? 'Gagal menghapus PC.')
      }

      if (editingDeviceId === device.id) cancelEdit()
      if (activeGroup === device.group && groupDevices.length === 1) {
        setActiveGroup(groups.find((group) => group !== activeGroup) ?? '')
        setCurrentPage(0)
      }
      await refreshStatus()
      await refreshAudits()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Gagal menghapus PC.')
    } finally {
      setSaving(false)
    }
  }

  const scanSubnet = async () => {
    setScanning(true)
    setFormError('')
    try {
      const response = await fetch('/api/devices/discover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subnet }) })
      if (!response.ok) throw new Error('Scan gagal.')
      const data: { candidates: Candidate[] } = await response.json()
      setCandidates(data.candidates)
      await refreshAudits()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Scan gagal.')
    } finally {
      setScanning(false)
    }
  }

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCreatingUser(true)
    setUserFormError('')
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userForm),
      })
      if (!response.ok) {
        const data: { error?: string } = await response.json()
        throw new Error(data.error ?? 'Gagal membuat akun.')
      }
      setUserForm(emptyUserForm)
      await refreshAudits()
    } catch (error) {
      setUserFormError(error instanceof Error ? error.message : 'Gagal membuat akun.')
    } finally {
      setCreatingUser(false)
    }
  }

  if (!authChecked) return <main className="flex min-h-screen items-center justify-center bg-[#0d0e0e] text-white/50">Memeriksa sesi...</main>
  if (!user) return <Login onAuthenticated={setUser} />

  return (
    <main className="min-h-screen bg-[#0d0e0e] p-4 text-[#f5f5f3] md:p-6">
      <div className="mx-auto max-w-[1600px]">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.22em] text-[#65d98c]">REMOTE RS</p>
          <h1 className="mt-1 text-xl font-medium">Live monitoring</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <p className="px-2 text-white/45">{user.username} · {user.role}</p>
          <p className="rounded-md bg-[#173520] px-2.5 py-1 text-xs font-medium text-[#8ee8ad]">{reachableCount} online</p>
          <button type="button" onClick={() => void logout()} className="rounded-md border border-white/15 px-2.5 py-1 text-xs text-white/60 hover:border-white/30 hover:text-white">Logout</button>
        </div>
      </header>

      {user.role === 'admin' && <section className="mb-5 border border-white/10 bg-[#141515] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <select value={subnet} onChange={(event) => setSubnet(event.target.value)} className="rounded-md border border-white/10 bg-[#0d0e0e] px-3 py-2 text-sm">
            <option>192.168.0.0/24</option><option>192.168.50.0/24</option><option>192.168.106.0/23</option><option>192.168.52.0/23</option><option>192.168.54.0/23</option>
          </select>
          <button type="button" onClick={scanSubnet} disabled={scanning} className="rounded-md border border-white/15 px-3 py-2 text-sm text-white/75 hover:border-white/30 disabled:opacity-50">{scanning ? 'Scanning...' : 'Scan VNC'}</button>
        </div>
        {candidates.length > 0 && <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{candidates.map((candidate) => <button key={candidate.ip} type="button" onClick={() => setForm({ ...form, name: candidate.hostname ?? '', ip: candidate.ip })} className="border border-white/10 p-3 text-left text-sm hover:border-white/25"><b>{candidate.ip}</b><br /><span className="text-white/45">{candidate.hostname ?? 'Hostname tidak tersedia'}</span><br /><span className="text-[#8ee8ad]">Tambah</span></button>)}</div>}
      </section>}

      {user.role === 'admin' && <form onSubmit={submitDevice} className="mb-5 grid gap-2 border border-white/10 bg-[#141515] p-4 md:grid-cols-5">
        <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nama PC" className="rounded-md border border-white/10 bg-[#0d0e0e] px-3 py-2 text-sm outline-none focus:border-[#65d98c]" required />
        <input value={form.group} onChange={(event) => setForm({ ...form, group: event.target.value })} placeholder="Group" className="rounded-md border border-white/10 bg-[#0d0e0e] px-3 py-2 text-sm outline-none focus:border-[#65d98c]" required />
        <input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Lokasi" className="rounded-md border border-white/10 bg-[#0d0e0e] px-3 py-2 text-sm outline-none focus:border-[#65d98c]" required />
        <input value={form.ip} onChange={(event) => setForm({ ...form, ip: event.target.value })} placeholder="IP privat" className="rounded-md border border-white/10 bg-[#0d0e0e] px-3 py-2 text-sm outline-none focus:border-[#65d98c]" required />
        <button type="submit" disabled={saving} className="rounded-md bg-[#65d98c] px-4 py-2 text-sm font-semibold text-[#092012] disabled:opacity-50">
          {saving ? 'Menyimpan...' : editingDeviceId ? 'Simpan perubahan' : 'Tambah PC'}
        </button>
        {editingDeviceId && <button type="button" onClick={cancelEdit} disabled={saving} className="rounded-md border border-white/15 px-4 py-2 text-sm text-white/60 disabled:opacity-50">Batal</button>}
        {formError && <p className="text-sm text-[#ffaaa5] md:col-span-5">{formError}</p>}
      </form>}

      <section className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {groups.map((group) => (
            <button key={group} type="button" onClick={() => { setActiveGroup(group); setCurrentPage(0) }} className={`rounded-md px-3 py-1.5 text-sm ${group === displayedGroup ? 'bg-[#65d98c] font-medium text-[#092012]' : 'border border-white/10 text-white/55 hover:border-white/25'}`}>
              {group} ({devices.filter((device) => device.group === group).length})
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-sm text-white/45">
          <label className="flex items-center gap-2 text-xs">
            Kolom
            <select value={columns} onChange={(event) => setColumns(Number(event.target.value) as keyof typeof gridColumns)} className="rounded-md border border-white/10 bg-[#0d0e0e] px-2 py-1 text-white/75">
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5</option>
            </select>
          </label>
          <button type="button" onClick={() => setAutoCycle((enabled) => !enabled)} disabled={pageCount < 2} className="rounded-md border border-white/10 px-2.5 py-1.5 text-xs disabled:opacity-40">
            Auto Cycle: {autoCycle ? 'ON' : 'OFF'}
          </button>
          <button type="button" onClick={() => setCurrentPage((page) => Math.max(0, page - 1))} disabled={currentPage === 0} className="rounded-md border border-white/10 px-2.5 py-1 disabled:opacity-40">‹</button>
          <span>Halaman {currentPage + 1}/{pageCount}</span>
          <button type="button" onClick={() => setCurrentPage((page) => Math.min(pageCount - 1, page + 1))} disabled={currentPage === pageCount - 1} className="rounded-md border border-white/10 px-2.5 py-1 disabled:opacity-40">›</button>
        </div>
      </section>

      <section className={`grid grid-cols-1 gap-3 ${gridColumns[columns]}`}>
        {visibleDevices.map((device) => (
          <article key={device.id} className="overflow-hidden border border-white/10 bg-[#141515]">
              <RemoteScreen deviceId={device.id} deviceName={device.name} status={device.status} />

               <div className="flex items-center justify-between gap-3 p-3">
                <div>
                  <h2 className="text-sm font-medium">{device.name}</h2>
                  <p className="mt-1 text-xs text-white/45">{device.location} · {device.ip}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                   <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${device.status === 'VNC reachable' ? 'bg-[#00a846]/15 text-[#7ae7a5]' : device.status === 'VNC unreachable' ? 'bg-[#ef6464]/15 text-[#ffaaa5]' : 'bg-[#f2b84b]/15 text-[#f9d98d]'}`}>
                     {device.status}
                   </span>
                    <button type="button" onClick={(event) => {
                     const article = event.currentTarget.closest('article')
                     if (!article) {
                       setFormError('Browser menolak mode fullscreen.')
                       return
                     }
                     void article.requestFullscreen().catch(() => setFormError('Browser menolak mode fullscreen.'))
                     }} className="rounded-md border border-white/20 px-2 py-1 text-xs text-white/75 hover:border-white/40 hover:bg-white/10 hover:text-white">Fullscreen</button>
                    {user.role === 'admin' && <div className="flex gap-2 text-xs">
                     <button type="button" onClick={() => editDevice(device)} className="rounded-md border border-[#7ae7a5]/50 px-2 py-1 text-[#7ae7a5] hover:border-[#7ae7a5] hover:bg-[#00a846]/15">Edit</button>
                     <button type="button" onClick={() => void deleteDevice(device)} disabled={saving} className="rounded-md border border-[#ffaaa5]/50 px-2 py-1 text-[#ffaaa5] hover:border-[#ffaaa5] hover:bg-[#ef6464]/15 disabled:opacity-50">Hapus</button>
                  </div>}
                </div>
            </div>
          </article>
        ))}
      </section>

      {user.role === 'admin' && <section className="mt-5 border border-white/10 bg-[#141515] p-4">
        <h2 className="text-sm font-medium">Audit terbaru</h2>
        <div className="mt-3 space-y-2 text-sm">
          {audits.length === 0 && <p className="text-white/45">Belum ada aktivitas tercatat.</p>}
          {audits.slice(0, 10).map((audit) => <p key={audit.id} className="border-b border-white/10 pb-2 text-white/45">{new Date(audit.timestamp).toLocaleString()} · <span className="text-white/80">{audit.username ?? 'anonymous'}</span> · {audit.action}{audit.target ? ` · ${audit.target}` : ''}</p>)}
        </div>
      </section>}

      {user.role === 'admin' && <form onSubmit={createUser} className="mt-5 grid gap-2 border border-white/10 bg-[#141515] p-4 md:grid-cols-4">
        <h2 className="text-sm font-medium md:col-span-4">Buat akun</h2>
        <input value={userForm.username} onChange={(event) => setUserForm({ ...userForm, username: event.target.value })} placeholder="Username" autoComplete="off" className="rounded-md border border-white/10 bg-[#0d0e0e] px-3 py-2 text-sm outline-none focus:border-[#65d98c]" required />
        <input value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} placeholder="Password minimal 10 karakter" type="password" autoComplete="new-password" className="rounded-md border border-white/10 bg-[#0d0e0e] px-3 py-2 text-sm outline-none focus:border-[#65d98c]" minLength={10} required />
        <select value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value as UserForm['role'] })} className="rounded-md border border-white/10 bg-[#0d0e0e] px-3 py-2 text-sm">
          <option value="technician">Teknisi</option>
          <option value="admin">Admin</option>
        </select>
        <button type="submit" disabled={creatingUser} className="rounded-md bg-[#65d98c] px-4 py-2 text-sm font-semibold text-[#092012] disabled:opacity-50">{creatingUser ? 'Membuat...' : 'Buat akun'}</button>
        {userFormError && <p className="text-sm text-[#ffaaa5] md:col-span-4">{userFormError}</p>}
      </form>}
      </div>
    </main>
  )
}

export default App
