// The main process's error log: ~/Library/Logs/MDE/main.log (Electron's per-platform logs
// folder). A packaged app's console goes nowhere, so anything the UI reports as broken is also
// written here with its stack. `--log-file=<path>` redirects it; test runs that pass no path
// write to the temp folder rather than the user's real log.

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const LOG_FILE_ARG = '--log-file=';
const logArg = process.argv.find(a => a.startsWith(LOG_FILE_ARG));
const logFile = logArg
  ? logArg.slice(LOG_FILE_ARG.length)
  : process.argv.includes('--test-headless')
    ? path.join(app.getPath('temp'), 'mde-test-main.log')
    : path.join(app.getPath('logs'), 'main.log');

export function logError(context: string, err: unknown): void {
  const detail = err instanceof Error ? err.stack || err.message : String(err);
  const line = `${new Date().toISOString()} ${context}: ${detail}\n`;
  console.error(line.trimEnd());
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    // A folder that fails every walk logs every few seconds; keep one previous file, not all.
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_LOG_BYTES) {
      fs.renameSync(logFile, `${logFile}.old`);
    }
    fs.appendFileSync(logFile, line);
  } catch (writeErr) {
    // The log is a diagnostic aid; failing to write it must not take down what it was logging.
    console.error(`Could not write ${logFile}:`, writeErr);
  }
}
