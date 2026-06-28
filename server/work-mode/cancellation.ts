export class CancelledError extends Error {
  constructor() {
    super('Operation cancelled');
    this.name = 'CancelledError';
  }
}

export class CancellationToken {
  private _isCancelled = false;
  private controller: AbortController;

  constructor(controller?: AbortController) {
    this.controller = controller || new AbortController();
  }

  get isCancelled(): boolean {
    return this._isCancelled;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  cancel(): void {
    this._isCancelled = true;
    this.controller.abort();
  }

  throwIfCancelled(): void {
    if (this._isCancelled) {
      throw new CancelledError();
    }
  }
}
