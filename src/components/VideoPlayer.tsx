import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Movie, SubtitleContext, AudioTrackInfo, ChapterInfo } from '@/types';
import { langName } from '@/lib/lang3';
import { formatSeconds, getProgressPercent } from '@/types';
import { useMedia } from '@/contexts/MediaContext';
import { useToast } from '@/contexts/ToastContext';
import { Icon } from './Icon';
import { useCaptions, CaptionsOverlay, CaptionsMenu } from './Captions';
import { useCast, castTargetOf, CastMenu, CastPanel } from './Cast';
import { SpeedMenu } from './SpeedMenu';
import { WindowControls } from './WindowControls';

interface VideoPlayerProps {
  /** Library movie to play. Omit when streaming from an explicit `src` (e.g. a torrent). */
  movie?: Movie;
  /** Explicit stream URL; overrides the library media URL. */
  src?: string;
  title?: string;
  /** Shown over the video while it is buffering (e.g. torrent download stats). */
  statusText?: string;
  startPosition?: number;
  /** Enables captions: what the player needs to find subtitles for this title. */
  subtitleContext?: SubtitleContext;
  /** The next episode of a streamed series: shown as an Up next card near the end. */
  nextUp?: { label: string; onPlay: () => void };
  /** True for episodes: enables the Skip intro shortcut. */
  episodeMode?: boolean;
  onClose: () => void;
  onProgressUpdate: (position: number, duration: number) => void;
}

