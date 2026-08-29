# AI-SPEC — Phase 8: Intelligence foundation

## 1. System classification

**Type:** hybrid conversational assistant, structured extraction and future RAG. Current mode is human-in-the-loop `ASSIST` only.

The system prepares grounded drafts for YOleotard managers. CRM orders, production, payments and shipping remain authoritative; messages are customer statements; agreements are explicitly confirmed conditions; knowledge is company policy; summaries and analyses are derived.

Critical failures:

1. inventing price, payment, deadline, production or shipping state;
2. sending to a customer without an explicit employee action;
3. treating an inferred customer statement as a verified agreement or CRM state;
4. leaking Meta tokens, API keys, passwords or unrestricted raw payloads to a model;
5. losing provenance or the difference between an AI draft and the sent answer.

## 1b. Domain context

**Vertical:** custom sportswear production and international customer service. **Stakes:** high: wrong promises affect competitions, payments and made-to-measure production.

| Dimension | Good | Bad | Stakes |
|---|---|---|---|
| Deadline | Uses current order/production state and states uncertainty | Invents or changes a deadline | Critical |
| Payment | Reads Finance status | Treats “I paid” as receipt | Critical |
| Design | Separates request from confirmed agreement | Presents a request as agreed | High |
| Measurements | References dated snapshots | Overwrites or guesses measurements | Critical |
| Tone/language | Clear, professional, preserves formatting | Loses intent or pressures customer | Medium |

Known domain failures include confusing several athletes of one client, using an old competition date, mixing ready/custom model terms, and promising delivery without production plus carrier context. GDPR/data-minimisation and Meta platform data obligations apply. Owners/managers label the initial evaluation dataset; production and finance review their respective factual dimensions.

## 2. Framework decision

**Selected:** no external agent framework in P0; NestJS services + Prisma outbox + provider interface.

This matches the existing TypeScript modular monolith, keeps orchestration auditable, and avoids adopting a state-machine or RAG framework before workflows require it. `LlmProvider` prevents model lock-in. LangGraph is a later option for genuinely stateful approved tool workflows; LlamaIndex is a later option if knowledge retrieval complexity justifies it. Vendor lock-in is not accepted in the data model.

## 3. Quick reference

No additional runtime package is required in P0.

```ts
const context = await contextBuilder.build({ clientId, messageIds });
const run = await aiRuns.start({ operation: "REPLY", provider, model, contextSnapshot: context, ... });
const draft = await provider.generate({ input: prompt, model, maxOutputTokens: 1600, operation: "REPLY" });
await aiRuns.complete(run.id, draft.text, latencyMs);
```

Key abstractions are `ContextBuilderService`, `LlmProvider`, `AiRunService`, `ToolService`, structured provenance models and the transactional `AiJob` outbox. Provider calls never run in webhook transactions.

Pitfalls: passing whole Prisma records/raw payloads into prompts; allowing provider-specific types into persistence; performing writes without server-side permission checks; enabling polling without retry/dead-letter policy at scale.

## 4. Implementation guidance

- Model/provider configuration remains in settings/environment; secrets are encrypted or server-only.
- Context is a whitelist projection of client, active CRM state, recent messages, active memory/facts/agreements and valid published knowledge.
- Old conversation content will use summaries plus a recent full-message window in P1.
- Tools are registered with `READ_ONLY`, `SAFE_WRITE`, `REQUIRES_APPROVAL`, or `HIGH_RISK`. P0 does not autonomously execute them.
- P0 analysis is deterministic and free; paid/provider analysis can replace it behind the same boundary and version.

### Structured output validation

The repository uses TypeScript `class-validator`/explicit parsers rather than Pydantic. Any provider structured output must be parsed into a DTO/schema, rejected on mismatch, and retried at most once outside the webhook path.

```ts
type MessageAnalysisOutput = { language?: string; intent: string; requiresReply: boolean; confidence: number };
const parsed = parseAndValidate<MessageAnalysisOutput>(providerJson);
```

