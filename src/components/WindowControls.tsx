import { useState, useEffect } from 'react';
import { Icon } from './Icon';

/** Minimise / maximise / close. Fixed to the top-right corner of the window so no layout, scroll position or
 *  narrow window can push it out of reach. Desktop (Electron) only. */
export function WindowControls({ inline = false }: { inline?: boolean }) {
  const api = window.electronAPI.window;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    api.isMaximized?.().then(setMaximized).catch(() => undefined);
    return api.onMaximizeChange?.(setMaximized);
  }, [api]);

  if (!document.documentElement.classList.contains('is-desktop')) return null;

  return (
    <div className={`window-controls ${inline ? 'inline' : ''}`}>
      <button className="window-btn" title="Minimize" onClick={() => api.minimize()}><Icon name="minimize" size={18} /></button>
      <button className="window-btn" title={maximized ? 'Restore' : 'Maximize'} onClick={() => api.maximize()}>
        <Icon name={maximized ? 'restore' : 'maximize'} size={16} />
      </button>
      <button className="window-btn close" title="Close" onClick={() => api.close()}><Icon name="close" size={18} /></button>
    </div>
  );
}
