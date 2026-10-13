// Small pieces the /admin tabs share.

export const muted = { color: 'rgba(225,233,225,0.55)' }

export const inputStyle = {
  background: '#252b24',
  border: '1px solid #46513e',
  color: '#eff1e8',
}

/** Run an admin call: a rejected passcode locks the page, any other error is shown. */
export async function adminCall(fn, { onLocked, onError }) {
  try {
    return await fn()
  } catch (err) {
    if ((err.message || '').includes('HTTP 401')) onLocked()
    else onError(err.message.replace(/^HTTP \d+: /, ''))
    return undefined
  }
}

export function ErrorNote({ text }) {
  if (!text) return null
  return (
    <div role="alert" className="mb-4 px-4 py-3 text-sm"
         style={{ background: 'rgba(239,145,139,0.12)', border: '1px solid rgba(239,145,139,0.4)', color: '#ef918b' }}>
      {text}
    </div>
  )
}

export function PanelTitle({ children }) {
  return (
    <h2 className="text-sm uppercase tracking-wider mb-3" >
      {children}
    </h2>
  )
}
