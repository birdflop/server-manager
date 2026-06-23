import { useEffect, useRef, type ReactElement } from 'react'
import { basicSetup } from 'codemirror'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState, Compartment, Prec, type Extension } from '@codemirror/state'
import { indentWithTab } from '@codemirror/commands'
import { StreamLanguage, syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { tags as t } from '@lezer/highlight'

// One compartment key (shared across instances is fine — it's reconfigured per view).
const languageConf = new Compartment()

/** Pick a CodeMirror language extension from a file name. Unknown types render as plain text. */
function languageFor(filename: string): Extension {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  switch (ext) {
    case 'json':
    case 'json5':
    case 'mcmeta':
      return json()
    case 'yml':
    case 'yaml':
      return yaml()
    case 'toml':
      return StreamLanguage.define(toml)
    case 'properties':
    case 'conf':
    case 'cfg':
    case 'ini':
    case 'env':
      return StreamLanguage.define(properties)
    default:
      return []
  }
}

// Colors are driven by the app's CSS variables so the editor tracks the light/dark toggle.
const brandTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--c-fg)', fontSize: '12.5px' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace',
    lineHeight: '1.55'
  },
  '.cm-content': { caretColor: 'var(--c-accent)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--c-fg-muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--c-accent) 7%, transparent)' },
  '.cm-activeLineGutter': {
    backgroundColor: 'color-mix(in srgb, var(--c-accent) 7%, transparent)',
    color: 'var(--c-fg)'
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--c-accent)' },
  '.cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--c-accent) 28%, transparent)'
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--c-accent) 28%, transparent)'
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--c-accent) 22%, transparent)',
    outline: '1px solid var(--c-accent)'
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--c-accent) 45%, transparent)'
  },
  '.cm-panels': { backgroundColor: 'var(--c-surface-2)', color: 'var(--c-fg)' },
  '.cm-panel.cm-search input': {
    backgroundColor: 'var(--c-input)',
    color: 'var(--c-fg)',
    border: '1px solid var(--c-border)'
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--c-surface-2)',
    border: '1px solid var(--c-border)',
    color: 'var(--c-fg)'
  },
  '.cm-matchingBracket': {
    backgroundColor: 'color-mix(in srgb, var(--c-accent) 25%, transparent)',
    outline: '1px solid var(--c-accent)'
  }
})

// Syntax colors chosen to read acceptably on both the light and dark brand palettes.
const brandHighlight = HighlightStyle.define([
  { tag: t.comment, color: '#8b8bb0', fontStyle: 'italic' },
  { tag: [t.string, t.special(t.string)], color: '#3fb6c9' },
  { tag: [t.number, t.bool, t.null], color: '#d98c4a' },
  { tag: [t.keyword, t.operatorKeyword], color: '#7b84e0' },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: '#4a9fe0' },
  { tag: [t.atom, t.labelName], color: '#7b84e0' },
  { tag: t.heading, color: '#54daf4', fontWeight: 'bold' },
  { tag: t.tagName, color: '#7b84e0' },
  { tag: t.invalid, color: '#ff6b6b' }
])

/**
 * A CodeMirror 6 editor for a single text file. The editor instance is created once;
 * external content changes (switching files) and language changes are applied via
 * transactions so the view—and its undo history—are preserved while typing.
 */
export function CodeEditor({
  value,
  filename,
  onChange
}: {
  value: string
  filename: string
  onChange: (v: string) => void
}): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current as HTMLDivElement,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          languageConf.of(languageFor(filename)),
          brandTheme,
          Prec.high(syntaxHighlighting(brandHighlight)),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString())
          })
        ]
      })
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Replace the whole document when the file we're editing changes underneath us.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        selection: { anchor: 0 }
      })
    }
  }, [value])

  // Re-apply syntax highlighting for the new file's type.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: languageConf.reconfigure(languageFor(filename)) })
  }, [filename])

  return <div ref={hostRef} className="h-full w-full overflow-hidden" />
}
