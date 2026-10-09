import React, { useState, useEffect, useCallback } from 'react';
import type { DownloadInfo } from '@/types';
import { formatBytes } from '@/types';
import { Icon } from '@/components/Icon';

const STATUS_LABEL: Record<DownloadInfo['status'], string> = {
  queued: 'Waiting in the queue',
  metadata: 'Finding peers...',
  downloading: 'Downloading',
  paused: 'Paused',
  finalizing: 'Saving to library...',
  done: 'Saved to library',
  error: 'Failed',
};

export function DownloadsPage() {
  const [items, setItems] = useState<DownloadInfo[]>([]);

  const refresh = useCallback(() => {
    window.electronAPI.downloads.list().then(setItems).catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1000);
    return () => clearInterval(t);
  }, [refresh]);

  const act = async (fn: () => Promise<void>) => { await fn(); refresh(); };
  const hasFinished = items.some(i => i.status === 'done' || i.status === 'error');

  return (
    <div style={{ padding: 'calc(var(--nav-height) + var(--titlebar-offset, 28px) + 24px) 48px 48px', maxWidth: 1000 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-0.04em', marginBottom: 4 }}>Downloads</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            Movies are saved to your library folder when they finish.
          </p>
        </div>
        {hasFinished && (
          <button className="btn btn-ghost btn-sm" onClick={() => act(() => window.electronAPI.downloads.clear())}>
            Clear finished
          </button>
        )}
      </div>

      {items.length === 0 && (
        <div className="empty-state" style={{ paddingTop: 80 }}>
          <div className="empty-icon"><Icon name="download" /></div>
          <h2 className="empty-title">No downloads</h2>
          <p className="empty-subtitle">Use the download button on any movie in Home or Movies.</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {items.map(d => {
          const active = d.status === 'downloading' || d.status === 'queued' || d.status === 'metadata' || d.status === 'paused';
          const pct = Math.round(d.progress * 100);
          return (
            <div
              key={d.infoHash}
              style={{
                background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)', padding: '16px 20px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.title} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({d.year}) · {d.quality}</span>
                  </div>
                  <div style={{ fontSize: 13, color: d.status === 'error' ? 'var(--accent)' : 'var(--text-muted)', marginTop: 4 }}>
                    {d.status === 'error' ? d.error || STATUS_LABEL.error : STATUS_LABEL[d.status]}
                    {d.status === 'downloading' && (
                      <> · {formatBytes(d.downloadSpeed)}/s · {d.peers} peers · {formatBytes(d.downloaded)} of {formatBytes(d.size)}</>
                    )}
                    {d.status === 'paused' && <> · {formatBytes(d.downloaded)} of {formatBytes(d.size)}</>}
                  </div>
                </div>

                {active && (
                  <span style={{ fontSize: 14, fontWeight: 700, minWidth: 40, textAlign: 'right' }}>{pct}%</span>
                )}
                {d.status === 'done' && <span style={{ color: '#46d369', display: 'flex' }}><Icon name="check" size={22} /></span>}

                <div style={{ display: 'flex', gap: 4 }}>
                  {d.status === 'downloading' && (
                    <button className="icon-btn" title="Pause" onClick={() => act(() => window.electronAPI.downloads.pause(d.infoHash))}>
                      <Icon name="pause" />
                    </button>
                  )}
                  {d.status === 'paused' && (
                    <button className="icon-btn" title="Resume" onClick={() => act(() => window.electronAPI.downloads.resume(d.infoHash))}>
                      <Icon name="play" />
                    </button>
                  )}
                  {d.status !== 'finalizing' && (
                    <button
                      className="icon-btn"
                      title={active ? 'Cancel and delete partial file' : 'Remove from list'}
                      onClick={() => act(() => window.electronAPI.downloads.cancel(d.infoHash))}
                    >
                      <Icon name="close" />
                    </button>
                  )}
                </div>
              </div>

              {active && (
                <div style={{ height: 4, background: 'var(--bg-hover)', borderRadius: 2, marginTop: 14, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${pct}%`, background: d.status === 'paused' ? 'var(--text-muted)' : 'var(--accent)',
                    transition: 'width 600ms linear',
                  }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
