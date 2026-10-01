import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { reverse } from 'node:dns/promises'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { createConnection, isIP } from 'node:net'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
import Fastify from 'fastify'

type Role = 'admin' | 'technician'

type Device = {
  id: string
  name: string
  group: string
  location: string
  ip: string
}

type DeviceInput = Omit<Device, 'id'>

type User = {
  id: string
  username: string
  role: Role
  passwordHash: string
  passwordSalt: string
}

type UserInput = {
  username: string
  password: string
  role: Role
}

type Session = {
  userId: string
  expiresAt: number
}

type RemoteToken = {
  userId: string
  deviceId: string
  expiresAt: number
}

type AuditEntry = {
  id: string
  timestamp: string
  username: string | null
  action: string
  target: string | null
  sourceIp: string
}

const scrypt = promisify(scryptCallback)
const dataDirectory = join(dirname(fileURLToPath(import.meta.url)), '../data')
const devicesPath = join(dataDirectory, 'devices.json')
const usersPath = join(dataDirectory, 'users.json')
const auditsPath = join(dataDirectory, 'audits.json')
const sessionDuration = 8 * 60 * 60 * 1000
const remoteTokenDuration = 60 * 1000

const readJson = async <T>(path: string, fallback: T) => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw error
  }
}

const saveJson = async (path: string, value: unknown) => {
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, JSON.stringify(value, null, 2))
  await rename(temporaryPath, path)
}

const hashPassword = async (password: string, salt: string) => ((await scrypt(password, salt, 64)) as Buffer).toString('hex')

let devices = await readJson<Device[]>(devicesPath, [])
let users = await readJson<User[]>(usersPath, [])
let audits = await readJson<AuditEntry[]>(auditsPath, [])
const sessions = new Map<string, Session>()
const remoteTokens = new Map<string, RemoteToken>()
let auditSaveQueue: Promise<void> = Promise.resolve()

if (users.length === 0) {
  const username = process.env.ADMIN_USERNAME?.trim()
  const password = process.env.ADMIN_PASSWORD

  if (!username || !password || password.length < 10) {
    throw new Error('Set ADMIN_USERNAME dan ADMIN_PASSWORD minimal 10 karakter untuk membuat admin POC pertama.')
  }

  const passwordSalt = randomBytes(16).toString('hex')
  users = [{
    id: randomUUID(),
    username,
    role: 'admin',
    passwordSalt,
    passwordHash: await hashPassword(password, passwordSalt),
  }]
  await saveJson(usersPath, users)
}

const saveDevices = () => saveJson(devicesPath, devices)
const saveUsers = () => saveJson(usersPath, users)
const saveAudits = () => {
  auditSaveQueue = auditSaveQueue.then(() => saveJson(auditsPath, audits)).catch((error) => {
    console.error('Gagal menyimpan audit:', error)
  })
  return auditSaveQueue
}
const logAudit = async (request: { ip: string }, user: User | null, action: string, target: string | null = null) => {
  audits.unshift({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    username: user?.username ?? null,
    action,
    target,
    sourceIp: request.ip,
  })
  audits = audits.slice(0, 1_000)
  await saveAudits()
}

const isPrivateIpv4 = (ip: string) => {
  const octets = ip.split('.').map(Number)

  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false

  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
}

const checkVnc = (ip: string) => new Promise<boolean>((resolve) => {
  const socket = createConnection({ host: ip, port: 5900 })
  const finish = (reachable: boolean) => {
    socket.destroy()
    resolve(reachable)
  }

  socket.setTimeout(1500)
  socket.once('connect', () => finish(true))
  socket.once('error', () => finish(false))
  socket.once('timeout', () => finish(false))
})

const allowedScanSubnets = {
  '192.168.0.0/24': { start: '192.168.0.1', end: '192.168.0.254' },
  '192.168.50.0/24': { start: '192.168.50.1', end: '192.168.50.254' },
  '192.168.106.0/23': { start: '192.168.106.1', end: '192.168.107.254' },
  '192.168.52.0/23': { start: '192.168.52.1', end: '192.168.53.254' },
  '192.168.54.0/23': { start: '192.168.54.1', end: '192.168.55.254' },
}

