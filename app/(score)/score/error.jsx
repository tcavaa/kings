'use client'

// Last resort for an error no screen caught: offer a reload instead of a blank page.
export default function ScoreError({ reset }) {
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}>
      <p>Something went wrong.</p>
      <button onClick={() => reset()}>Try again</button>
    </div>
  )
}
