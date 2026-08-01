/**
 * Strip Electron's IPC wrapper ("Error invoking remote method '…': Error: ")
 * from errors so the main process's friendly messages reach the user intact.
 */
export function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
