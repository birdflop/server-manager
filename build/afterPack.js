// electron-builder afterPack hook.
//
// Ad-hoc code-signs the macOS .app so Gatekeeper doesn't report it as "damaged"
// on Apple Silicon when downloaded (quarantined). An ad-hoc signature is a valid
// self-signature, so the app shows the normal "unidentified developer" prompt
// (right-click -> Open / "Open Anyway") instead of the scary "damaged" error.
//
// When a real Developer ID is configured (CSC_LINK set), this is skipped and
// electron-builder's own signing + notarization takes over.

const { execFileSync } = require('node:child_process')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.CSC_LINK) return // real signing configured — let electron-builder handle it

  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`
  console.log(`[afterPack] ad-hoc signing ${appPath}`)
  try {
    execFileSync('codesign', ['--deep', '--force', '--sign', '-', appPath], { stdio: 'inherit' })
  } catch (err) {
    console.error('[afterPack] ad-hoc signing failed:', err.message)
    throw err
  }
}
