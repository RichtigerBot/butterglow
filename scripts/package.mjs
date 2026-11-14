// Packs dist/ into release/butterglow-<version>.zip for a GitHub release (or later the Chrome Web Store).
// Run via `npm run package`, which builds first. No extra dependency: a plain ZIP writer on top of node:zlib.
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (manifest.version !== pkg.version) {
  console.error(`Version mismatch: manifest.json has ${manifest.version}, package.json has ${pkg.version}.`);
  process.exit(1);
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)])),
  );
  return files.flat().sort();
}

// MS-DOS date and time, as ZIP stores them.
function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

const local = [];
const central = [];
let offset = 0;
for (const file of await listFiles('dist')) {
  const name = Buffer.from(relative('dist', file).split(sep).join('/'), 'utf8');
  const data = await readFile(file);
  const packed = deflateRawSync(data, { level: 9 });
  const { time, day } = dosTime((await stat(file)).mtime);
  const checksum = crc32(data);

  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // local file header
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0x0800, 6); // UTF-8 file names
  header.writeUInt16LE(8, 8); // deflate
  header.writeUInt16LE(time, 10);
  header.writeUInt16LE(day, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(packed.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  local.push(header, name, packed);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0); // central directory entry
  entry.writeUInt16LE(20, 4); // version made by
  entry.writeUInt16LE(20, 6); // version needed
  entry.writeUInt16LE(0x0800, 8);
  entry.writeUInt16LE(8, 10);
  entry.writeUInt16LE(time, 12);
  entry.writeUInt16LE(day, 14);
  entry.writeUInt32LE(checksum, 16);
  entry.writeUInt32LE(packed.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt32LE(offset, 42);
  central.push(entry, name);

  offset += header.length + name.length + packed.length;
}

const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); // end of central directory
end.writeUInt16LE(central.length / 2, 8);
end.writeUInt16LE(central.length / 2, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);

await mkdir('release', { recursive: true });
const target = join('release', `butterglow-${manifest.version}.zip`);
await writeFile(target, Buffer.concat([...local, directory, end]));
console.log(`${target}: ${central.length / 2} files, ${((offset + directory.length + 22) / 1048576).toFixed(1)} MB`);
