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

// The absolute path of someone's project is not the browser's business.
export function scrub(message: string, root: string): string {
  return root ? message.split(root).join('.') : message;
}
