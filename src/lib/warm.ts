/** Library videos are probed (codecs / audio tracks) before playing. Doing it as soon as the user shows
 *  intent (hovering Play, opening the details) means playback starts without waiting for that probe. */
const warmed = new Set<string>();
export function warmProbe(mediaUrl: string) {
  if (warmed.has(mediaUrl)) return;
  warmed.add(mediaUrl);
  const info = mediaUrl.replace(/^((?:https?:\/\/[^/]+)?)\/(media|torrent)\//, '$1/info/$2/');
  fetch(info).catch(() => warmed.delete(mediaUrl));
}
