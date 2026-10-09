import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { ToastProvider } from './contexts/ToastContext'
import { MediaProvider } from './contexts/MediaContext'
import { ProfileProvider } from './contexts/ProfileContext'
import { clientAPI } from './services/api'
import './styles/globals.css'

// Desktop (Electron) only: lets the stylesheet drop the separate title strip
if (typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent)) document.documentElement.classList.add('is-desktop');

if (typeof window !== 'undefined' && !(window as any).electronAPI) {
  (window as any).electronAPI = clientAPI;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <MediaProvider>
        <ProfileProvider>
          <App />
        </ProfileProvider>
      </MediaProvider>
    </ToastProvider>
  </React.StrictMode>,
)
