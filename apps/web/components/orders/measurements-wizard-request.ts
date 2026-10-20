import { parentMeasurementsStaffUi as ui } from '../../lib/i18n';

type Request = (path: string, init?: RequestInit) => Promise<any>;
type Command = { fingerprint: string; path: string; body: string; result?: unknown; done: boolean };
/** Adapter only for the existing new-athlete wizard; canonical writes remain order-owned and idempotent. */
export function createOrderMeasurementsWizardRequest(orderId: string, clientId: string, request: Request, confirmDiscipline?: (discipline: string) => Promise<boolean>, explicitMeasuredAt = false) {
  const commands = new Map<string, Command>();
  let uncertain: Command | undefined;
  let inFlight = false;
  const wrapped = async (path: string, init?: RequestInit) => {
    const prefix = `/clients/${clientId}/athletes`;
    const suffix = path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : '';
    const snapshot = /^([^/]+)\/measurements$/.exec(suffix);
    if (init?.method !== 'POST' || (path !== prefix && !snapshot) || typeof init.body !== 'string') throw new Error(ui.error);
    const input = JSON.parse(init.body) as Record<string, unknown>;
    const target = `/order-tabs/${encodeURIComponent(orderId)}/athletes${snapshot ? `/${encodeURIComponent(decodeURIComponent(snapshot[1]!))}/measurements` : ''}`;
    // The wizard regenerates measuredAt on each save. Freeze its first generated date with the entered values.
    const semanticInput = { ...input }; if (snapshot && !explicitMeasuredAt) delete semanticInput.measuredAt;
    const fingerprint = JSON.stringify([target, semanticInput]);
    if (uncertain && uncertain.fingerprint !== fingerprint) throw new Error(ui.manualChangedWhileUnknown);
    let command = commands.get(fingerprint);
    if (command?.done) return command.result;
    if (inFlight) throw new Error(ui.manualUncertain);
    if (!command) {
      if (!snapshot && typeof input.discipline === 'string' && confirmDiscipline) {
        inFlight = true;
        try { if (!await confirmDiscipline(input.discipline)) throw new Error(ui.error); }
        finally { inFlight = false; }
      }
      command = { fingerprint, path: target, body: JSON.stringify({ ...input, operationKey: crypto.randomUUID() }), done: false };
      commands.set(fingerprint, command);
    }
    inFlight = true;
    try {
      const result = await request(command.path, { ...init, body: command.body });
      command.result = result; command.done = true; uncertain = undefined;
      return result;
    } catch (failure) {
      // The existing request callback does not expose HTTP status; never infer non-commit from its rejection.
      uncertain = command;
      throw new Error(ui.manualUncertain, { cause: failure });
    } finally { inFlight = false; }
  };
  wrapped.hasUncertain = () => !!uncertain || inFlight;
  return wrapped;
}
