/**
 * Voice notes: a short recording kept on the entry as an audio data URL in
 * `entry.audio[id]`, and referenced from the text like a picture, as
 * ![Voice note](quire-audio:<id>). This file holds the pure helpers, so the node
 * tests can use them. The recorder itself lives in the editor controller, because
 * it talks to the microphone and the page.
 */

/** Longest recording the editor will take, in seconds. It stops by itself after this. */
export const VOICE_MAX_SECONDS = 300;
/** Largest recording that is kept. A clip over this is dropped with a message. */
export const VOICE_MAX_BYTES = 8 * 1024 * 1024;

/** Recording formats to try, best first. The browser picks the first one it supports. */
const VOICE_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

/** File extensions for the audio types a browser records or plays. */
const EXTENSIONS = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };

/**
 * The first recording format the browser supports, or '' to let it choose.
 * `isSupported(type)` defaults to MediaRecorder.isTypeSupported.
 */
export function pickVoiceType(isSupported = (type) => globalThis.MediaRecorder?.isTypeSupported?.(type)) {
  return VOICE_TYPES.find((type) => {
    try {
      return Boolean(isSupported(type));
    } catch {
      return false;
    }
  }) ?? '';
}

/** The media type without its codec settings: 'audio/webm;codecs=opus' -> 'audio/webm'. */
export function baseType(type) {
  return String(type ?? '').split(';')[0].trim().toLowerCase();
}

/** The file extension for a recording's type. WebM when the type is unknown. */
export function audioExtension(type) {
  return EXTENSIONS[baseType(type)] ?? 'webm';
}

/**
 * A recording's data URL with the codec settings removed, so it reads back as a
 * plain audio type. Null for anything that is not an audio data URL.
 */
export function normalizeAudioDataUrl(src) {
  const match = /^data:([^,]*);base64,([\s\S]*)$/.exec(String(src ?? ''));
  if (!match) return null;
  const type = baseType(match[1]);
  if (!type.startsWith('audio/')) return null;
  return `data:${type};base64,${match[2]}`;
}

/** "0:05", "1:30", "5:00". Whole seconds, never negative. */
export function formatDuration(seconds) {
  const whole = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
