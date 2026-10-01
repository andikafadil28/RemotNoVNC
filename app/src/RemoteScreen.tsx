import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import RFB from '@novnc/novnc'

type RemoteScreenProps = {
  deviceId: string
  deviceName: string
  status: 'VNC reachable' | 'VNC unreachable' | 'Unknown'
}

export default function RemoteScreen({ deviceId, deviceName, status }: RemoteScreenProps) {
  const container = useRef<HTMLDivElement>(null)
  const rfb = useRef<RFB | null>(null)
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [credentialsRequired, setCredentialsRequired] = useState(false)
  const [canControl, setCanControl] = useState(false)
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const unavailable = status === 'VNC unreachable'

  useEffect(() => {
    if (unavailable) return

    let cancelled = false
    let updateInputMode: (() => void) | null = null

    const connect = async () => {
      try {
        setError('')
        const response = await fetch(`/api/devices/${deviceId}/remote`, { method: 'POST' })
        const data: { token?: string, error?: string } = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {}
        if (!response.ok || !data.token) throw new Error(data.error ?? 'Token remote gagal dibuat.')
        if (cancelled || !container.current) return

        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
        const connection = new RFB(container.current, `${protocol}://${window.location.host}/api/remote/${data.token}`)
        rfb.current = connection
        connection.scaleViewport = true
        connection.resizeSession = true
        connection.showDotCursor = true
        updateInputMode = () => {
          const tile = container.current?.closest('article')
          const interactive = document.fullscreenElement === tile
          connection.viewOnly = !interactive
          setCanControl(interactive)
        }
        updateInputMode()
        document.addEventListener('fullscreenchange', updateInputMode)
        connection.addEventListener('credentialsrequired', () => setCredentialsRequired(true))
        connection.addEventListener('connect', () => setError(''))
        connection.addEventListener('disconnect', (event) => {
          if (cancelled) return
          setCredentialsRequired(false)
          setError(event.detail.clean ? 'Koneksi remote ditutup.' : 'Koneksi remote terputus.')
        })
      } catch (error) {
        if (!cancelled) setError(error instanceof Error ? error.message : 'Koneksi remote gagal.')
      }
    }

    void connect()
    return () => {
      cancelled = true
      if (updateInputMode) document.removeEventListener('fullscreenchange', updateInputMode)
      rfb.current?.disconnect()
      rfb.current = null
    }
  }, [connectionAttempt, deviceId, unavailable])

  const submitCredentials = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!password) return
    rfb.current?.sendCredentials({ password })
    setPassword('')
    setCredentialsRequired(false)
  }

  const reconnect = () => {
    rfb.current?.disconnect()
    rfb.current = null
    setCredentialsRequired(false)
    setError('')
    setConnectionAttempt((attempt) => attempt + 1)
  }

  return (
    <div ref={container} className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-[#090a0a] text-sm text-white/45" aria-label={`Remote ${deviceName}`}>
      {unavailable ? 'VNC tidak dapat dijangkau.' : error}
      {!unavailable && !credentialsRequired && <button type="button" onClick={reconnect} className="absolute right-2 top-2 z-10 rounded-md border border-white/15 bg-black/60 px-2 py-1 text-xs text-white/75 hover:border-white/35 hover:text-white">Reconnect</button>}
      {!unavailable && !error && !credentialsRequired && !canControl && <p className="pointer-events-none absolute bottom-3 z-10 border border-white/10 bg-black/60 px-3 py-1 text-xs text-white/75">Mode pantau. Masuk fullscreen untuk kontrol.</p>}
      {credentialsRequired && <form onSubmit={submitCredentials} className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 p-4">
        <div className="w-full max-w-xs border border-white/10 bg-[#141515] p-4">
          <p className="font-medium text-[#f3f7f5]">Password VNC: {deviceName}</p>
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" autoFocus className="mt-3 w-full rounded-md border border-white/10 bg-[#0d0e0e] px-3 py-2 text-[#f3f7f5] outline-none focus:border-[#65d98c]" required />
          <button type="submit" className="mt-3 w-full rounded-md bg-[#65d98c] px-3 py-2 text-sm font-semibold text-[#092012]">Hubungkan</button>
        </div>
      </form>}
    </div>
  )
}
