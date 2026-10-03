export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string): HttpError =>
  new HttpError(400, message);
export const notFound = (message: string): HttpError =>
  new HttpError(404, message);
export const conflict = (message: string): HttpError =>
  new HttpError(409, message);

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
