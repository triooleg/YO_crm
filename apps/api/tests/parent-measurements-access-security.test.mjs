import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
require('reflect-metadata');
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true,
  } }).outputText;
  new Function('require', 'module', 'exports', source)(name => {
    if (name.endsWith('/prisma.service')) return { PrismaService: class {} };
    const target = resolve(dirname(file), name + '.ts');
    return name.startsWith('.') && existsSync(target) ? load(target) : require(name);
  }, module, module.exports);
  return module.exports;
}
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../src/parent-measurements');
const security = load(resolve(sourceRoot, 'parent-measurements-security.ts'));

test('production public intake is opt-in and disabling it leaves unrelated routes alone', async () => {
  const priorNode=process.env.NODE_ENV, priorFlag=process.env.PARENT_MEASUREMENTS_ENABLED;
  try {
    process.env.NODE_ENV='production'; delete process.env.PARENT_MEASUREMENTS_ENABLED;
    assert.throws(()=>security.assertParentMeasurementsEnabled(),e=>e.getStatus()===503);
    let limits=0;
    const middleware=security.createParentMeasurementsSecurityMiddleware(async()=>{limits++;});
    for(const path of ['/api/public/parent-measurements/start','/api/public/parent-measurements/children/own/submit']){
      let failure; await middleware({originalUrl:path,headers:{},method:'POST'},{setHeader(){}},error=>{failure=error;});
      assert.equal(failure.getStatus(),503);
    }
    for(const path of ['/api/auth/me','/api/orders','/api/communications']){
      let passed=false; await middleware({originalUrl:path,headers:{},method:'GET'},{setHeader(){}},error=>{assert.equal(error,undefined);passed=true;});
      assert.equal(passed,true);
    }
    assert.equal(limits,0);
    process.env.PARENT_MEASUREMENTS_ENABLED='true'; assert.doesNotThrow(()=>security.assertParentMeasurementsEnabled());
    process.env.PARENT_MEASUREMENTS_ENABLED='false'; assert.throws(()=>security.assertParentMeasurementsEnabled(),e=>e.getStatus()===503);
    process.env.NODE_ENV='test'; assert.doesNotThrow(()=>security.assertParentMeasurementsEnabled());
  } finally {
    if(priorNode===undefined)delete process.env.NODE_ENV; else process.env.NODE_ENV=priorNode;
    if(priorFlag===undefined)delete process.env.PARENT_MEASUREMENTS_ENABLED; else process.env.PARENT_MEASUREMENTS_ENABLED=priorFlag;
  }
});