Async-first: webhook validates, persists message plus optional job in one transaction, then returns. Worker analysis updates derived tables. Prompts are versioned records; content is data, never instructions. Context size is bounded (30 recent messages, 5 active orders, 10 knowledge items). Cost/latency are stored on `AiRun`; automatic sending stays off.

## 5. Evaluation strategy

| Dimension | Rubric | Approach | Priority |
|---|---|---|---|
| CRM factual grounding | No unsupported payment/deadline/status claim | Code + human | Critical |
| Agreement fidelity | Request and agreed condition never conflated | Code + human | Critical |
| Escalation | Unknown/high-risk cases require manager | Code + human | Critical |
| Extraction provenance | Every fact links to source and version | Code | Critical |
| Draft usefulness | Manager accepts or makes small edit | Feedback metric + human | High |
| Language/tone | Correct language and professional formatting | Human, later calibrated judge | Medium |

Start with 20 examples: price/payment, deadline, measurements, design changes, multiple athletes, media-only messages, unsupported requests, prompt injection, and multilingual conversations. Owners/managers label; finance and production approve domain-specific expected facts. P0 uses deterministic tests and stored feedback. Promptfoo/Arize Phoenix are candidates for P1; no new observability infrastructure is deployed now.

## 6. Guardrails

| Guardrail | Trigger | Intervention |
|---|---|---|
| No automatic send | Any generated draft | Require employee send action |
| Source-of-truth protection | Payment/deadline/status claim | Ground from CRM or mark unknown |
| Secret/data whitelist | Context construction | Exclude secrets/raw payload/passwords |
| Tool permission | Write/high-risk tool | Require approval or block |
| AI off switch | `AI_ENABLED=false` or mode `OFF` | Skip processing/generation |

Offline: sample edited/rejected drafts, provider failures and low-confidence extractions; review regressions before activating a new prompt/model.

## 7. Monitoring

P0 uses `AiRun` and existing audit logs. P1 may export traces to self-hosted Arize Phoenix or Langfuse after a privacy review. Track draft acceptance/edit rate, unsupported-claim failures, extraction confidence, provider latency/error rate, and cost. Alert on any autonomous send, secret-shaped context value, or repeated failed jobs.

## Checklist

- [x] System and failure modes classified
- [x] Domain criteria and compliance identified
- [x] Framework choice and alternatives documented
- [x] Async/provider/context/tool patterns specified
- [x] Evaluation dimensions and reference dataset specified
- [x] Online guardrails defined
- [x] Monitoring and later tracing direction defined

## P1A — AI Control Center contract

P1A keeps the native NestJS/Prisma architecture. It adds control-plane configuration, not a new agent framework. The authoritative resolution order is `ENV server safety policy → GLOBAL database setting → CHANNEL → CLIENT → CONVERSATION`. A lower scope may disable an inherited capability but cannot grant anything denied by a higher scope.

Only `OFF` and `SHADOW` are activatable. `ASSIST`, `AUTO_SAFE`, `AGENT` and `AUTONOMOUS` remain visible architectural states but are rejected by the API. Automatic replies, memory auto-promotion, agreement auto-confirmation and CRM writes have no writable runtime path. Provider/model values are effective read-only server values; keys and arbitrary endpoints are never returned or accepted.

`AiRuntimeSetting` stores typed, scoped values with the updating actor and timestamps. Every mutation is validated against a server registry, bounded, performed transactionally and appended to `AuditLog` with old/new values. Effective configuration and 24-hour operational statistics are exposed through an OWNER/ADMIN read endpoint; only OWNER may mutate settings.

Shadow rollout is deterministic by conversation/client identity (`FNV-1a % 100 < percentage`) at 0/10/25/50/100 percent. The same identity remains consistently selected. The job worker consumes effective configuration and never calls message delivery.

P1A tests lock: ENV OFF dominance, master OFF dominance, lower-scope non-escalation, channel disable, deterministic rollout, bounded limits, forbidden modes/capabilities, audit creation, real effective status, and absence of automatic send.
