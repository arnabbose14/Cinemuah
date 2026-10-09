// FFmpeg-backed probing and on-the-fly transcoding to browser-playable fragmented MP4 (H.264 + AAC).
import { spawn, ChildProcess } from 'child_process';
import http from 'http';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegStatic: string | null = require('ffmpeg-static');
// In a packaged app the binary lives outside the asar archive.
const FFMPEG = ffmpegStatic ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : 'ffmpeg';

const DIRECT_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1']);
const DIRECT_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);
const DIRECT_CONTAINERS = ['mp4', 'mov', 'matroska', 'webm'];

export interface ProbeSubtitle {
  index: number;      // ffmpeg stream index (use with -map 0:<index>)
  lang: string;       // ISO 639-2 code from the file, e.g. "eng" ('' when unset)
  codec: string;      // subrip, ass, mov_text, webvtt, hdmv_pgs_subtitle, ...
}

export interface ProbeAudio {
  ord: number;        // position among the audio streams (use with -map 0:a:<ord>)
  lang: string;       // ISO 639-2 code, '' when unset
  codec: string;
  title: string;
}

export interface ProbeChapter { start: number; end: number; title: string }

export interface ProbeResult {
  subtitles: ProbeSubtitle[];
  audioTracks: ProbeAudio[];
  chapters: ProbeChapter[];
  duration: number; // seconds, 0 if unknown
  video: string; // codec name, '' if none
  audio: string; // codec name, '' if none
  container: string;
  direct: boolean; // true if Chromium can play it as-is
}

const probeCache = new Map<string, ProbeResult>();

