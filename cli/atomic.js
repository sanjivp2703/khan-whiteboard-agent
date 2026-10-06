// cli/atomic.js — atomic JSON writes: `<file>.tmp` then rename (spec §4.1; the watcher ignores
// *.tmp, so a reader can never see a partial file).
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

export async function writeJsonAtomic(path, obj) {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const text = JSON.stringify(obj, null, 2) + '\n';
  const fh = await fs.open(tmp, 'w');
  try {
    await fh.writeFile(text, 'utf8');
    await fh.sync().catch(() => {}); // best effort; not all filesystems support it
  } finally {
    await fh.close();
  }
  await fs.rename(tmp, path);
  return path;
}