export function VideoPlayer({ movie, src, title, statusText, startPosition = 0, subtitleContext, nextUp, episodeMode, onClose, onProgressUpdate }: VideoPlayerProps) {
  const { getMediaUrl } = useMedia();
  const { showToast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const progressSaveTimerRef = useRef<ReturnType<typeof setInterval>>();

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(startPosition);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('player_volume');
    return saved ? parseFloat(saved) : 1;
  });
  const [isMuted, setIsMuted] = useState(false);
  const rememberVolumeRef = useRef(true);

  // Playback settings: default speed, and whether the volume is remembered between videos
  useEffect(() => {
    const s = window.electronAPI.settings;
    s.get('defaultSpeed').then(v => { const n = parseFloat(v); if (n > 0 && n <= 4) { setPlaybackSpeed(n); if (videoRef.current) videoRef.current.playbackRate = n; } }).catch(() => undefined);
    s.get('rememberVolume').then(v => {
      rememberVolumeRef.current = v !== 'false';
      if (v === 'false') { setVolume(1); if (videoRef.current) videoRef.current.volume = 1; }
    }).catch(() => undefined);
  }, []);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showPip, setShowPip] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isBuffering, setIsBuffering] = useState(true);

  // Captions (desktop only: the hook reports supported=false when the backend is missing)
  const cc = useCaptions(subtitleContext);
  const ccRef = useRef(cc);
  ccRef.current = cc;
  const ccMenuOpenRef = useRef(false);
  const [ccMenuOpen, setCcMenuOpen] = useState(false);

  // Audio tracks / chapters reported by the probe, and the per-title choices remembered between sessions
  const [audioTracks, setAudioTracks] = useState<AudioTrackInfo[]>([]);
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [audioOrd, setAudioOrd] = useState(0);
  const [audioMenuOpen, setAudioMenuOpen] = useState(false);
  const prefScope = subtitleContext ? (subtitleContext.imdbId || subtitleContext.title) : '';
  const [ended, setEnded] = useState(false);
  const [nextDismissed, setNextDismissed] = useState(false);
  const [countdown, setCountdown] = useState(10);

  const mediaUrl = src ?? getMediaUrl(movie!.id);
  const displayTitle = title ?? movie?.title ?? '';

  // Playback mode: the media server probes the file and tells us whether Chromium can play it
  // directly or whether it must be transcoded (H.264 + AAC fragmented MP4 via FFmpeg).
  // In transcode mode the stream is not seekable, so seeking restarts it at `offset` seconds.
  const [mode, setMode] = useState<'probing' | 'direct' | 'transcode'>('probing');
  const [offset, setOffset] = useState(0);
  // Where the converted stream really begins (copied video starts on a keyframe, slightly before `offset`)
  const [streamStart, setStreamStart] = useState<number | null>(null);
  const [probedDuration, setProbedDuration] = useState(0);
  const modeRef = useRef(mode);
  const offsetRef = useRef(0);
  const durationRef = useRef(0);
  modeRef.current = mode;
  offsetRef.current = streamStart ?? offset;

  // Casting to a TV (desktop only): the TV pulls the same loopback stream through a LAN proxy
  const castRef = useRef<ReturnType<typeof useCast> | null>(null);
  const pauseLocal = useCallback(() => { videoRef.current?.pause(); }, []);
  const cast = useCast({
    target: castTargetOf(mediaUrl),
    title: displayTitle,
    getPosition: () => offsetRef.current + (videoRef.current?.currentTime || 0),
    cues: cc.cues,
    delay: cc.delay,
    onStarted: pauseLocal,
  });
  castRef.current = cast;

  const infoUrl = mediaUrl.replace(/^((?:https?:\/\/[^/]+)?)\/(media|torrent)\//, '$1/info/$2/');
  const transcodeUrl = mediaUrl.replace(/^((?:https?:\/\/[^/]+)?)\/(media|torrent)\//, '$1/transcode/$2/');
  const knownDuration = probedDuration || (movie?.duration ? movie.duration * 60 : 0);

  useEffect(() => {
    let cancelled = false;
    setMode('probing');
    setIsBuffering(true);
    fetch(infoUrl)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(async info => {
        if (cancelled) return;
        setProbedDuration(info.duration || 0);
        const tracks: AudioTrackInfo[] = info.audioTracks || [];
        setAudioTracks(tracks);
        setChapters(info.chapters || []);
        let want = 0;
        try {
          const pref = prefScope ? await window.electronAPI.prefs?.get(prefScope) : null;
          if (pref?.audioLang) { const i = tracks.findIndex(tr => tr.lang === pref.audioLang); if (i > 0) want = i; }
        } catch { /* remembered choice is optional */ }
        if (cancelled) return;
        setAudioOrd(want);
        if (info.direct && want === 0) {
          setMode('direct');
        } else {
          setOffset(startPosition);
          setMode('transcode');
        }
      })
      .catch(() => { if (!cancelled) setMode('direct'); });
    return () => { cancelled = true; };
  }, [infoUrl]);

  const keyframeUrl = mediaUrl.replace(/^((?:https?:\/\/[^/]+)?)\/(media|torrent)\//, '$1/keyframe/$2/');
  useEffect(() => {
    setStreamStart(null);
    if (mode !== 'transcode' || offset <= 0) return;
    let cancelled = false;
    fetch(`${keyframeUrl}?start=${Math.floor(offset)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (!cancelled && j && typeof j.start === 'number') setStreamStart(j.start); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [mode, offset, keyframeUrl]);

  const currentSrc = mode === 'transcode' ? `${transcodeUrl}?start=${Math.floor(offset)}&audio=${audioOrd}` : mediaUrl;

  const getTime = () => offsetRef.current + (videoRef.current?.currentTime || 0);
  const getDuration = () =>
    modeRef.current === 'transcode' ? durationRef.current : (videoRef.current?.duration || 0);

  const seekTo = (t: number) => {
    const video = videoRef.current;
    if (!video) return;
    const dur = getDuration();
    const target = Math.max(0, dur > 0 ? Math.min(dur - 1, t) : t);
    if (modeRef.current === 'transcode') {
      setOffset(target);
      setCurrentTime(target);
      setIsBuffering(true);
    } else {
      video.currentTime = target;
    }
  };
  const seekRef = useRef(seekTo);
  seekRef.current = seekTo;

  // Initialize video
  useEffect(() => {
    const video = videoRef.current;
    if (!video || mode === 'probing') return;

    video.src = currentSrc;
    video.volume = volume;
    video.playbackRate = playbackSpeed;
    if (mode === 'transcode') {
      durationRef.current = knownDuration;
      setDuration(knownDuration);
    }

    const handleLoaded = () => {
      if (mode === 'direct' && startPosition > 0 && startPosition < video.duration - 5) {
        video.currentTime = startPosition;
      }
      video.play().catch(err => {
        console.error('Play failed:', err);
        setIsPlaying(false);
      });
    };

    const handleTimeUpdate = () => {
      if (!isDragging) {
        setCurrentTime(offsetRef.current + video.currentTime);
      }
    };

    const handleDurationChange = () => {
      if (mode === 'direct') setDuration(video.duration);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleWaiting = () => setIsBuffering(true);
    const handleReady = () => setIsBuffering(false);
    const handleError = () => {
      const err = video.error;
      if (mode === 'direct') {
        // Chromium can't decode this file — fall back to FFmpeg transcoding at the current position.
        const resumeAt = video.currentTime || startPosition;
        setOffset(resumeAt);
        setIsBuffering(true);
        setMode('transcode');
        return;
      }
      if (err?.code === 4) {
        setError('This video format may not be supported. Try converting to MP4 or install appropriate codecs.');
      } else {
        setError(`Video playback error: ${err?.message || 'Unknown error'}`);
      }
    };

    const handleEnded = () => setEnded(true);
    setEnded(false);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('loadeddata', handleLoaded);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('durationchange', handleDurationChange);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('error', handleError);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handleReady);
    video.addEventListener('canplay', handleReady);

    return () => {
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handleReady);
      video.removeEventListener('canplay', handleReady);
      video.removeEventListener('loadeddata', handleLoaded);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('durationchange', handleDurationChange);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('error', handleError);
    };
  }, [currentSrc, mode, startPosition]);

  // Leaving the player must fully stop the video: a picture-in-picture window or a detached element
  // would otherwise keep playing (and could not be closed) while another movie starts.
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      try { if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => undefined); } catch { /* not in PiP */ }
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    };
  }, []);

  // Save progress periodically
  useEffect(() => {
    progressSaveTimerRef.current = setInterval(() => {
      const video = videoRef.current;
      const c = castRef.current?.status;
      if (c?.active) {
        if (c.position > 0 && c.duration > 0) onProgressUpdate(c.position, c.duration);
      } else if (video && !video.paused && getTime() > 0) {
        onProgressUpdate(getTime(), getDuration());
      }
    }, 5000);

    return () => {
      clearInterval(progressSaveTimerRef.current);
      // Save on unmount
      if (videoRef.current && getTime() > 0) {
        onProgressUpdate(getTime(), getDuration());
      }
    };
  }, [onProgressUpdate]);

  // Controls auto-hide
  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused && !ccMenuOpenRef.current) {
        setShowControls(false);
      }
    }, 3000);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;

      showControlsTemporarily();

      // While casting the keyboard drives the TV instead of the (paused) local video
      const c = castRef.current;
      if (c?.casting && c.status) {
        const handled = (() => {
          switch (e.key) {
            case ' ': case 'k': c.control(c.status!.state === 'paused' ? 'play' : 'pause'); return true;
            case 'ArrowLeft': c.control('seek', c.status!.position - 10); return true;
            case 'ArrowRight': c.control('seek', c.status!.position + 10); return true;
            case 'ArrowUp': c.control('volume', Math.min(1, c.status!.volume + 0.1)); return true;
            case 'ArrowDown': c.control('volume', Math.max(0, c.status!.volume - 0.1)); return true;
            default: return false;
          }
        })();
        if (handled) { e.preventDefault(); return; }
      }

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          if (video.paused) video.play();
          else video.pause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekRef.current(getTime() - 10);
          showToast('-10s');
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekRef.current(getTime() + 10);
          showToast('+10s');
          break;
        case 'ArrowUp':
          e.preventDefault();
          video.volume = Math.min(1, video.volume + 0.1);
          setVolume(video.volume);
          break;
        case 'ArrowDown':
          e.preventDefault();
          video.volume = Math.max(0, video.volume - 0.1);
          setVolume(video.volume);
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          toggleMute();
          break;
        case 'c':
        case 'C':
          e.preventDefault();
          ccRef.current.toggle();
          break;
        case 'Escape':
          if (!document.fullscreenElement) {
            handleClose();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [showControlsTemporarily]);

  // Fullscreen change
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play();
    else video.pause();
    showControlsTemporarily();
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  const toggleFullscreen = async () => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await container.requestFullscreen();
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTo(ratio * duration);
    if (mode !== 'transcode') setCurrentTime(video.currentTime);
  };

  const handleSeekHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setSeekPreview(ratio * duration);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    const video = videoRef.current;
    if (video) video.volume = v;
    setVolume(v);
    setIsMuted(v === 0);
    if (rememberVolumeRef.current) localStorage.setItem('player_volume', String(v));
  };

  const handleSpeedChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const speed = parseFloat(e.target.value);
    const video = videoRef.current;
    if (video) video.playbackRate = speed;
    setPlaybackSpeed(speed);
  };

  // Stop casting and carry on watching here from where the TV got to
  const stopCasting = async () => {
    const pos = await cast.stop();
    if (pos > 0) seekRef.current(pos);
    videoRef.current?.play().catch(() => undefined);
  };

  const handleClose = () => {
    const video = videoRef.current;
    const castStatus = castRef.current?.status;
    if (castStatus?.active) {
      onProgressUpdate(castStatus.position, castStatus.duration);
      castRef.current?.stop();
    }
    if (video && !castStatus?.active) {
      onProgressUpdate(getTime(), getDuration());
      video.pause();
    }
    try { if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => undefined); } catch { /* not in PiP */ }
    if (document.fullscreenElement) document.exitFullscreen();
    onClose();
  };

  const skipSeconds = (secs: number) => {
    const video = videoRef.current;
    if (!video) return;
    seekTo(getTime() + secs);
    showControlsTemporarily();
  };

  // Switching audio re-encodes the stream from the current position with the chosen track
  const changeAudio = (ord: number) => {
    if (ord === audioOrd) return;
    const here = getTime();
    setAudioOrd(ord);
    setOffset(here);
    setCurrentTime(here);
    setIsBuffering(true);
    setMode('transcode');
    const lang = audioTracks[ord]?.lang;
    if (prefScope && lang) window.electronAPI.prefs?.set(prefScope, { audioLang: lang }).catch(() => undefined);
    setAudioMenuOpen(false);
    ccMenuOpenRef.current = false;
  };

  // Skip intro: use a chapter called Intro/Opening when the file has one, else offer a fixed jump early in episodes
  const introChapter = chapters.find(c => /\b(intro|opening|op)\b/i.test(c.title) && currentTime >= c.start - 1 && currentTime < c.end - 2);
  const guessIntro = !introChapter && episodeMode && chapters.length === 0 && currentTime >= 5 && currentTime < 200;
  const skipIntro = () => seekTo(introChapter ? introChapter.end : getTime() + 85);

  // Up next: in the last 30 seconds (or when the video ends), count down and play the next episode
  const nearEnd = duration > 90 && currentTime > 60 && duration - currentTime <= 30;
  const showNext = !!nextUp && !nextDismissed && (nearEnd || ended);
  useEffect(() => {
    if (!showNext) { setCountdown(10); return; }
    const timer = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(timer);
  }, [showNext]);
  useEffect(() => {
    if (showNext && countdown <= 0) nextUp!.onPlay();
  }, [showNext, countdown]);

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="player-overlay">
      <div
        ref={containerRef}
        className="player-container cursor-visible"
        onMouseMove={showControlsTemporarily}
        onClick={togglePlay}
      >
        {error ? (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', color: 'white', gap: 16, padding: 48,
            textAlign: 'center', background: '#000',
          }}>
            <Icon name="warning" size={48} />
            <h2>Playback Error</h2>
            <p style={{ color: '#aaa', maxWidth: 480 }}>{error}</p>
            <p style={{ fontSize: 12, color: '#666' }}>
              MKV files may require additional codecs. Consider using VLC codec pack or converting to MP4.
            </p>
            <button className="btn btn-ghost" onClick={handleClose}><Icon name="back" /> Back</button>
          </div>
        ) : (
          <video
            ref={videoRef}
            className="player-video"
            poster="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
            onClick={e => e.stopPropagation()}
            onDoubleClick={toggleFullscreen}
          />
        )}

        {/* Buffering indicator + optional stream stats (outside the overlay so it never auto-hides) */}
        {isBuffering && !error && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
            pointerEvents: 'none', color: 'white', textAlign: 'center', zIndex: 5,
          }}>
            <div className="spinner" />
            {statusText && <span style={{ fontSize: 13, color: '#ccc' }}>{statusText}</span>}
          </div>
        )}

        {!error && !cast.casting && (introChapter || guessIntro) && (
          <button className="player-float-btn" style={{ right: 32, bottom: 120 }} onClick={e => { e.stopPropagation(); skipIntro(); }}
            title={introChapter ? 'Skip to the end of the intro' : 'Jump ahead 85 seconds'}>
            <Icon name="skipForward" size={18} /> {introChapter ? 'Skip intro' : 'Skip ahead 85s'}
          </button>
        )}

        {!error && !cast.casting && showNext && nextUp && (
          <div className="up-next-card" onClick={e => e.stopPropagation()}>
            <div className="up-next-label">Up next in {Math.max(0, countdown)}s</div>
            <div className="up-next-title">{nextUp.label}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn btn-primary btn-sm" onClick={nextUp.onPlay}><Icon name="play" /> Play now</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setNextDismissed(true)}>Cancel</button>
            </div>
          </div>
        )}

        {cast.casting && <CastPanel cast={cast} title={displayTitle} onStop={stopCasting} onBack={handleClose} />}

        {/* Captions */}
        {!error && <CaptionsOverlay cc={cc} time={currentTime} raised={showControls || ccMenuOpen} />}

        {/* Controls overlay */}
        <div className={`player-controls-overlay ${showControls ? 'visible' : 'hidden'}`}>
          <div className="player-gradient" />

          {/* In full screen the player is the top layer, so it carries its own window buttons */}
          {isFullscreen && <WindowControls inline />}

          {/* Top bar */}
          <div className="player-top-bar">
            <button
              className="icon-btn"
              onClick={(e) => { e.stopPropagation(); handleClose(); }}
              style={{ color: 'white' }}
              title="Close (Esc)"
            >
              <Icon name="back" size={26} />
            </button>
            <span className="player-title">{displayTitle}</span>
          </div>

          {/* Center play/pause */}
          {!isPlaying && !isBuffering && (
            <div className="player-center-btn" onClick={(e) => { e.stopPropagation(); togglePlay(); }}>
              <Icon name="play" />
            </div>
          )}

          {/* Bottom bar */}
          <div className="player-bottom-bar" onClick={e => e.stopPropagation()}>
            {/* Seek bar */}
            <div
              className="seek-bar-container"
              onClick={handleSeek}
              onMouseMove={handleSeekHover}
              onMouseLeave={() => setSeekPreview(null)}
            >
              <div className="seek-bar">
                <div
                  className="seek-bar-fill"
                  style={{ width: `${progressPercent}%` }}
                />
                <div
                  className="seek-bar-thumb"
                  style={{ left: `${progressPercent}%` }}
                />
              </div>
            </div>

            <div className="player-controls">
              {/* Skip back */}
              <button
                className="icon-btn"
                style={{ color: 'white' }}
                onClick={() => skipSeconds(-10)}
                title="Skip back 10s (Left arrow)"
              >
                <Icon name="skipBack" size={26} />
              </button>

              {/* Play/Pause */}
              <button
                className="icon-btn"
                style={{ color: 'white', fontSize: 22 }}
                onClick={togglePlay}
                title="Play/Pause (Space)"
              >
                {isPlaying ? <Icon name="pause" /> : <Icon name="play" />}
              </button>

              {/* Skip forward */}
              <button
                className="icon-btn"
                style={{ color: 'white' }}
                onClick={() => skipSeconds(10)}
                title="Skip forward 10s (Right arrow)"
              >
                <Icon name="skipForward" size={26} />
              </button>

              {/* Volume */}
              <div className="volume-container" onClick={e => e.stopPropagation()}>
                <button
                  className="icon-btn"
                  style={{ color: 'white' }}
                  onClick={toggleMute}
                  title="Mute (M)"
                >
                  {isMuted || volume === 0 ? <Icon name="volumeMute" /> : volume < 0.5 ? <Icon name="volumeLow" /> : <Icon name="volumeHigh" />}
                </button>
                <input
                  type="range"
                  className="volume-slider"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                />
              </div>

              {/* Time */}
              <div className="player-time">
                {formatSeconds(currentTime)} / {formatSeconds(duration)}
              </div>

              {/* Right controls */}
              <div className="player-right">
                {/* Playback speed */}
                <SpeedMenu
                  value={playbackSpeed}
                  onChange={v => { const video = videoRef.current; if (video) video.playbackRate = v; setPlaybackSpeed(v); }}
                  onOpenChange={open => { ccMenuOpenRef.current = open; if (open) setShowControls(true); }}
                />

                {/* Audio track */}
                {audioTracks.length > 1 && (
                  <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                    <button className="icon-btn" style={{ color: audioOrd > 0 ? 'var(--accent)' : 'white' }} title="Audio track"
                      onClick={() => { const next = !audioMenuOpen; setAudioMenuOpen(next); ccMenuOpenRef.current = next; if (next) setShowControls(true); }}>
                      <Icon name="volumeHigh" size={22} />
                    </button>
                    {audioMenuOpen && (
                      <div className="cc-menu" style={{ width: 300 }}>
                        <div className="cc-menu-title">Audio</div>
                        {audioTracks.map(tr => (
                          <button key={tr.ord} className={`cc-row ${tr.ord === audioOrd ? 'active' : ''}`} onClick={() => changeAudio(tr.ord)}>
                            <span className="cc-check">{tr.ord === audioOrd && <Icon name="check" size={14} />}</span>
                            <span className="cc-row-main">
                              <span className="cc-row-label">{langName(tr.lang) || `Track ${tr.ord + 1}`}{tr.title ? ` \u00b7 ${tr.title}` : ''}</span>
                              <span className="cc-row-detail">{tr.codec.toUpperCase()}</span>
                            </span>
                          </button>
                        ))}
                        {audioOrd === 0 && <div className="cc-hint">Choosing another track converts the video for playback.</div>}
                      </div>
                    )}
                  </div>
                )}

                {/* Captions */}
                <CaptionsMenu cc={cc} onOpenChange={open => { ccMenuOpenRef.current = open; setCcMenuOpen(open); if (open) setShowControls(true); }} />

                {/* Cast to TV */}
                <CastMenu cast={cast} onStop={stopCasting} onOpenChange={open => { ccMenuOpenRef.current = open; if (open) setShowControls(true); }} />

                {/* PiP */}
                {document.pictureInPictureEnabled && (
                  <button
                    className="icon-btn"
                    style={{ color: 'white', fontSize: 14 }}
                    onClick={() => {
                      const v = videoRef.current;
                      if (!v) return;
                      if (document.pictureInPictureElement) {
                        document.exitPictureInPicture();
                      } else {
                        v.requestPictureInPicture();
                      }
                    }}
                    title="Picture in Picture"
                  >
                    <Icon name="pip" size={20} />
                  </button>
                )}

                {/* Fullscreen */}
                <button
                  className="icon-btn"
                  style={{ color: 'white' }}
                  onClick={toggleFullscreen}
                  title="Fullscreen (F)"
                >
                  {isFullscreen ? <Icon name="fullscreenExit" /> : <Icon name="fullscreen" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