/** Runs `ffmpeg -i` and parses the stream summary from stderr (no ffprobe needed). */
export function probe(input: string): Promise<ProbeResult> {
  const cached = probeCache.get(input);
  if (cached) return Promise.resolve(cached);

  return new Promise(resolve => {
    const proc = spawn(FFMPEG, ['-hide_banner', '-i', input], { windowsHide: true });
    let err = '';
    proc.stderr.on('data', d => { err += d.toString(); });
    const done = () => {
      const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
      const video = /Stream #\d+:\d+[^:]*: Video: (\w+)/.exec(err)?.[1] || '';
      const audio = /Stream #\d+:\d+[^:]*: Audio: (\w+)/.exec(err)?.[1] || '';
      const container = /Input #0, ([^,]+(?:,[^,]+)*), from/.exec(err)?.[1] || '';
      const subtitles: ProbeSubtitle[] = [];
      for (const m of err.matchAll(/Stream #0:(\d+)(?:\((\w+)\))?[^\n]*?: Subtitle: (\w+)/g)) {
        subtitles.push({ index: Number(m[1]), lang: m[2] && m[2] !== 'und' ? m[2] : '', codec: m[3] });
      }
      // Audio streams (language + optional title such as "Commentary") and chapter markers
      const audioTracks: ProbeAudio[] = [];
      const audioRe = /Stream #0:\d+(?:\((\w+)\))?[^\n]*?: Audio: (\w+)[^\n]*\n((?:\s{4,}[^\n]*\n)*)/g;
      for (const m of err.matchAll(audioRe)) {
        const title = /title\s*:\s*(.+)/i.exec(m[3] || '')?.[1]?.trim() || '';
        audioTracks.push({ ord: audioTracks.length, lang: m[1] && m[1] !== 'und' ? m[1] : '', codec: m[2], title });
      }
      const chapters: ProbeChapter[] = [];
      for (const m of err.matchAll(/Chapter #0:\d+: start ([\d.]+), end ([\d.]+)\s*\n\s*Metadata:\s*\n\s*title\s*:\s*([^\n]*)/g)) {
        chapters.push({ start: parseFloat(m[1]), end: parseFloat(m[2]), title: m[3].trim() });
      }
      const result: ProbeResult = {
        subtitles,
        audioTracks,
        chapters,
        duration: dur ? +dur[1] * 3600 + +dur[2] * 60 + parseFloat(dur[3]) : 0,
        video,
        audio,
        container,
        direct:
          DIRECT_VIDEO.has(video) &&
          (!audio || DIRECT_AUDIO.has(audio)) &&
          DIRECT_CONTAINERS.some(c => container.includes(c)),
      };
      // Don't cache failed probes (e.g. a torrent that hadn't buffered enough yet)
      if (video) probeCache.set(input, result);
      resolve(result);
    };
    proc.on('close', done);
    proc.on('error', done);
    setTimeout(() => proc.kill(), 30000);
  });
}

interface Encoder { name: string; args: string[] }

const ENCODERS: Encoder[] = [
  { name: 'h264_nvenc', args: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '23', '-b:v', '0'] },
  { name: 'h264_qsv', args: ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '23'] },
  { name: 'h264_amf', args: ['-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '23', '-qp_p', '23'] },
];
const SOFTWARE_ENCODER: Encoder = {
  name: 'libx264',
  args: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23'],
};

let encoderPromise: Promise<Encoder> | null = null;

/** Tries each GPU encoder with a tiny real encode; the first that works wins, else libx264. */
function pickEncoder(): Promise<Encoder> {
  if (encoderPromise) return encoderPromise;
  encoderPromise = (async () => {
    for (const enc of ENCODERS) {
      const ok = await new Promise<boolean>(resolve => {
        const p = spawn(FFMPEG, [
          '-hide_banner', '-loglevel', 'error',
          '-f', 'lavfi', '-i', 'color=black:s=320x240:d=0.2:r=24',
          ...enc.args, '-pix_fmt', 'yuv420p', '-f', 'null', '-',
        ], { windowsHide: true, stdio: 'ignore' });
        const t = setTimeout(() => { p.kill(); resolve(false); }, 10000);
        p.on('close', code => { clearTimeout(t); resolve(code === 0); });
        p.on('error', () => { clearTimeout(t); resolve(false); });
      });
      if (ok) {
        console.log(`[transcoder] using GPU encoder ${enc.name}`);
        return enc;
      }
    }
    console.log('[transcoder] no GPU encoder available, using libx264 (CPU)');
    return SOFTWARE_ENCODER;
  })();
  return encoderPromise;
}

/** Warm the encoder detection at startup so the first transcode isn't delayed. */
export function initTranscoder() {
  pickEncoder().catch(() => undefined);
}

/** Streams `input` as fragmented MP4 starting at `startSec`, remuxing video if it is already H.264. */
export async function transcodeTo(
  input: string,
  startSec: number,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  audioOrd = 0
) {
  const info = await probe(input);
  const copyVideo = info.video === 'h264';

  const encoder = copyVideo ? null : await pickEncoder();
  const args = ['-hide_banner', '-loglevel', 'error'];
  // GPU decode for the source too (HEVC/AV1 etc.); falls back to software automatically.
  if (!copyVideo) args.push('-hwaccel', 'auto');
  // Stream-copied video can only start on a keyframe. Without -noaccurate_seek ffmpeg trims the audio to the exact
  // requested second but not the video, which leaves them about one GOP (2-10 s) out of sync after every seek or resume.
  if (startSec > 0) args.push(...(copyVideo ? ['-noaccurate_seek'] : []), '-ss', String(startSec));
  args.push('-i', input, '-map', '0:v:0', '-map', `0:a:${Math.max(0, Math.floor(audioOrd))}?`, '-sn');
  if (encoder) {
    args.push(...encoder.args, '-pix_fmt', 'yuv420p');
  } else {
    args.push('-c:v', 'copy');
  }
  args.push(
    '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
    // keep audio timestamps continuous if the source has gaps (partly downloaded torrents, cut audio)
    '-af', 'aresample=async=1',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof+negative_cts_offsets',
    '-f', 'mp4', 'pipe:1'
  );

  const proc: ChildProcess = spawn(FFMPEG, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr!.on('data', d => console.error('[ffmpeg]', d.toString().trim()));

  res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-cache' });
  if (req.method === 'HEAD') {
    proc.kill();
    res.end();
    return;
  }
  proc.stdout!.pipe(res);

  // Seeking aborts the request; make sure ffmpeg dies with it.
  const kill = () => { if (!proc.killed) proc.kill('SIGKILL'); };
  res.on('close', kill);
  proc.on('error', err => { console.error('[ffmpeg] spawn failed:', err.message); res.destroy(); });
}

/**
 * Where a transcode requested at `startSec` really begins. Re-encoded video starts exactly there; copied H.264
 * starts on the keyframe at or before it, so the player needs the true value to keep time (and captions) right.
 */
export async function streamStartAt(input: string, startSec: number): Promise<number> {
  if (startSec <= 0) return 0;
  const info = await probe(input);
  if (info.video !== 'h264') return startSec;
  return new Promise(resolve => {
    const proc = spawn(FFMPEG, [
      '-hide_banner', '-copyts', '-noaccurate_seek', '-ss', String(startSec), '-i', input,
      '-map', '0:v:0', '-frames:v', '1', '-vf', 'showinfo', '-an', '-f', 'null', '-',
    ], { windowsHide: true });
    let err = '';
    proc.stderr.on('data', d => { err += d.toString(); });
    const done = () => {
      const m = /showinfo[^\n]*pts_time:\s*([-\d.]+)/.exec(err);
      const t = m ? parseFloat(m[1]) : startSec;
      resolve(Number.isFinite(t) && t >= 0 && t <= startSec + 0.5 ? t : startSec);
    };
    proc.on('close', done);
    proc.on('error', () => resolve(startSec));
    setTimeout(() => proc.kill(), 15000);
  });
}

/** Runs ffmpeg and returns its stdout (used to convert subtitles to WebVTT). */
export function runFfmpeg(args: string[], timeoutMs = 180000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true });
    const chunks: Buffer[] = [];
    let err = '';
    proc.stdout.on('data', d => chunks.push(d));
    proc.stderr.on('data', d => { err += d.toString(); });
    const timer = setTimeout(() => { proc.kill(); reject(new Error('ffmpeg timed out')); }, timeoutMs);
    proc.on('error', e => { clearTimeout(timer); reject(e); });
    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0 && chunks.length) resolve(Buffer.concat(chunks));
      else reject(new Error(err.trim().split('\n').pop() || 'ffmpeg failed'));
    });
  });
}
