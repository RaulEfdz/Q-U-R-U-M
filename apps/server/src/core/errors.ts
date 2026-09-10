// fail-closed
export class QuorumError extends Error {
  constructor(readonly code: string, message: string,
    readonly retriable = false, readonly detalle: Record<string, unknown> = {}) {
    super(message); this.name = code;
  }
}
export class PolicyDenied extends QuorumError {
  constructor(reason: string, readonly policyId: string, readonly version: string) {
    super('POLICY_DENIED', reason, false, { policyId, version });
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
