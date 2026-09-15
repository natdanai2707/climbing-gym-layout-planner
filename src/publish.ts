/**
 * Publishing a layout back into the app.
 *
 * The planner is a static site on GitHub Pages — there is no server of ours to
 * save to. What there is, is the repository the site is built from: the bundled
 * layouts are plain JSON files in it, and GitHub's contents API will take a
 * commit straight from the browser given a token. Committing to the deploy
 * branch is what makes a layout show up on every device, because the Pages
 * workflow rebuilds the site from that commit.
 *
 * So "Save to Layout 1" = one commit to src/layouts/layout1.json on main, and a
 * minute later the phone, the laptop and anyone with the link all open it.
 */

export const REPO = {
  owner: 'natdanai2707',
  repo: 'climbing-gym-layout-planner',
  branch: 'main',
}

const TOKEN_KEY = 'gym-gh-token-v1'

export function loadToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveToken(t: string) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // private window / storage disabled — the token just won't be remembered
  }
}

// btoa() only handles bytes, and a layout is UTF-8 text; go through the encoder
// and chunk it so a 200 KB file doesn't blow the argument limit of apply().
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }
}

const contentsUrl = (path: string) =>
  `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/contents/${path}`

async function currentSha(path: string, token: string): Promise<string | undefined> {
  const r = await fetch(`${contentsUrl(path)}?ref=${REPO.branch}`, { headers: headers(token) })
  if (r.status === 404) return undefined // new file
  if (!r.ok) throw await describe(r)
  const j = (await r.json()) as { sha?: string }
  return j.sha
}

// GitHub's errors are the ones worth reading out loud: a bad token and a token
// without access to this repo both look like "it didn't work" otherwise.
async function describe(r: Response): Promise<Error> {
  let detail = ''
  try {
    const j = (await r.json()) as { message?: string }
    detail = j.message ?? ''
  } catch {
    // no JSON body
  }
  if (r.status === 401) return new Error('GitHub rejected the token (401). It may be wrong or expired.')
  if (r.status === 403) return new Error(`GitHub refused (403). ${detail || 'The token may lack Contents write access.'}`)
  if (r.status === 404)
    return new Error(
      `Not found (404). The token needs access to ${REPO.owner}/${REPO.repo} with Contents: Read and write.`,
    )
  if (r.status === 409) return new Error('Someone else saved first (409). Try again.')
  return new Error(`GitHub error ${r.status}. ${detail}`)
}

export interface PublishResult {
  commitUrl: string
  sha: string
}

/** Commit `text` to `path` on the deploy branch, creating the file if need be. */
export async function publishFile(
  path: string,
  text: string,
  message: string,
  token: string,
): Promise<PublishResult> {
  const sha = await currentSha(path, token)
  const r = await fetch(contentsUrl(path), {
    method: 'PUT',
    headers: headers(token),
    body: JSON.stringify({ message, content: toBase64(text), branch: REPO.branch, sha }),
  })
  if (!r.ok) throw await describe(r)
  const j = (await r.json()) as { commit?: { sha?: string; html_url?: string } }
  return { commitUrl: j.commit?.html_url ?? '', sha: j.commit?.sha ?? '' }
}
