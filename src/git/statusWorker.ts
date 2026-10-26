// The worker thread that runs status walks (statusWalk.ts), so a cold walk of a huge repo never
// blocks the main process (every save, read, and IPC reply waits behind it). Loaded by path,
// so it is a webpack entry of its own.

import { parentPort } from 'worker_threads';
import { VcChangedFile } from '../types';
import { releaseRoot, walkStatus } from './statusWalk';

export type StatusWorkerRequest =
  | { type: 'status'; id: number; root: string }
  | { type: 'release'; root: string };

export type StatusWorkerReply =
  | { id: number; files: VcChangedFile[] }
  | { id: number; error: string };

if (!parentPort) throw new Error('statusWorker must run as a worker thread');
const port = parentPort;

port.on('message', (msg: StatusWorkerRequest) => {
  if (msg.type === 'release') {
    releaseRoot(msg.root);
    return;
  }
  walkStatus(msg.root).then(
    files => port.postMessage({ id: msg.id, files } satisfies StatusWorkerReply),
    (err: Error) => port.postMessage({ id: msg.id, error: err.message } satisfies StatusWorkerReply)
  );
});
