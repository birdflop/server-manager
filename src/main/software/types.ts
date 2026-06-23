import type { Build, ServerType } from '@shared/types'

export type { Build }

export type InstallerFamily = 'forge' | 'neoforge' | 'quilt'

/** Everything the installer needs to materialize a server jar in an instance folder. */
export interface InstallSpec {
  kind: 'jar' | 'installer'
  /** Download URL for the server jar (kind=jar) or installer jar (kind=installer). */
  url: string
  /** Filename to save the download as inside the instance folder. */
  fileName: string
  /** For kind=installer: which installer family, so the runner knows how to invoke it. */
  installer?: InstallerFamily
  /** Extra context the installer runner needs (mc version, loader version, etc.). */
  meta?: Record<string, string>
}

/** A source of versions, builds, and downloads for one server software. */
export interface ServerProvider {
  id: ServerType
  /** Supported Minecraft versions, newest first. */
  listGameVersions(): Promise<string[]>
  /** Builds available for a given Minecraft version, newest first. */
  listBuilds(mc: string): Promise<Build[]>
  /** Resolve the concrete download for a (version, build) pair. */
  resolveInstall(mc: string, buildId: string): Promise<InstallSpec>
}
