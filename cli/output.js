// cli/output.js — one JSON line per command (indented with --pretty), stable exit codes.
//   0 ok (a rejected scene is still exit 0: the skill reads the JSON)
//   1 usage / validation / IO error
//   2 server unreachable
export const EXIT = Object.freeze({ OK: 0, ERROR: 1, SERVER_DOWN: 2 });

export function format(obj, pretty = false) {
  return (pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj)) + '\n';
}

export function emit(obj, pretty = false, stream = process.stdout) {
  stream.write(format(obj, pretty));
}

export class CliError extends Error {
  /** @param {string} code stable code, e.g. SERVER_DOWN, BAD_JSON, USAGE */
  constructor(code, message, { exit = EXIT.ERROR, details = undefined } = {}) {
    super(message);
    this.code = code;
    this.exit = exit;
    this.details = details;
  }
  toJSON() {
    const o = { ok: false, code: this.code, message: this.message };
    if (this.details !== undefined) o.details = this.details;
    return o;
  }
}

export function serverDown(message) {
  return new CliError('SERVER_DOWN', message, { exit: EXIT.SERVER_DOWN });
}

/** Read all of stdin as a string. */
export function readStdin(stream = process.stdin) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
    if (stream.isTTY) resolve('');
  });
}

export function parseJsonInput(text, what = 'input') {
  if (!text.trim()) throw new CliError('BAD_JSON', `${what} on stdin is empty`);
  try { return JSON.parse(text); } catch (e) { throw new CliError('BAD_JSON', `${what} is not valid JSON: ${e.message}`); }
}
