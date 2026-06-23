import { useState, type ReactElement } from 'react'
import { Loader2, ChevronLeft, Check, AlertCircle, Server } from 'lucide-react'
import type { InstallProgress, ServerType } from '@shared/types'
import { SERVER_TYPE_MAP } from '@shared/software'
import { Modal } from '../../components/Modal'
import { useApp } from '../../store'
import { StepSoftware } from './StepSoftware'
import { StepVersion } from './StepVersion'
import { StepConfigure, type ConfigureForm } from './StepConfigure'

type Step = 'software' | 'version' | 'configure'
const STEP_ORDER: Step[] = ['software', 'version', 'configure']
const STEP_LABELS: Record<Step, string> = {
  software: 'Software',
  version: 'Version',
  configure: 'Configure'
}

export default function CreateInstanceWizard(): ReactElement {
  const closeWizard = useApp((s) => s.closeWizard)
  const openTab = useApp((s) => s.openTab)
  const refreshIndex = useApp((s) => s.refreshIndex)
  const defaults = useApp((s) => s.config)

  const [step, setStep] = useState<Step>('software')
  const [serverType, setServerType] = useState<ServerType>()
  const [mcVersion, setMcVersion] = useState<string>()
  const [build, setBuild] = useState<string>()
  const [form, setForm] = useState<ConfigureForm>({
    name: '',
    port: 25565,
    ramMB: defaults?.defaultRamMB ?? 2048,
    javaPath: defaults?.defaultJavaPath ?? '',
    jvmArgs: '',
    eula: false
  })

  const [creating, setCreating] = useState(false)
  const [progress, setProgress] = useState<InstallProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const update = (patch: Partial<ConfigureForm>): void => setForm((f) => ({ ...f, ...patch }))

  function goTo(next: Step): void {
    // Suggest a default name when first reaching the configure step.
    if (next === 'configure' && !form.name && serverType && mcVersion) {
      update({ name: `${SERVER_TYPE_MAP[serverType].label} ${mcVersion}` })
    }
    setStep(next)
  }

  const stepIndex = STEP_ORDER.indexOf(step)
  const canAdvance =
    (step === 'software' && !!serverType) ||
    (step === 'version' && !!mcVersion && !!build) ||
    step === 'configure'
  const canCreate = !!form.name.trim() && !!form.javaPath

  async function create(): Promise<void> {
    if (!serverType || !mcVersion || !build) return
    setCreating(true)
    setError(null)
    setProgress({ phase: 'resolve' })
    const unsub = window.api.onInstallProgress(setProgress)
    try {
      const { instance } = await window.api.createInstance({
        name: form.name.trim(),
        serverType,
        mcVersion,
        build,
        port: form.port,
        ramMB: form.ramMB,
        javaPath: form.javaPath,
        jvmArgs: form.jvmArgs.split(/\s+/).filter(Boolean),
        eulaAccepted: form.eula,
        groupId: null
      })
      await refreshIndex()
      openTab(instance.id)
      closeWizard()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      unsub()
      setCreating(false)
    }
  }

  const footer = creating ? (
    <span className="text-sm text-fg-muted">Creating…</span>
  ) : (
    <>
      {stepIndex > 0 && (
        <button
          onClick={() => setStep(STEP_ORDER[stepIndex - 1])}
          className="inline-flex items-center gap-1 rounded-brand px-3 py-2 text-sm text-fg-muted transition hover:bg-surface-2 hover:text-fg"
        >
          <ChevronLeft size={16} /> Back
        </button>
      )}
      <div className="flex-1" />
      {step !== 'configure' ? (
        <button
          disabled={!canAdvance}
          onClick={() => goTo(STEP_ORDER[stepIndex + 1])}
          className="rounded-brand bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
        >
          Next
        </button>
      ) : (
        <button
          disabled={!canCreate}
          onClick={() => void create()}
          className="inline-flex items-center gap-2 rounded-brand bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition hover:brightness-110 disabled:opacity-40"
        >
          <Check size={16} /> Create server
        </button>
      )}
    </>
  )

  return (
    <Modal title="Create new instance" onClose={creating ? () => {} : closeWizard} wide footer={footer}>
      {/* Stepper */}
      <div className="mb-5 flex items-center gap-2">
        {STEP_ORDER.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                i <= stepIndex ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-fg-muted'
              }`}
            >
              {i + 1}
            </span>
            <span className={`text-sm ${i === stepIndex ? 'text-fg' : 'text-fg-muted'}`}>
              {STEP_LABELS[s]}
            </span>
            {i < STEP_ORDER.length - 1 && <span className="mx-1 h-px w-6 bg-border" />}
          </div>
        ))}
      </div>

      {creating ? (
        <CreatingView progress={progress} error={error} />
      ) : (
        <>
          {step === 'software' && <StepSoftware value={serverType} onSelect={setServerType} />}
          {step === 'version' && serverType && (
            <StepVersion
              serverType={serverType}
              mcVersion={mcVersion}
              build={build}
              onPickVersion={(v) => {
                setMcVersion(v)
                setBuild(undefined)
              }}
              onPickBuild={setBuild}
            />
          )}
          {step === 'configure' && mcVersion && (
            <StepConfigure mcVersion={mcVersion} form={form} update={update} />
          )}
        </>
      )}
    </Modal>
  )
}

function CreatingView({
  progress,
  error
}: {
  progress: InstallProgress | null
  error: string | null
}): ReactElement {
  const pct =
    progress?.phase === 'download' && progress.total
      ? Math.round((progress.received! / progress.total) * 100)
      : null
  const phaseText: Record<InstallProgress['phase'], string> = {
    resolve: 'Resolving download…',
    download: 'Downloading server…',
    install: 'Running installer…',
    configure: 'Writing config…',
    done: 'Done!',
    error: 'Error'
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-brand border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
        <AlertCircle size={16} /> {error}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-accent/15 text-accent">
        <Server size={26} />
      </span>
      <div className="flex items-center gap-2 text-sm text-fg-muted">
        <Loader2 className="animate-spin" size={16} />
        {progress ? phaseText[progress.phase] : 'Starting…'}
      </div>
      {pct !== null && (
        <div className="h-2 w-64 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}
