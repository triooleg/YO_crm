import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { lstat, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const MAGIC = Buffer.from('YOCP0001');
const AAD = Buffer.from('YO migrator checkpoint v1');
const failure = () => new Error('Protected checkpoint unavailable or invalid');
type HelperReply = { ready?: boolean; data?: string; error?: boolean };

function json(value: unknown): string {
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error('Checkpoint must be JSON serializable');
  return result;
}

export type OutboxPacket = { batchId: string; checksum: string; payload: unknown; pending: boolean };

export function createPacket(payload: unknown): OutboxPacket {
  const serialized = json(payload);
  return { batchId: randomUUID(), checksum: createHash('sha256').update(serialized).digest('hex'),
    payload: JSON.parse(serialized), pending: true };
}

export function acknowledgePacket(packet: OutboxPacket, ack: { batchId: string; checksum: string }): OutboxPacket {
  if (packet.batchId !== ack.batchId || packet.checksum !== ack.checksum ||
      createHash('sha256').update(json(packet.payload)).digest('hex') !== packet.checksum) {
    throw new Error('Outbox ACK does not match packet');
  }
  return { ...packet, pending: false };
}

/** Windows-only local storage. The helper owns a kernel exclusive lock until stdin closes.
 * A stale PID/lock filename is never authority: a new helper can acquire only a free handle.
 * maxBytes bounds total file bytes, including the previous snapshot during atomic replacement.
 */
export class ProtectedJobStore {
  #folder: string;
  #maxBytes: number;
  #helper: ChildProcessWithoutNullStreams | null = null;
  #pending: { resolve: (value: HelperReply) => void; reject: (error: Error) => void } | null = null;
  #alive = false;
  #ready = false;
  #closed = false;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(folder: string, maxBytes = 64 * 1024 * 1024) {
    if (!isAbsolute(folder) || folder.startsWith('\\\\') || folder.startsWith('//') ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw failure();
    if (process.platform === 'win32' && (!/^[a-z]:[\\/]/i.test(folder) ||
        folder.slice(3).split(/[\\/]/).some(part => !part || /[<>:"|?*\x00-\x1f]/.test(part) ||
          /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))) throw failure();
    this.#folder = resolve(folder);
    this.#maxBytes = maxBytes;
  }

  #serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(action);
    this.#queue = result.catch(() => {});
    return result;
  }

  #response(send: () => void): Promise<HelperReply> {
    return new Promise((resolveResponse, reject) => {
      const timer = setTimeout(() => { this.#helper?.kill(); reject(failure()); }, 30_000);
      this.#pending = {
        resolve: value => { clearTimeout(timer); this.#pending = null; resolveResponse(value); },
        reject: error => { clearTimeout(timer); this.#pending = null; reject(error); },
      };
      send();
    });
  }

  async #crypt(op: string, bytes: Buffer): Promise<Buffer> {
    if (!this.#alive) throw failure();
    const reply = await this.#response(() => this.#helper!.stdin.write(json({ op, data: bytes.toString('base64') }) + '\n'));
    if (typeof reply.data !== 'string') throw failure();
    return Buffer.from(reply.data, 'base64');
  }

  initialize(): Promise<void> {
    return this.#serial(async () => {
      if (process.platform !== 'win32' || this.#closed) throw new Error('ProtectedJobStore requires Windows and an open instance');
      if (this.#ready) { this.#check(); return; }
      try { await this.#inventory(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const script = await readFile(new URL('./checkpoint-dpapi.ps1', import.meta.url));
      // Fixed bootstrap only in arguments. Both the fixed script and all data use stdin.
      const helper = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
          '& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine()))))'],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.#helper = helper;
      this.#alive = true;
      helper.stderr.resume();
      helper.stdin.on('error', () => this.#pending?.reject(failure()));
      const lines = createInterface({ input: helper.stdout });
      lines.on('line', line => {
        try {
          const value = JSON.parse(line);
          if (value.error) this.#pending?.reject(failure());
          else this.#pending?.resolve(value);
        } catch { this.#pending?.reject(failure()); }
      });
      const died = () => { this.#alive = false; this.#pending?.reject(failure()); };
      helper.on('error', died);
      helper.on('exit', died);
      try {
        const reply = await this.#response(() => helper.stdin.write(script.toString('base64') + '\n' + json({ folder: this.#folder }) + '\n'));
        if (reply.ready !== true) throw failure();
        await this.#inventory();
        // Only ciphertext temporary files from an interrupted atomic write are removable.
        for (const name of await readdir(this.#folder)) {
          if (/^checkpoint\.[0-9a-f-]{36}\.tmp$/.test(name)) await unlink(join(this.#folder, name));
        }
        this.#ready = true;
      } catch {
        if (helper.exitCode === null && helper.signalCode === null) {
          await new Promise<void>(resolveExit => {
            helper.once('close', resolveExit);
            helper.stdin.end();
            helper.kill();
          });
        }
        throw failure();
      }
    });
  }

  #check(): void {
    if (process.platform !== 'win32' || !this.#ready || !this.#alive || this.#closed) throw failure();
  }

  async #inventory(): Promise<number> {
    const folder = await lstat(this.#folder);
    if (!folder.isDirectory() || folder.isSymbolicLink()) throw failure();
    let total = 0;
    for (const name of await readdir(this.#folder)) {
      if (name !== '.lock' && name !== 'checkpoint.bin' && !/^checkpoint\.[0-9a-f-]{36}\.tmp$/.test(name)) throw failure();
      const stat = await lstat(join(this.#folder, name));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw failure();
      total += stat.size;
      if (total > this.#maxBytes) throw new Error('Checkpoint disk quota exceeded');
    }
    return total;
  }

  async #load(): Promise<unknown | null> {
    this.#check();
    await this.#inventory();
    let data: Buffer;
    try { data = await readFile(join(this.#folder, 'checkpoint.bin')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw failure(); }
    let key: Buffer | undefined;
    let plaintext: Buffer | undefined;
    try {
      if (data.length < 44 || !data.subarray(0, 8).equals(MAGIC)) throw failure();
      const wrappedLength = data.readUInt32BE(8);
      if (wrappedLength < 1 || wrappedLength > 16384 || 40 + wrappedLength > data.length) throw failure();
      key = await this.#crypt('unprotect', data.subarray(12, 12 + wrappedLength));
      if (key.length !== 32) throw failure();
      const offset = 12 + wrappedLength;
      const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(offset, offset + 12));
      decipher.setAAD(Buffer.concat([AAD, data.subarray(0, offset)]));
      decipher.setAuthTag(data.subarray(offset + 12, offset + 28));
      plaintext = Buffer.concat([decipher.update(data.subarray(offset + 28)), decipher.final()]);
      return JSON.parse(plaintext.toString('utf8'));
    } catch { throw failure(); }
    finally { key?.fill(0); plaintext?.fill(0); }
  }

  load(): Promise<unknown | null> { return this.#serial(() => this.#load()); }

  save(value: unknown): Promise<void> {
    return this.#serial(async () => {
      this.#check();
      // Refuse to overwrite a corrupt previous checkpoint.
      await this.#load();
      const plaintext = Buffer.from(json(value));
      const key = randomBytes(32);
      let temporary: string | undefined;
      try {
        if (plaintext.length > this.#maxBytes) throw new Error('Checkpoint disk quota exceeded');
        const wrapped = await this.#crypt('protect', key);
        const header = Buffer.alloc(12);
        MAGIC.copy(header); header.writeUInt32BE(wrapped.length, 8);
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', key, iv);
        cipher.setAAD(Buffer.concat([AAD, header, wrapped]));
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const data = Buffer.concat([header, wrapped, iv, cipher.getAuthTag(), ciphertext]);
        if (await this.#inventory() + data.length > this.#maxBytes) throw new Error('Checkpoint disk quota exceeded');
        temporary = join(this.#folder, `checkpoint.${randomUUID()}.tmp`);
        const file = await open(temporary, 'wx', 0o600);
        try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
        this.#check();
        await rename(temporary, join(this.#folder, 'checkpoint.bin'));
        temporary = undefined;
        // Windows does not support portable directory fsync. Flush the installed file too.
        const installed = await open(join(this.#folder, 'checkpoint.bin'), 'r+');
        try { await installed.sync(); } finally { await installed.close(); }
      } finally {
        key.fill(0); plaintext.fill(0);
        if (temporary) await unlink(temporary).catch(() => {});
      }
    });
  }

  close(): Promise<void> {
    return this.#serial(async () => {
      this.#closed = true;
      this.#ready = false;
      const helper = this.#helper;
      if (!helper || helper.exitCode !== null || helper.signalCode !== null) return;
      await new Promise<void>(resolveClose => {
        helper.once('close', () => { clearTimeout(timer); resolveClose(); });
        const timer = setTimeout(() => helper.kill(), 2000);
        helper.stdin.end();
      });
    });
  }
}
