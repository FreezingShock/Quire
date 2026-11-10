import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit, colorEdit, enterEdit, toggleBlockEdit, wrapEdit, blockInsertEdit } from '../src/textops.js';

test('heading toggles on and off for the current line', () => {
  const on = toggleBlockEdit('Hello', 2, 2, 'h1');
  assert.equal(applyEdit('Hello', on), '# Hello');
  const off = toggleBlockEdit('# Hello', 4, 4, 'h1');
  assert.equal(applyEdit('# Hello', off), 'Hello');
});

test('switching heading level replaces the old marker', () => {
  const edit = toggleBlockEdit('## Hello', 0, 0, 'h3');
  assert.equal(applyEdit('## Hello', edit), '### Hello');
});

test('numbered list numbers only non-empty lines', () => {
  const text = 'a\n\nb';
  const edit = toggleBlockEdit(text, 0, text.length, 'ol');
  assert.equal(applyEdit(text, edit), '1. a\n\n2. b');
});

test('bullet toggle covers every selected line', () => {
  const text = 'one\ntwo';
  const edit = toggleBlockEdit(text, 0, text.length, 'ul');
  assert.equal(applyEdit(text, edit), '- one\n- two');
});

test('wrap puts the caret inside empty markers', () => {
  const edit = wrapEdit('text', 4, 4, '**', '**');
  assert.equal(applyEdit('text', edit), 'text****');
  assert.equal(edit.selStart, 6);
});

test('enter continues a bullet list and an ordered list', () => {
  const bullet = enterEdit('- item', 6);
  assert.equal(applyEdit('- item', bullet), '- item\n- ');
  const ordered = enterEdit('1. one', 6);
  assert.equal(applyEdit('1. one', ordered), '1. one\n2. ');
});

test('enter on an empty list item ends the list', () => {
  const edit = enterEdit('- ', 2);
  assert.equal(applyEdit('- ', edit), '');
});

test('enter on an ordinary line is left to the browser', () => {
  assert.equal(enterEdit('plain text', 5), null);
});

test('color wraps each non-blank line separately so spans stay closed', () => {
  const text = 'one\n\ntwo';
  const edit = colorEdit(text, 0, text.length, '#d9342b');
  assert.equal(
    applyEdit(text, edit),
    '<span style="color: #d9342b">one</span>\n\n<span style="color: #d9342b">two</span>',
  );
});

test('color does nothing without a selection', () => {
  assert.equal(colorEdit('abc', 1, 1, '#000000'), null);
});

test('checklist toggle adds and removes the box on each line', () => {
  const on = toggleBlockEdit('buy milk', 0, 0, 'task');
  assert.equal(on.insert, '- [ ] buy milk');
  const off = toggleBlockEdit('- [ ] buy milk', 0, 0, 'task');
  assert.equal(off.insert, 'buy milk');
});

test('enter continues a checklist as a new unchecked item, and an empty box ends it', () => {
  assert.equal(enterEdit('- [x] eggs', 10).insert, '\n- [ ] ');
  assert.equal(enterEdit('1. [ ] first', 13).insert, '\n2. [ ] ');
  assert.equal(enterEdit('- [ ] ', 6).insert, '');
});

test('blockInsertEdit puts a block on its own line and leaves the caret after it', () => {
  const end = blockInsertEdit('abc', 3, 3, 'X');
  assert.equal(end.insert, '\nX\n');
  assert.equal(end.selStart, 6);
  const middle = blockInsertEdit('one\n\ntwo', 4, 4, '![p](quire-image:a)');
  assert.equal(middle.insert, '![p](quire-image:a)');
  assert.equal(middle.selStart, 4 + '![p](quire-image:a)'.length);
});
