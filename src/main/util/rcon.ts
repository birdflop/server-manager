import { Socket } from 'node:net'

/**
 * Minimal Minecraft RCON client (Source RCON protocol) with a persistent
 * connection: connect + authenticate once, then run many commands over the same
 * socket. Short-lived per-command connections made the server log
 * "Thread RCON Client started/shutting down" for every poll; one long-running
 * connection keeps the console clean and skips the reconnect overhead.
 */

const TYPE_AUTH = 3
const TYPE_COMMAND = 2

function packet(id: number, type: number, body: string): Buffer {
  const b = Buffer.from(body, 'utf8')
  const p = Buffer.alloc(14 + b.length)
  p.writeInt32LE(10 + b.length, 0) // length of the rest
  p.writeInt32LE(id, 4)
  p.writeInt32LE(type, 8)
  b.copy(p, 12)
  // Two trailing NULs (body terminator + empty string) are already zeroed by alloc.
  return p
}

interface Pending {
  resolve: (response: string) => void
  reject: (err: Error) => void
  response: string
  /** Long responses span several packets; settle briefly before resolving. */
  settle: ReturnType<typeof setTimeout> | null
  deadline: ReturnType<typeof setTimeout>
}

interface AuthWaiter {
  resolve: () => void
  reject: (err: Error) => void
  deadline: ReturnType<typeof setTimeout>
}

/** A reusable RCON connection to a local server. Reconnects lazily on the next exec. */
export class RconClient {
  private socket: Socket | null = null
  private buf = Buffer.alloc(0)
  private authed = false
  private pending: Pending | null = null
  private authWaiter: AuthWaiter | null = null
  /** Serializes commands so responses can't interleave. */
  private chain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly port: number,
    private readonly password: string
  ) {}

  get connected(): boolean {
    return this.authed && this.socket !== null
  }

  /** Run one command, connecting + authenticating first when needed. */
  exec(command: string, timeoutMs = 4000): Promise<string> {
    const run = this.chain.then(async () => {
      if (!this.connected) await this.connect(timeoutMs)
      return this.send(command, timeoutMs)
    })
    // Keep the chain alive after failures; the failed exec still rejects to its caller.
    this.chain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  /** Drop the connection (server stopped / poller shutting down). */
  close(): void {
    this.destroy(new Error('RCON closed'))
  }

  private connect(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new Socket()
      this.socket = socket
      this.buf = Buffer.alloc(0)
      this.authed = false
      this.authWaiter = {
        resolve,
        reject,
        deadline: setTimeout(() => this.destroy(new Error('RCON timed out')), timeoutMs)
      }
      socket.on('error', (err) => this.destroy(err))
      socket.on('close', () => this.destroy(new Error('RCON closed')))
      socket.on('data', (d: Buffer) => this.onData(d))
      socket.connect(this.port, '127.0.0.1', () => socket.write(packet(1, TYPE_AUTH, this.password)))
    })
  }

  /** Tear the socket down and fail whatever was waiting on it. */
  private destroy(err: Error): void {
    const socket = this.socket
    if (socket) {
      this.socket = null
      socket.removeAllListeners()
      socket.destroy()
    }
    this.authed = false
    this.buf = Buffer.alloc(0)
    const w = this.authWaiter
    if (w) {
      clearTimeout(w.deadline)
      this.authWaiter = null
      w.reject(err)
    }
    const p = this.pending
    if (p) {
      if (p.settle) clearTimeout(p.settle)
      clearTimeout(p.deadline)
      this.pending = null
      p.reject(err)
    }
  }

  private send(command: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.authed) {
        reject(new Error('RCON not connected'))
        return
      }
      this.pending = {
        resolve,
        reject,
        response: '',
        settle: null,
        deadline: setTimeout(() => this.destroy(new Error('RCON timed out')), timeoutMs)
      }
      this.socket.write(packet(2, TYPE_COMMAND, command))
    })
  }

  private finishPending(): void {
    const p = this.pending
    if (!p) return
    if (p.settle) clearTimeout(p.settle)
    clearTimeout(p.deadline)
    this.pending = null
    p.resolve(p.response)
  }

  private onData(d: Buffer): void {
    this.buf = Buffer.concat([this.buf, d])
    while (this.buf.length >= 4) {
      const len = this.buf.readInt32LE(0)
      if (len < 10 || this.buf.length < 4 + len) break
      const id = this.buf.readInt32LE(4)
      const body = this.buf.toString('utf8', 12, 4 + len - 2)
      this.buf = this.buf.subarray(4 + len)
      if (!this.authed) {
        if (id === -1) {
          this.destroy(new Error('RCON auth failed'))
          return
        }
        this.authed = true
        const w = this.authWaiter
        if (w) {
          clearTimeout(w.deadline)
          this.authWaiter = null
          w.resolve()
        }
      } else if (this.pending) {
        const p = this.pending
        p.response += body
        if (p.settle) clearTimeout(p.settle)
        p.settle = setTimeout(() => this.finishPending(), 150)
      }
    }
  }
}
