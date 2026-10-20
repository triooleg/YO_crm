import { ACCOUNTING_START, kyivDate, wageFor, percentMinor } from './tax-math';
import { hash, type TaxPolicy } from './tax-store';
import type { TaxPolicyPreviewInput, TaxPolicyPreviewResponse } from '../finance/finance-fiscal.types';

/** Advisory projection only. Publication keeps its existing authoritative CAS/validation. */
export function policyImpactPreview(d: TaxPolicyPreviewInput, revision: number, policies: TaxPolicy[], periods: { month: string; state: 'OPEN'|'CLOSED'; used: boolean; policyId?: string }[], now = new Date()): TaxPolicyPreviewResponse {
  const reasons: TaxPolicyPreviewResponse['reasons'] = [];
  const add = (code: string, month: string | null = null) => reasons.push({ code, month });
  const today = kyivDate(now), existing = policies.filter(p => p.state === 'PUBLISHED');
  if (!Number.isSafeInteger(d.expectedRevision) || d.expectedRevision !== revision) add('REVISION_MISMATCH');
  if (!d.effectiveFrom.endsWith('-01') || d.effectiveFrom < ACCOUNTING_START) add('INVALID_EFFECTIVE_DATE');
  if (existing.length && d.effectiveFrom <= today) add('HISTORICAL_POLICY_IMMUTABLE');
  if (!existing.length && d.effectiveFrom !== ACCOUNTING_START) add('INITIAL_POLICY_START_REQUIRED');
  const rates = [d.unifiedRateBps,d.militaryRateBps,d.esvRateBps];
  if (rates.some(r => !Number.isSafeInteger(r) || r < 0 || r > 10000)) add('INVALID_RATE');
  if (d.esvRateBps < 2200) add('ESV_BELOW_MINIMUM');
  if (d.fixedUnifiedMinor != null && (!Number.isSafeInteger(d.fixedUnifiedMinor) || d.fixedUnifiedMinor < 0)) add('INVALID_FIXED_AMOUNT');
  const formula = d.fixedUnifiedWageRateBps != null;
  if (formula && (!Number.isSafeInteger(d.fixedUnifiedWageRateBps) || d.fixedUnifiedWageRateBps! < 1 || d.fixedUnifiedWageRateBps! > 2000)) add('INVALID_FIXED_WAGE_RATE');
  if (formula && (d.group !== 2 || d.unifiedMode !== 'FIXED' || d.unifiedRateBps !== 0 || d.fixedUnifiedMinor != null)) add('FIXED_WAGE_MODE_INVALID');
  if (d.unifiedMode === 'FIXED' && d.fixedUnifiedMinor == null && !formula) add('FIXED_AMOUNT_REQUIRED');
  if (d.group === 3 && (d.unifiedMode !== 'PERCENT' || d.fixedUnifiedMinor != null || formula)) add('GROUP3_MODE_INVALID');
  if (d.group === 2 && (d.unifiedMode !== 'FIXED' || d.unifiedRateBps !== 0 || !['01','04','07','10'].includes(d.effectiveFrom.slice(5,7)) || !d.transitionEvidence?.trim())) add('GROUP2_TRANSITION_EVIDENCE_REQUIRED');
  if ((d.group === 3 && (d.unifiedRateBps !== 500 || d.militaryRateBps !== 100) || d.group === 2 && d.militaryRateBps !== 1000 || d.esvRateBps !== 2200) && !d.transitionEvidence?.trim()) add('OFFICIAL_RULE_EVIDENCE_REQUIRED');
  if (d.effectiveFrom === ACCOUNTING_START && (d.group !== 3 || d.unifiedRateBps !== 500 || d.militaryRateBps !== 100 || d.esvRateBps !== 2200)) add('INITIAL_POLICY_RULES_INVALID');
  const january = wageFor(d.effectiveFrom.slice(0,4)+'-01-01');
  if (!january) add('OFFICIAL_BASIS_PENDING');
  if (d.group === 2 && january && Number.isSafeInteger(d.fixedUnifiedMinor) && d.fixedUnifiedMinor! > percentMinor(january.minor,2000)) add('FIXED_AMOUNT_ABOVE_MAXIMUM');
  const proposed = { ...d, id: 'proposed', snapshot: { transitionEvidence: d.transitionEvidence } };
  const schedule = [...existing.filter(p => p.id !== d.supersedesId), proposed].sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  for (let i=1;i<schedule.length;i++) { const before=schedule[i-1]!,after=schedule[i]!; if (before.group!==after.group && (!['01','04','07','10'].includes(after.effectiveFrom.slice(5,7)) || !after.snapshot.transitionEvidence?.trim())) add('GROUP_TRANSITION_EVIDENCE_REQUIRED'); }
  if (existing.some(p => p.effectiveFrom === d.effectiveFrom && p.id !== d.supersedesId)) add('POLICY_DATE_EXISTS');
  const prior = existing.find(p => p.id === d.supersedesId);
  if (d.supersedesId && (!prior || prior.effectiveFrom <= today)) add('SUPERSEDED_POLICY_NOT_UNUSED_FUTURE');
  const nextDate = schedule.find(p => p.effectiveFrom > d.effectiveFrom)?.effectiveFrom ?? '9999-12-01';
  const affectedPeriods = periods.filter(p => p.month >= d.effectiveFrom.slice(0,7) && p.month < nextDate.slice(0,7)).map(p => ({ month:p.month,state:p.state,used:p.used }));
  for (const p of affectedPeriods) add('PERIOD_ALREADY_FROZEN',p.month);
  if (prior && periods.some(p => p.policyId === prior.id)) add('SUPERSEDED_POLICY_USED');
  const fields = { effectiveFrom:d.effectiveFrom,group:d.group,unifiedMode:d.unifiedMode,unifiedRateBps:d.unifiedRateBps,fixedUnifiedMinor:d.fixedUnifiedMinor??null,fixedUnifiedWageRateBps:d.fixedUnifiedWageRateBps??null,militaryRateBps:d.militaryRateBps,esvRateBps:d.esvRateBps,transitionEvidence:d.transitionEvidence??null,supersedesId:d.supersedesId??null };
  return { previewRevision:revision,fieldSignature:hash(fields),affectedPeriods,publicationBlocked:reasons.some(r => r.code !== 'OFFICIAL_BASIS_PENDING'),reasons };
}
