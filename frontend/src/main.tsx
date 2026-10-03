import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@fontsource-variable/mona-sans/wdth.css'
import '@fontsource/mukta/400.css'
import '@fontsource/mukta/600.css'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Offline support for the public portal (see public/sw.js). Staff screens are network-only by design.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* unsupported context */ }); });
}