const ipToNumber = (ip: string) => ip.split('.').reduce((value, octet) => (value << 8) + Number(octet), 0)
const numberToIp = (value: number) => [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.')

const probeVnc = (ip: string) => new Promise<boolean>((resolve) => {
  const socket = createConnection({ host: ip, port: 5900 })
  const finish = (detected: boolean) => {
    socket.destroy()
    resolve(detected)
  }

  socket.setTimeout(500)
  socket.once('data', (data) => finish(data.toString('ascii').startsWith('RFB ')))
  socket.once('error', () => finish(false))
  socket.once('timeout', () => finish(false))
})

const scanSubnet = async (subnet: keyof typeof allowedScanSubnets) => {
  const range = allowedScanSubnets[subnet]
  const addresses = Array.from({ length: ipToNumber(range.end) - ipToNumber(range.start) + 1 }, (_, index) => numberToIp(ipToNumber(range.start) + index))
  const candidates: string[] = []
  let nextIndex = 0

  await Promise.all(Array.from({ length: 20 }, async () => {
    while (nextIndex < addresses.length) {
      const ip = addresses[nextIndex++]
      if (isIP(ip) === 4 && await probeVnc(ip)) candidates.push(ip)
    }
  }))

  return Promise.all(candidates.sort((left, right) => ipToNumber(left) - ipToNumber(right)).map(async (ip) => {
    try {
      const [hostname] = await reverse(ip)
      return { ip, hostname: hostname ?? null }
    } catch {
      return { ip, hostname: null }
    }
  }))
}

const getDevicesWithStatus = async () => Promise.all(devices.map(async (device) => ({
  ...device,
  status: (await checkVnc(device.ip)) ? 'VNC reachable' : 'VNC unreachable',
})))

const app = Fastify({ logger: true })
await app.register(cookie)
await app.register(rateLimit, { global: false })
await app.register(websocket)

const getUser = (request: { cookies: Record<string, string | undefined> }) => {
  const token = request.cookies.remote_session
  if (!token) return null
  const session = sessions.get(token)
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token)
    return null
  }
  return users.find((user) => user.id === session.userId) ?? null
}

const requireUser = async (request: { cookies: Record<string, string | undefined> }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => {
  const user = getUser(request)
  if (!user) {
    reply.code(401).send({ error: 'Login diperlukan.' })
    return null
  }
  return user
}

const requireAdmin = async (request: { cookies: Record<string, string | undefined> }, reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }) => {
  const user = await requireUser(request, reply)
  if (!user || user.role !== 'admin') {
    if (user) reply.code(403).send({ error: 'Role admin diperlukan.' })
    return null
  }
  return user
}

app.post('/api/auth/login', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request, reply) => {
  const { username, password } = request.body as { username?: string, password?: string }
  const user = users.find((item) => item.username === username?.trim())
  const passwordHash = user && password ? await hashPassword(password, user.passwordSalt) : null
  const authenticated = passwordHash && user && timingSafeEqual(Buffer.from(passwordHash, 'hex'), Buffer.from(user.passwordHash, 'hex'))

  if (!authenticated || !user) {
    await logAudit(request, null, 'login.failed', username?.trim() ?? null)
    return reply.code(401).send({ error: 'Username atau password salah.' })
  }

  const token = randomBytes(32).toString('base64url')
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + sessionDuration })
  reply.setCookie('remote_session', token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: sessionDuration / 1000 })
  await logAudit(request, user, 'login.success')
  return { user: { username: user.username, role: user.role } }
})

app.post('/api/auth/logout', async (request, reply) => {
  const user = getUser(request)
  const token = request.cookies.remote_session
  if (token) sessions.delete(token)
  reply.clearCookie('remote_session', { path: '/' })
  if (user) await logAudit(request, user, 'logout')
  return reply.code(204).send()
})

app.get('/api/auth/session', async (request, reply) => {
  const user = getUser(request)
  if (!user) return reply.code(401).send({ error: 'Login diperlukan.' })
  return { user: { username: user.username, role: user.role } }
})

app.post('/api/users', async (request, reply) => {
  const user = await requireAdmin(request, reply)
  if (!user) return
  const input = request.body as Partial<UserInput>
  const username = input.username?.trim()
  const password = input.password
  const role = input.role

  if (!username || username.length < 3 || !password || password.length < 10 || (role !== 'admin' && role !== 'technician')) {
    return reply.code(400).send({ error: 'Username minimal 3 karakter dan password minimal 10 karakter wajib diisi.' })
  }
  if (users.some((item) => item.username.toLowerCase() === username.toLowerCase())) return reply.code(409).send({ error: 'Username sudah terdaftar.' })

  const passwordSalt = randomBytes(16).toString('hex')
  const newUser: User = {
    id: randomUUID(),
    username,
    role,
    passwordSalt,
    passwordHash: await hashPassword(password, passwordSalt),
  }
  users.push(newUser)
  await saveUsers()
  await logAudit(request, user, 'user.created', `${newUser.username} (${newUser.role})`)
  return reply.code(201).send({ user: { username: newUser.username, role: newUser.role } })
})

app.get('/api/status', async (request, reply) => {
  if (!await requireUser(request, reply)) return
  return { devices: await getDevicesWithStatus() }
})

app.get('/api/devices', async (request, reply) => {
  if (!await requireUser(request, reply)) return
  return { devices: await getDevicesWithStatus() }
})

app.post('/api/devices', async (request, reply) => {
  const user = await requireAdmin(request, reply)
  if (!user) return
  const input = request.body as Partial<DeviceInput>
  const name = input.name?.trim()
  const group = input.group?.trim()
  const location = input.location?.trim()
  const ip = input.ip?.trim()

  if (!name || !group || !location || !ip || !isPrivateIpv4(ip)) return reply.code(400).send({ error: 'Nama, group, lokasi, dan IP privat valid wajib diisi.' })
  if (devices.some((device) => device.ip === ip)) return reply.code(409).send({ error: 'IP sudah terdaftar.' })

  const device = { id: randomUUID(), name, group, location, ip }
  devices.push(device)
  await saveDevices()
  await logAudit(request, user, 'device.created', `${device.name} (${device.ip})`)
  return reply.code(201).send({ device })
})

