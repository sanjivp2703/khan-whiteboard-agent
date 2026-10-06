// cli/args.js — hand-rolled argument parsing for the six commands (no dependencies).
// parseArgv(argv) → { command, positionals, flags, pretty, help } or throws UsageError.

export class UsageError extends Error {
  constructor(message, command = null) { super(message); this.code = 'USAGE'; this.command = command; }
}

const GLOBAL_FLAGS = { pretty: 'bool', help: 'bool' };

/** Per-command flag specs: name → 'bool' | 'int' | 'string' */
export const COMMANDS = {
  serve: {
    positionals: [0, 0],
    flags: { port: 'int', 'lessons-dir': 'string', 'cache-dir': 'string', foreground: 'bool' },
    usage: 'khan serve [--port N] [--lessons-dir D] [--cache-dir C] [--foreground]',
    summary: 'start the local server (or report the one already running)',
  },
  outline: {
    positionals: [1, 1],
    flags: { 'lessons-dir': 'string', 'no-open': 'bool', 'timeout-ms': 'int' },
    usage: 'khan outline <lessonId|-> < outline.json',
    summary: 'write outline.json from stdin; `-` generates the lessonId from the title',
  },
  scene: {
    positionals: [2, 2],
    flags: { 'lessons-dir': 'string', 'timeout-ms': 'int', 'max-wait-ms': 'int' },
    usage: 'khan scene <lessonId> <sceneId> < scene.json',
    summary: 'atomically write one scene from stdin and report its validation status',
  },
  wait: {
    positionals: [1, 1],
    flags: { timeout: 'int' },
    usage: 'khan wait <lessonId> [--timeout S]',
    summary: 'block until the server reports question|reject|continue|finished|player-closed|timeout',
  },
  status: {
    positionals: [1, 1],
    flags: {},
    usage: 'khan status <lessonId>',
    summary: 'print the lesson status (counts, buffer, player, tts.ready)',
  },
  play: {
    positionals: [1, 1],
    flags: { port: 'int', 'lessons-dir': 'string', 'cache-dir': 'string', 'no-open': 'bool', 'timeout-ms': 'int' },
    usage: 'khan play <lessonId> [--lessons-dir D] [--no-open]',
    summary: 'replay a finished lesson folder in the browser (no model needed)',
  },
};

const ALIASES = { h: 'help' };

export function parseArgv(argv) {
  const out = { command: null, positionals: [], flags: {}, pretty: false, help: false };
  const rest = [...argv];
  // global flags may come before the command
  while (rest.length && rest[0].startsWith('-')) {
    const f = takeFlag(rest, GLOBAL_FLAGS, null);
    if (f.name === 'pretty') out.pretty = true;
    else if (f.name === 'help') out.help = true;
  }
  if (!rest.length) return out;
  const command = rest.shift();
  if (!COMMANDS[command]) throw new UsageError(`unknown command "${command}"; run khan --help`);
  out.command = command;
  const spec = COMMANDS[command];
  while (rest.length) {
    const a = rest[0];
    if (a === '--') { rest.shift(); out.positionals.push(...rest); break; }
    if (a.startsWith('-') && a !== '-') {
      const f = takeFlag(rest, { ...spec.flags, ...GLOBAL_FLAGS }, command);
      if (f.name === 'pretty') out.pretty = true;
      else if (f.name === 'help') out.help = true;
      else out.flags[f.name] = f.value;
    } else {
      out.positionals.push(rest.shift());
    }
  }
  if (!out.help) {
    const [min, max] = spec.positionals;
    if (out.positionals.length < min || out.positionals.length > max) {
      throw new UsageError(`usage: ${spec.usage}`, command);
    }
  }
  return out;
}

function takeFlag(rest, allowed, command) {
  let raw = rest.shift();
  let value;
  if (raw.startsWith('--')) raw = raw.slice(2);
  else raw = ALIASES[raw.slice(1)] || raw.slice(1);
  const eq = raw.indexOf('=');
  if (eq >= 0) { value = raw.slice(eq + 1); raw = raw.slice(0, eq); }
  const kind = allowed[raw];
  if (!kind) throw new UsageError(`unknown flag --${raw}${command ? ` for "${command}"` : ''}`, command);
  if (kind === 'bool') {
    if (value !== undefined) throw new UsageError(`--${raw} takes no value`, command);
    return { name: raw, value: true };
  }
  if (value === undefined) {
    if (!rest.length) throw new UsageError(`--${raw} needs a value`, command);
    value = rest.shift();
  }
  if (kind === 'int') {
    if (!/^\d+$/.test(value)) throw new UsageError(`--${raw} must be a non-negative integer`, command);
    return { name: raw, value: Number(value) };
  }
  return { name: raw, value };
}

export function helpText(command = null) {
  if (command && COMMANDS[command]) {
    const c = COMMANDS[command];
    return [`${c.usage}`, '', `  ${c.summary}`, '', ...flagLines(c.flags), '  --pretty            indent the JSON output', ''].join('\n');
  }
  const lines = ['khan — narrated whiteboard lessons from Claude\'s last response', '', 'usage: khan [--pretty] <command> [options]', '', 'commands:'];
  for (const [name, c] of Object.entries(COMMANDS)) lines.push(`  ${name.padEnd(9)} ${c.summary}`);
  lines.push('', 'Every command prints one JSON line (human-readable with --pretty).', 'Run `khan <command> --help` for that command\'s options.', '');
  return lines.join('\n');
}

const FLAG_HELP = {
  port: 'server port (default: KHAN_PORT, .khan/config.json, else 7777)',
  'lessons-dir': 'lesson folders (default: the running server\'s, else KHAN_LESSONS_DIR, else <KHAN_HOME>/lessons)',
  'cache-dir': 'TTS cache directory (default: KHAN_CACHE_DIR, else <KHAN_HOME>/cache/tts)',
  foreground: 'run the server in this process instead of detaching it',
  'no-open': 'do not open the browser (KHAN_NO_OPEN=1 does the same)',
  'timeout-ms': 'how long to wait for the server to pick the file up (default: scene 3000, outline 10000, play 5000)',
  'max-wait-ms': 'scene: keep waiting this long while the server has no verdict yet (default 10000)',
  timeout: 'seconds to block before returning {"event":"timeout"} (default 540, max 600)',
};

function flagLines(flags) {
  return Object.keys(flags).map((f) => `  --${f.padEnd(18)}${FLAG_HELP[f] || ''}`);
}
