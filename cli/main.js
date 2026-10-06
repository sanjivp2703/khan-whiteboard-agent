// cli/main.js — dispatcher for bin/khan. One JSON line out, stable exit codes (see output.js).
import { parseArgv, helpText, UsageError } from './args.js';
import { emit, CliError, EXIT } from './output.js';
import { serve } from './commands/serve.js';
import { outline } from './commands/outline.js';
import { scene } from './commands/scene.js';
import { wait } from './commands/wait.js';
import { status } from './commands/status.js';
import { play } from './commands/play.js';

const HANDLERS = { serve, outline, scene, wait, status, play };

/**
 * @param {string[]} argv process.argv.slice(2)
 * @param {{env?: object, stdin?: NodeJS.ReadableStream, stdout?: NodeJS.WritableStream}} [io]
 * @returns {Promise<number|null>} exit code; null = keep the process alive (serve --foreground)
 */
export async function main(argv, io = {}) {
  const env = io.env || process.env;
  let parsed;
  try {
    parsed = parseArgv(argv);
  } catch (e) {
    if (e instanceof UsageError) {
      emit({ ok: false, code: 'USAGE', message: e.message, help: helpText(e.command).trimEnd() }, false, io.stdout);
      return EXIT.ERROR;
    }
    throw e;
  }
  if (parsed.help || !parsed.command) {
    (io.stdout || process.stdout).write(helpText(parsed.command));
    return parsed.command || parsed.help ? EXIT.OK : EXIT.ERROR;
  }
  try {
    return await HANDLERS[parsed.command]({ positionals: parsed.positionals, flags: parsed.flags, pretty: parsed.pretty, env, stdin: io.stdin || process.stdin });
  } catch (e) {
    if (e instanceof CliError) {
      emit(e.toJSON(), parsed.pretty, io.stdout);
      return e.exit;
    }
    emit({ ok: false, code: 'INTERNAL', message: e && e.message ? e.message : String(e) }, parsed.pretty, io.stdout);
    return EXIT.ERROR;
  }
}
