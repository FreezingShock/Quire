import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEntry } from '../src/model.js';
import { mediaRefsIn, mediaResolver } from '../src/media.js';
import { redactEntry } from '../src/capsule.js';
import { renderMarkdown } from '../src/markdown.js';
import {
  VOICE_MAX_SECONDS,
  audioExtension,
  baseType,
  formatDuration,
  normalizeAudioDataUrl,
  pickVoiceType,
} from '../src/voice.js';

const CLIP = 'data:audio/webm;base64,AAAA';

test('pickVoiceType takes the first format the browser supports', () => {
  assert.equal(pickVoiceType((type) => type === 'audio/webm'), 'audio/webm');
  assert.equal(pickVoiceType(() => true), 'audio/webm;codecs=opus');
  assert.equal(pickVoiceType(() => false), '');
  assert.equal(
    pickVoiceType(() => {
      throw new Error('no MediaRecorder');
    }),
    '',
  );
});

test('baseType and audioExtension ignore codec settings', () => {
  assert.equal(baseType('audio/webm;codecs=opus'), 'audio/webm');
  assert.equal(audioExtension('audio/webm;codecs=opus'), 'webm');
  assert.equal(audioExtension('audio/mp4'), 'm4a');
  assert.equal(audioExtension('audio/unknown'), 'webm');
});

test('normalizeAudioDataUrl drops codec settings and refuses non-audio', () => {
  assert.equal(normalizeAudioDataUrl('data:audio/webm;codecs=opus;base64,QUJD'), 'data:audio/webm;base64,QUJD');
  assert.equal(normalizeAudioDataUrl(CLIP), CLIP);
  assert.equal(normalizeAudioDataUrl('data:image/png;base64,QUJD'), null);
  assert.equal(normalizeAudioDataUrl('not a data url'), null);
});

test('formatDuration shows minutes and padded seconds', () => {
  assert.equal(formatDuration(5.9), '0:05');
  assert.equal(formatDuration(90), '1:30');
  assert.equal(formatDuration(-3), '0:00');
  assert.equal(formatDuration(VOICE_MAX_SECONDS), '5:00');
});

test('normalizeEntry keeps audio clips and drops anything that is not audio', () => {
  const entry = normalizeEntry({ audio: { a1: CLIP, bad: 'data:image/png;base64,QUJD' } });
  assert.deepEqual(entry.audio, { a1: CLIP });
  assert.deepEqual(normalizeEntry({}).audio, {});
});

test('mediaRefsIn and mediaResolver find voice notes by id', () => {
  const entry = normalizeEntry({ body: 'Hi\n\n![Voice note](quire-audio:a1)', audio: { a1: CLIP } });
  assert.deepEqual(mediaRefsIn(entry.body), [{ kind: 'audio', id: 'a1' }]);
  assert.equal(mediaResolver(entry)('audio', 'a1'), CLIP);
  assert.equal(mediaResolver(entry)('audio', 'missing'), null);
});

test('the reader renders a voice note as an audio player', () => {
  const html = renderMarkdown('![Voice note](quire-audio:a1)', { media: (kind, id) => (kind === 'audio' && id === 'a1' ? CLIP : null) });
  assert.match(html, /<audio controls[^>]* src="data:audio\/webm;base64,AAAA"/);
  assert.equal(renderMarkdown('![Voice note](quire-audio:a1)', { media: () => null }), '');
});

test('a sealed time capsule blanks its voice notes too', () => {
  const entry = normalizeEntry({ title: 'Secret', audio: { a1: CLIP } });
  assert.deepEqual(redactEntry(entry).audio, {});
});

test('an export writes each voice note to audio/ with its own extension', async () => {
  const { mediaExports } = await import('../src/export.js');
  const entry = normalizeEntry({ body: '![Voice note](quire-audio:a1)', audio: { a1: 'data:audio/mp4;base64,QUJD' } });
  const files = mediaExports(entry);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, 'audio/a1.m4a');
  assert.deepEqual([...files[0].data], [...Buffer.from('ABC')]);
});
