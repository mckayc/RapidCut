import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  state = { error: null }
  static getDerivedStateFromError(e: unknown) {
    return { error: String(e) }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ background: '#0f1117', color: '#f87171', padding: 32, fontFamily: 'monospace', minHeight: '100vh' }}>
          <h2 style={{ marginBottom: 16 }}>React crash</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{this.state.error}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

window.onerror = (msg, src, line, col, err) => {
  document.body.innerHTML = `<div style="background:#0f1117;color:#f87171;padding:32px;font-family:monospace;white-space:pre-wrap">JS Error:\n${msg}\n${src}:${line}:${col}\n${err?.stack ?? ''}</div>`
}

window.onunhandledrejection = (e) => {
  console.error('Unhandled rejection:', e.reason)
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
