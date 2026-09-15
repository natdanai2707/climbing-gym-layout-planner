import { useEffect, useState } from 'react'

import { LAYOUT_PRESETS } from '../layouts'
import { REPO, loadToken, publishFile, saveToken } from '../publish'
import { exportLayout, useStore } from '../store'

/**
 * "Save to Layout N" — writes what is on screen into one of the bundled layout
 * slots so every device opens it, instead of the JSON having to be exported and
 * put back by hand.
 *
 * It commits to the repository the site is built from, which needs a GitHub
 * token; the token is kept in this browser only and never leaves it except as
 * the Authorization header on the save itself.
 */
export function PublishDialog({ onClose }: { onClose: () => void }) {
  const presetId = useStore((s) => s.presetId)
  const objects = useStore((s) => s.objects)
  const savable = LAYOUT_PRESETS.filter((p) => p.path)
  const [target, setTarget] = useState(savable.some((p) => p.id === presetId) ? presetId : savable[0].id)
  const [token, setToken] = useState(loadToken())
  // remembering is the point of the feature — nobody types a PAT on a phone twice
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ url: string } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const preset = savable.find((p) => p.id === target)

  const save = async () => {
    if (!preset?.path || !token.trim()) return
    setBusy(true)
    setError('')
    try {
      const text = JSON.stringify(exportLayout(), null, 2) + '\n'
      const res = await publishFile(
        preset.path,
        text,
        `Update ${preset.name} from the planner (${objects.length} objects)`,
        token.trim(),
      )
      saveToken(remember ? token.trim() : '')
      setDone({ url: res.commitUrl })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pub-backdrop" onClick={onClose}>
      <div className="pub-card" onClick={(e) => e.stopPropagation()}>
        <h2>Save to a layout</h2>

        {done ? (
          <>
            <p className="pub-ok">
              Saved to <strong>{preset?.name}</strong>. The site rebuilds itself from this commit — give it about a
              minute, then reload and pick {preset?.name} to see it on any device.
            </p>
            {done.url && (
              <p>
                <a href={done.url} target="_blank" rel="noreferrer">
                  View the commit
                </a>
              </p>
            )}
            <div className="pub-actions">
              <button className="save" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="pub-note">
              Writes what is on screen ({objects.length} objects) into a bundled layout, so every device opens it.
            </p>

            <label className="pub-field">
              <span>Save into</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                {savable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.id === presetId ? ' (open now)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="pub-field">
              <span>GitHub token</span>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="github_pat_..."
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            <label className="pub-check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span>Remember the token on this device</span>
            </label>

            <details className="pub-help">
              <summary>Where do I get a token?</summary>
              <p>
                GitHub → Settings → Developer settings → Fine-grained personal access tokens → Generate new token. Give
                it access to <code>{REPO.owner}/{REPO.repo}</code> only, and under Repository permissions set{' '}
                <strong>Contents: Read and write</strong>. Nothing else is needed.
              </p>
              <p>
                It is stored in this browser and sent only to GitHub. Anyone who can unlock this device can use it, so
                give it a short expiry and keep it to this one repository.
              </p>
            </details>

            {error && <p className="pub-error">{error}</p>}

            <div className="pub-actions">
              <button onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button className="save" onClick={save} disabled={busy || !token.trim()}>
                {busy ? 'Saving…' : `Save to ${preset?.name ?? ''}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
