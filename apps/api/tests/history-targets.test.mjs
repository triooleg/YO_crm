import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTargetModule } from './overview-target-loader.mjs';
const model = loadTargetModule('history-migration/history-targets.ts');
const client = (id, extra = {}) => ({ id, displayName: id, email: null, phone: null, whatsapp: null, status: 'ACTIVE', archivedAt: null, ...extra });

test('historical candidates use exact verified contacts, canonical redirects and conflict-to-review', () => {
  const rows = [client('old', { email: 'Owner@example.test', archivedAt: new Date() }), client('canonical'), client('other', { phone: '+380991234567' })];
  const redirects = [{ sourceClientId: 'old', targetClientId: 'canonical' }];
  assert.deepEqual(model.matchCanonicalTargets({ email: 'owner@example.test' }, rows, redirects), { status: 'MATCHED', clientId: 'canonical', candidates: ['canonical'] });
  const conflicting = model.matchCanonicalTargets({ email: 'owner@example.test', phone: '+380991234567' }, rows, redirects);
  assert.equal(conflicting.status, 'REVIEW'); assert.equal(conflicting.clientId, null);
  assert.deepEqual(conflicting.candidates.sort(), ['canonical', 'other']);
  assert.equal(model.matchCanonicalTargets({ phone: '+380991234567' }, [client('local', { phone: '0991234567' })], []).status, 'REVIEW');
  assert.equal(model.matchCanonicalTargets({ phone: '0991234567' }, rows, []).status, 'REVIEW');
  assert.equal(model.matchCanonicalTargets({ email: 'owner@example.test' }, [rows[0]], []).status, 'REVIEW');
  assert.equal(model.matchCanonicalTargets({ confirmedClientId: 'missing' }, rows, redirects).status, 'REVIEW');
});

test('redirect cycles, blocked/archived matches and stale explicit targets remain review', () => {
  assert.equal(model.matchCanonicalTargets({ confirmedClientId: 'one' }, [client('one'), client('two')], [
    { sourceClientId: 'one', targetClientId: 'two' }, { sourceClientId: 'two', targetClientId: 'one' },
  ]).status, 'REVIEW');
  assert.equal(model.matchCanonicalTargets({ email: 'a@example.test' }, [client('blocked', { email: 'a@example.test', status: 'BLOCKED' })], []).status, 'REVIEW');
  assert.equal(model.matchCanonicalTargets({ email: 'a@example.test' }, [client('active', { email: 'a@example.test' }), client('archived', { email: 'a@example.test', archivedAt: new Date() })], []).status, 'REVIEW');
  assert.equal(model.matchCanonicalTargets({ confirmedClientId: 'inactive' }, [client('inactive', { status: 'INACTIVE' })], []).clientId, 'inactive');
});

test('new-client proposal requires owner-provided source identity; names never become matching proof', () => {
  for (const bad of [{ mode: 'CREATE_PROPOSAL', dialogueId: 't', displayName: 'Name only' },
    { mode: 'EXISTING', dialogueId: 't', clientId: '' }, { mode: 'CREATE_PROPOSAL', dialogueId: 't', subjectId: 'x', displayName: 'Name', clientId: 'a' }])
    assert.throws(() => model.validateTargetRequest(bad));
  assert.equal(model.validateTargetRequest({ mode: 'CREATE_PROPOSAL', dialogueId: 't', subjectId: 'owner-verified-person', displayName: 'Synthetic customer' }).mode, 'CREATE_PROPOSAL');
});
