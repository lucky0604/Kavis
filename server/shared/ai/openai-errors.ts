export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export interface UpstreamErrorContext {
  baseUrl?: string;
  model: string;
  status?: number;
  code?: string;
  cause?: unknown;
  /** Chunks successfully received before the stream broke. 0 = pre-first-byte failure. */
  chunksReceived?: number;
  /** Approximate bytes of text/tool-call deltas received. */
  bytesReceived?: number;
  /** Milliseconds from request start to error. */
  elapsedMs?: number;
  /** How many retries were already attempted at error time. */
  attempt?: number;
  /** Drained Node.js error cause chain (code/errno/syscall) for premature-close diagnosis. */
  causeChain?: string;
}

export class UpstreamStreamError extends Error {
  readonly baseUrl?: string;
  readonly model: string;
  readonly status?: number;
  readonly code?: string;
  readonly cause?: unknown;
  readonly chunksReceived?: number;
  readonly bytesReceived?: number;
  readonly elapsedMs?: number;
  readonly attempt?: number;
  readonly causeChain?: string;

  constructor(message: string, ctx: UpstreamErrorContext) {
    super(message);
    this.name = 'UpstreamStreamError';
    this.baseUrl = ctx.baseUrl;
    this.model = ctx.model;
    this.status = ctx.status;
    this.code = ctx.code;
    this.cause = ctx.cause;
    this.chunksReceived = ctx.chunksReceived;
    this.bytesReceived = ctx.bytesReceived;
    this.elapsedMs = ctx.elapsedMs;
    this.attempt = ctx.attempt;
    this.causeChain = ctx.causeChain;
  }
}
