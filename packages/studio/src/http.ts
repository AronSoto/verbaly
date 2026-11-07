// A client mistake is not a server fault, so the status rides with the error, not a blanket 500.
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message.startsWith('[verbaly]') ? message : `[verbaly] ${message}`);
    this.status = status;
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string) => new HttpError(400, message);

// Every error the panel reads comes here, so it names the project's files from `.`, not by root.
export function scrub(error: unknown, root: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return root ? message.split(root).join('.') : message;
}
