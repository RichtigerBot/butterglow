import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NICKNAMES_KEY, cleanNicknames, createNicknames, placeholderFor, previewImage } from '../src/ui/preset-previews.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: async (key) => (key in data ? { [key]: data[key] } : {}),
    set: async (values) => Object.assign(data, values),
  };
}

test('nicknames are loaded, shown instead of the name, found by search and removed when empty', async () => {
  const storage = fakeStorage({ [NICKNAMES_KEY]: { 'Geiss - Long Name 01': 'Blue', broken: 5 } });
  const nicknames = createNicknames({ storage });
  await nicknames.ready;
  assert.equal(nicknames.display('Geiss - Long Name 01'), 'Blue');
  assert.equal(nicknames.display('other'), 'other');
  assert.equal(nicknames.get('broken'), '');
  assert.ok(nicknames.matches('Geiss - Long Name 01', 'blue'));
  assert.ok(nicknames.matches('Geiss - Long Name 01', 'long'));
  assert.ok(!nicknames.matches('other', 'blue'));

  let changes = 0;
  nicknames.onChange(() => changes++);
  nicknames.set('other', '  Red  ');
  assert.equal(nicknames.get('other'), 'Red');
  assert.deepEqual(storage.data[NICKNAMES_KEY], { 'Geiss - Long Name 01': 'Blue', other: 'Red' });
  nicknames.set('other', 'Red'); // unchanged: no save, no notice
  nicknames.set('Geiss - Long Name 01', '');
  assert.equal(nicknames.display('Geiss - Long Name 01'), 'Geiss - Long Name 01');
  assert.deepEqual(storage.data[NICKNAMES_KEY], { other: 'Red' });
  assert.equal(changes, 2);
});

test('nicknames from storage are cleaned and shortened', () => {
  assert.deepEqual(cleanNicknames(null), {});
  assert.deepEqual(cleanNicknames(['a']), {});
  assert.deepEqual(cleanNicknames({ a: ' x ', b: '', c: 3 }), { a: 'x' });
  assert.equal(cleanNicknames({ a: 'y'.repeat(100) }).a.length, 40);
});

test('preview image or the same placeholder for each name', () => {
  assert.equal(previewImage({ a: 'data:image/webp;base64,AA' }, 'a'), 'url(data:image/webp;base64,AA)');
  assert.equal(previewImage(null, 'b'), placeholderFor('b'));
  assert.match(placeholderFor('b'), /^linear-gradient/);
});
