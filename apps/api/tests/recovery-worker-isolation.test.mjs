// Regression coverage for real recovery entry points; dependencies never use sockets or a DB.
// Run with node --test apps/api/tests/recovery-worker-isolation.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const requireApi = createRequire(resolve(root, 'apps/api/package.json'));
const ts = requireApi('typescript');
let failures = 0, passed = 0;

function fixture(mode) {
  const calls = [];
  const record = (kind, result) => (..._args) => { calls.push(kind); return result; };
  const stop = kind => (..._args) => { calls.push(kind); throw new Error('PROBE_BLOCKED_' + kind); };
  const database = new Proxy({}, { get(_target, key) {
    if (key === '$transaction') return async callback => { calls.push('DB.$transaction'); return callback(database); };
    if (String(key).startsWith('$')) return record('DB.' + String(key), Promise.resolve([]));
    return new Proxy({}, { get(_model, operation) {
      return record('DB.' + String(key) + '.' + String(operation), Promise.resolve(operation === 'findUnique' ? null : []));
    } });
  } });
  const timer = () => ({ unref() {} });
  const cache = new Map();
  class Logger { warn() {} log() {} error() {} }
  class ImapFlow {
    constructor() { calls.push('IMAP.constructor'); }
    connect = stop('IMAP.connect');
    logout = async () => {};
  }
  function load(relative) {
    const file = resolve(root, 'apps/api/src', relative);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const source = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        experimentalDecorators: true, emitDecoratorMetadata: false, esModuleInterop: true },
    }).outputText;
    function imports(name) {
      if (name.endsWith('/recovery-safety')) return load('recovery-safety.ts');
      if (name === '@nestjs/common') return { Injectable: () => target => target, Logger };
      if (name === '@prisma/client') return {
        ContactChannel: { EMAIL: 'EMAIL' }, MessageDirection: { INBOUND: 'INBOUND', OUTBOUND: 'OUTBOUND' },
        AiJobStatus: { RUNNING: 'RUNNING', PENDING: 'PENDING', FAILED: 'FAILED' }, Prisma: {},
      };
      if (name === 'imapflow') return { ImapFlow };
      if (name === 'nodemailer') return { createTransport: stop('SMTP.createTransport') };
      if (name === 'mailparser') return { simpleParser: stop('MIME.parse') };
      if (name === 'sharp') return stop('IMAGE.sharp');
      if (name === 'node:fs/promises') return new Proxy({}, { get: (_target, key) => stop('FS.' + String(key)) });
      if (name === 'node:https') return { request: stop('HTTPS.request') };
      if (name === 'node:dns/promises') return { lookup: stop('DNS.lookup') };
      if (['node:crypto', 'node:path', 'node:net', 'node:stream', 'node:buffer', 'node:util'].includes(name)) return requireApi(name);
      if (name === 'node:http') throw new Error('Unexpected runtime HTTP import: ' + name);
      if (name.endsWith('/uploads')) return { uploadsRoot: record('FS.uploadsRoot', '/synthetic-never-written') };
      // Constructor metadata/domain dependencies are injected below, never instantiated.
      if (name.startsWith('.')) return {};
      throw new Error('Unmodelled import; extend the synthetic fixture: ' + name);
    }
    vm.runInNewContext(source, {
      module, exports: module.exports, require: imports, process: { env: { APP_ENV: mode } },
      Buffer, URL, AbortSignal, console,
      fetch: stop('FETCH'),
      setInterval: (...args) => { calls.push('TIMER.interval'); return timer(); },
      setTimeout: (...args) => { calls.push('TIMER.timeout'); return timer(); },
      clearInterval() {}, clearTimeout() {},
    }, { filename: file });
    return module.exports;
  }
  const get = (file, name) => load(file)[name];
  const workers = {
    keycrm: () => new (get('keycrm/keycrm-worker.service.ts', 'KeycrmWorkerService'))({
      claimNextRun: record('DB.keycrm.claim', Promise.resolve(null)), processStep: stop('DB.keycrm.process'),
    }),
    taxes: () => new (get('taxes/taxes.worker.ts', 'TaxesWorker'))({
      catchUpMonthly: record('DB.taxes.catchUp', Promise.resolve()), reconcilePending: record('DB.taxes.reconcile', Promise.resolve()),
    }),
    ai: () => new (get('intelligence/ai-job-worker.service.ts', 'AiJobWorkerService'))(database, {
      effective: record('DB.ai.policy', Promise.resolve({ masterEnabled: false, analyzeIncoming: false })),
    }, { analyze: stop('AI.analyze') }),
    email: () => new (get('communications/email-sync.service.ts', 'EmailSyncService'))(database, {
      settings: record('DB.email.settings', Promise.resolve({ enabled: true, password: 'synthetic', username: 'probe', fromAddress: 'probe' })),
      requireReady() {},
    }, { retryEmailSentCleanup: record('DB.email.cleanup', Promise.resolve()) }),
    retention: () => new (get('parent-measurements/parent-measurements-retention.service.ts', 'ParentMeasurementsRetentionService'))(database),
  };
  return { calls, workers, get, database, stop };
}

async function check(mode, name, execute, mustReject = false) {
  const f = fixture(mode);
  try {
    let error;
    try { await execute(f); } catch (caught) { error = caught; }
    await new Promise(resolve => setImmediate(resolve));
    if (error && error.message !== 'RECOVERY_OUTBOUND_DISABLED') throw error;
    assert.equal(f.calls.length, 0, 'Isolation reached dependencies: ' + JSON.stringify(f.calls));
    if (mustReject) assert.equal(error?.message, 'RECOVERY_OUTBOUND_DISABLED', 'Expected explicit transport rejection');
    passed++; console.log('PASS', mode, name);
  } catch (error) {
    failures++; console.error('FAIL', mode, name, error.message);
  }
}

for (const mode of ['backup-drill', 'recovery-isolated']) {
  for (const name of ['keycrm', 'taxes', 'ai', 'email', 'retention']) {
    await check(mode, name + '.onModuleInit', async f => {
      const worker = f.workers[name]();
      try { await worker.onModuleInit(); } finally { worker.onModuleDestroy(); }
    });
  }
  for (const name of ['keycrm', 'taxes', 'ai', 'email']) {
    await check(mode, name + '.tick', f => f.workers[name]().tick());
  }
  await check(mode, 'retention.cleanup', f => f.workers.retention().cleanup());
  // TypeScript private methods remain callable in the transpiled runtime.
  await check(mode, 'email.backfillLegacyHtml', f => f.workers.email().backfillLegacyHtml());
  for (const method of ['send', 'verify']) {
    await check(mode, 'emailTransport.' + method, f => {
      const Transport = f.get('communications/email-transport.service.ts', 'EmailTransportService');
      return new Transport(f.database)[method]({ to: 'synthetic@example.invalid', subject: 'probe', text: 'probe' });
    }, true);
  }
  await check(mode, 'image.materializeKeycrmOrderImage', f => {
    const materialize = f.get('keycrm/keycrm-image.ts', 'materializeKeycrmOrderImage');
    return materialize('https://provider.invalid/synthetic.jpg', {
      root: '/synthetic-never-written', lookupFn: f.stop('DNS.injected'),
      requestFn: f.stop('HTTPS.injected'),
    });
  }, true);
}
console.log(`worker-isolation-probe: ${passed} passed, ${failures} failed; synthetic dependencies only`);
process.exitCode = failures ? 1 : 0;