app.patch('/api/devices/:id', async (request, reply) => {
  const user = await requireAdmin(request, reply)
  if (!user) return
  const { id } = request.params as { id: string }
  const input = request.body as Partial<DeviceInput>
  const device = devices.find((item) => item.id === id)
  if (!device) return reply.code(404).send({ error: 'PC tidak ditemukan.' })

  const name = input.name?.trim()
  const group = input.group?.trim()
  const location = input.location?.trim()
  const ip = input.ip?.trim()
  if (!name || !group || !location || !ip || !isPrivateIpv4(ip)) return reply.code(400).send({ error: 'Data PC tidak valid.' })
  if (devices.some((item) => item.id !== id && item.ip === ip)) return reply.code(409).send({ error: 'IP sudah terdaftar.' })

  Object.assign(device, { name, group, location, ip })
  await saveDevices()
  await logAudit(request, user, 'device.updated', `${device.name} (${device.ip})`)
  return { device }
})

app.delete('/api/devices/:id', async (request, reply) => {
  const user = await requireAdmin(request, reply)
  if (!user) return
  const { id } = request.params as { id: string }
  const index = devices.findIndex((item) => item.id === id)
  if (index === -1) return reply.code(404).send({ error: 'PC tidak ditemukan.' })

  const [device] = devices.splice(index, 1)
  await saveDevices()
  await logAudit(request, user, 'device.deleted', `${device.name} (${device.ip})`)
  return reply.code(204).send()
})

app.post('/api/devices/discover', async (request, reply) => {
  const user = await requireAdmin(request, reply)
  if (!user) return
  const { subnet } = request.body as { subnet?: string }
  if (!subnet || !(subnet in allowedScanSubnets)) return reply.code(400).send({ error: 'Subnet tidak diizinkan.' })

  const candidates = await scanSubnet(subnet as keyof typeof allowedScanSubnets)
  await logAudit(request, user, 'device.scan', subnet)
  return { subnet, candidates }
})

app.post('/api/devices/:id/remote', async (request, reply) => {
  const user = await requireUser(request, reply)
  if (!user) return
  const { id } = request.params as { id: string }
  const device = devices.find((item) => item.id === id)
  if (!device) return reply.code(404).send({ error: 'PC tidak ditemukan.' })

  for (const [token, remoteToken] of remoteTokens) {
    if (remoteToken.expiresAt <= Date.now()) remoteTokens.delete(token)
  }

  const token = randomBytes(32).toString('base64url')
  remoteTokens.set(token, { userId: user.id, deviceId: device.id, expiresAt: Date.now() + remoteTokenDuration })
  return { token }
})

app.get('/api/remote/:token', { websocket: true }, (socket, request) => {
  const { token } = request.params as { token: string }
  const remoteToken = remoteTokens.get(token)
  remoteTokens.delete(token)
  const user = getUser(request)

  if (!remoteToken || remoteToken.expiresAt <= Date.now() || !user || user.id !== remoteToken.userId) {
    socket.close(1008, 'Token remote tidak valid.')
    return
  }

  const device = devices.find((item) => item.id === remoteToken.deviceId)
  if (!device) {
    socket.close(1008, 'PC tidak ditemukan.')
    return
  }

  const upstream = createConnection({ host: device.ip, port: 5900 })
  let connected = false
  let failureLogged = false
  let upstreamClosed = false
  const logRemoteFailure = () => {
    if (connected || failureLogged) return
    failureLogged = true
    void logAudit(request, user, 'remote.failed', `${device.name} (${device.ip})`)
  }

  upstream.setTimeout(5_000)
  socket.on('message', (data: Buffer) => upstream.write(data))
  socket.on('close', (code: number) => {
    if (connected && !upstreamClosed) void logAudit(request, user, 'remote.closed.client', `${device.name} (${device.ip}), code ${code}`)
    upstream.destroy()
  })
  socket.on('error', () => upstream.destroy())
  upstream.on('data', (data) => {
    if (socket.readyState === 1) socket.send(data, { binary: true })
  })
  upstream.on('connect', () => {
    connected = true
    upstream.setTimeout(0)
    void logAudit(request, user, 'remote.opened', `${device.name} (${device.ip})`)
  })
  upstream.on('timeout', () => {
    logRemoteFailure()
    upstream.destroy()
    socket.close(1011, 'Koneksi VNC timeout.')
  })
  upstream.on('error', () => {
    logRemoteFailure()
    socket.close(1011, 'Koneksi VNC gagal.')
  })
  upstream.on('close', () => {
    upstreamClosed = true
    if (connected) void logAudit(request, user, 'remote.closed.endpoint', `${device.name} (${device.ip})`)
    socket.close()
  })
})

app.get('/api/audits', async (request, reply) => {
  if (!await requireAdmin(request, reply)) return
  return { audits: audits.slice(0, 100) }
})

try {
  await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: 3000 })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
