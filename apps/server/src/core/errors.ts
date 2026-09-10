// fail-closed
//
// ★ Sin `parameter properties` (`constructor(readonly code: string)`) a
// propósito: el proyecto corre con `node --experimental-strip-types`, que es
// strip-ONLY — no transforma, solo borra tipos. Una parameter property no es
// una anotación borrable (genera la asignación `this.code = code`), así que
// Node la rechaza con `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` y el proceso ni
// arranca. `tsc --noEmit` la acepta sin chistar, así que el typecheck pasa en
// verde y el fallo aparece recién al correr `npm start`. Los campos se
// declaran y asignan explícitos: mismo API público, misma forma en runtime.
export class QuorumError extends Error {
  readonly code: string;
  readonly retriable: boolean;
  readonly detalle: Record<string, unknown>;

  constructor(code: string, message: string,
    retriable = false, detalle: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.retriable = retriable;
    this.detalle = detalle;
    this.name = code;
  }
}
export class PolicyDenied extends QuorumError {
  readonly policyId: string;
  readonly version: string;

  constructor(reason: string, policyId: string, version: string) {
    super('POLICY_DENIED', reason, false, { policyId, version });
    this.policyId = policyId;
    this.version = version;
  }
}
export class ValidationError extends QuorumError {
  constructor(m: string, d: Record<string, unknown> = {}) { super('VALIDATION_ERROR', m, false, d); }
}
export class DelegationViolation extends QuorumError {
  constructor(m: string) { super('DELEGATION_VIOLATION', m, false); }
}
export class BudgetExceeded extends QuorumError {
  constructor(m: string) { super('BUDGET_EXCEEDED', m, false); }
}
