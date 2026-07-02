import { Socket } from 'node:net'

/**
 * Minimal Minecraft RCON client (Source RCON protocol): connect, auth, run one
 * command, return its response. Used for silent command execution against local
 * servers (TPS polling) — one short-lived connection per call keeps this simple.
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

/** Run one command over RCON on 127.0.0.1 and resolve with the (possibly empty) response text. */
export function rconExec(
  port: number,
  password: string,
  command: string,
  timeoutMs = 4000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new Socket()
    let buf = Buffer.alloc(0)
    let authed = false
    let response = ''
    let settleTimer: ReturnType<typeof setTimeout> | null = null

    const cleanup = (): void => {
      if (settleTimer) clearTimeout(settleTimer)
      clearTimeout(deadline)
      socket.destroy()
    }
    const fail = (err: Error): void => {
      cleanup()
      reject(err)
    }
    const done = (): void => {
      cleanup()
      resolve(response)
    }
    const deadline = setTimeout(() => fail(new Error('RCON timed out')), timeoutMs)

    socket.on('error', fail)
    socket.on('close', () => (authed && response ? done() : fail(new Error('RCON closed'))))
    socket.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d])
      while (buf.length >= 4) {
        const len = buf.readInt32LE(0)
        if (len < 10 || buf.length < 4 + len) break
        const id = buf.readInt32LE(4)
        const body = buf.toString('utf8', 12, 4 + len - 2)
        buf = buf.subarray(4 + len)
        if (!authed) {
          if (id === -1) return fail(new Error('RCON auth failed'))
          authed = true
          socket.write(packet(2, TYPE_COMMAND, command))
        } else {
          response += body
          // Long responses span several packets; settle briefly before resolving.
          if (settleTimer) clearTimeout(settleTimer)
          settleTimer = setTimeout(done, 150)
        }
      }
    })
    socket.connect(port, '127.0.0.1', () => socket.write(packet(1, TYPE_AUTH, password)))
  })
}
