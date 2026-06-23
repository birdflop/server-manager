/**
 * Recommended Java major version for a given Minecraft version.
 *  - 1.20.5+      -> Java 21
 *  - 1.17 – 1.20.4 -> Java 17
 *  - <= 1.16      -> Java 8
 * Snapshots / unparseable versions default to the latest (21).
 */
export function requiredJavaMajor(mc: string): number {
  const parts = mc.split('.')
  // Calendar-style versions (e.g. "26.2") and snapshots ("26w14a") use modern Java.
  if (Number(parts[0]) !== 1) return 21
  const minor = Number(parts[1])
  const patch = Number(parts[2] ?? '0')
  if (!Number.isFinite(minor)) return 21
  if (minor >= 21) return 21
  if (minor === 20 && patch >= 5) return 21
  if (minor >= 17) return 17
  return 8
}

/** Whether a detected Java major can run a server needing `required`. */
export function javaSatisfies(installedMajor: number, required: number): boolean {
  // Newer Java generally runs older servers fine, except very old ones (Java 8-era)
  // can break on modern JDKs. We accept >= required, and also allow 17 for the 8 case.
  if (required === 8) return installedMajor === 8 || installedMajor === 11 || installedMajor === 17
  return installedMajor >= required
}