test('independent capability purposes cannot exchange invite, session or recovery secrets', () => {
  const invite = security.newParentMeasurementsToken();
  const session = security.newParentMeasurementsToken();
  assert.match(invite, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(invite, session);
  const hashes = ['INVITE', 'SESSION', 'RECOVERY'].map(kind => security.hashParentMeasurementsToken(kind, invite));
  assert.equal(new Set(hashes).size, 3);
  for (const hash of hashes) { assert.match(hash, /^[a-f0-9]{64}$/); assert.notEqual(hash, invite); }
  assert.notEqual(security.parentMeasurementsCsrf(session), security.hashParentMeasurementsToken('SESSION', session));
  assert.throws(() => security.hashParentMeasurementsToken('INVITE', 'too-short'), e => e.getStatus() === 401);
});

const request = (patch = {}) => ({
  method: 'POST', originalUrl: '/api/public/parent-measurements/children', ip: '127.0.0.1',
  headers: { origin: 'http://localhost:3500', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
  ...patch,
});

test('namespace mutations require exact configured Origin, JSON and a session-bound CSRF proof', () => {
  const expected = security.parentMeasurementsCsrf(security.newParentMeasurementsToken());
  const valid = request(); valid.headers['x-pm-csrf'] = expected;
  assert.doesNotThrow(() => security.assertParentMeasurementsRequest(valid, expected));
  for (const headers of [
    {}, { ...valid.headers, origin: 'http://localhost:3500.evil.test' },
    { ...valid.headers, origin: 'null' }, { ...valid.headers, 'content-type': 'text/plain' },
    { ...valid.headers, 'sec-fetch-site': 'cross-site' }, { ...valid.headers, 'x-pm-csrf': '0'.repeat(64) },
  ]) assert.throws(() => security.assertParentMeasurementsRequest(request({ headers }), expected), e => e.getStatus() === 403);
  // Start/recover have no session yet; Origin/JSON are still mandatory.
  assert.doesNotThrow(() => security.assertParentMeasurementsRequest(request()));
});

test('middleware protects errors and limits IP before capability lookup without touching unrelated routes', async () => {
  const limits = []; const headers = {};
  const middleware = security.createParentMeasurementsSecurityMiddleware(async (...args) => { limits.push(args); });
  const response = { setHeader: (name, value) => { headers[name] = value; } };
  let error;
  await middleware(request({ originalUrl: '/api/public/parent-measurements/start' }), response, e => { error = e; });
  assert.equal(error, undefined);
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
  assert.deepEqual(limits[0], ['start-ip', '127.0.0.1', 10, 600]);
  await middleware(request({ headers: {} }), response, e => { error = e; });
  assert.equal(error.getStatus(), 403);
  const calls = limits.length;
  await middleware(request({ originalUrl: '/api/auth/login' }), response, () => {});
  assert.equal(limits.length, calls);
});

test('cookie helpers preserve a separate host-only scoped cookie and reject duplicate authentication cookies', () => {
  const options = security.parentMeasurementsCookieOptions(new Date('2030-01-01T00:00:00Z'));
  assert.equal(security.PM_COOKIE_NAME, 'yo_pm_session');
  assert.equal(options.path, '/api/public/parent-measurements');
  assert.equal(options.httpOnly, true); assert.equal(options.sameSite, 'lax');
  assert.equal(options.domain, undefined);
  const raw = security.newParentMeasurementsToken();
  assert.equal(security.readParentMeasurementsCookie(request({ headers: { cookie: `yo_pm_session=${raw}` } })), raw);
  assert.throws(() => security.readParentMeasurementsCookie(request({ headers: { cookie: `yo_pm_session=${raw}; yo_pm_session=${raw}` } })), e => e.getStatus() === 401);
});

test('whole-controller guard bootstraps only start/recover and authenticates every other route', async () => {
  const { ParentMeasurementsGuard } = load(resolve(sourceRoot, 'parent-measurements.guard.ts'));
  const raw = security.newParentMeasurementsToken(), csrf = security.parentMeasurementsCsrf(raw);
  const context = { participantId: 'parent', invitationId: 'invite', credentialId: 'credential', orderId: 'order', clientIdAtIssue: 'client', csrfToken: csrf };
  let authentications = 0; const limits = [];
  const access = { authenticate: async token => { authentications++; assert.equal(token, raw); return context; } };
  const guard = new ParentMeasurementsGuard(access, async (...args) => { limits.push(args); });
  const response = { setHeader() {} };
  const execution = req => ({ switchToHttp: () => ({ getRequest: () => req, getResponse: () => response }) });
  for (const endpoint of ['start', 'recover']) {
    assert.equal(await guard.canActivate(execution(request({ originalUrl: `/api/public/parent-measurements/${endpoint}` }))), true);
  }
  assert.equal(authentications, 0);
  await assert.rejects(guard.canActivate(execution(request())), e => e.getStatus() === 401);
  const valid = request(); Object.assign(valid.headers, { cookie: `yo_pm_session=${raw}`, 'x-pm-csrf': csrf });
  assert.equal(await guard.canActivate(execution(valid)), true);
  assert.equal(valid.parentMeasurements, context);
  assert.deepEqual(limits[0], ['draft', 'parent', 120, 600]);
  const missingCsrf = request({ headers: { ...valid.headers, 'x-pm-csrf': undefined } });
  await assert.rejects(guard.canActivate(execution(missingCsrf)), e => e.getStatus() === 403);
  assert.equal(missingCsrf.parentMeasurements, undefined);
  // Staff cookies and test-mode auth can never replace a participant secret.
  await assert.rejects(guard.canActivate(execution(request({ headers: { ...valid.headers, cookie: `yoleotard_crm_session=${raw}` } }))), e => e.getStatus() === 401);
});

test('Redis outage closes exchanges; rate errors retain no-store and Retry-After', async () => {
  const previous = process.env.REDIS_URL;
  try {
    delete process.env.REDIS_URL;
    await assert.rejects(security.enforceParentMeasurementsRateLimit('start-ip', '127.0.0.1', 10, 600), e => e.getStatus() === 503);
  } finally { if (previous === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = previous; }
  const { HttpException } = require('@nestjs/common'); const headers = {};
  const middleware = security.createParentMeasurementsSecurityMiddleware(async () => { throw new HttpException('limit', 429); });
  let failure;
  await middleware(request({ originalUrl: '/api/public/parent-measurements/recover' }), { setHeader: (name, value) => { headers[name] = value; } }, error => { failure = error; });
  assert.equal(failure.getStatus(), 429); assert.equal(headers['Retry-After'], '900');
  assert.equal(headers['Cache-Control'], 'no-store');
});
