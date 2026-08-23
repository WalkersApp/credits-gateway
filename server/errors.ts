/** Every error that is safe to show a user goes through here. Anything else
 *  becomes a generic 500 in the error handler, so internals never leak. */
export class GatewayError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "bad_request") {
    super(message);
    this.name = "GatewayError";
  }
}

export const badRequest = (m: string, code = "bad_request") => new GatewayError(m, 400, code);
export const notFound = (m = "Not found.", code = "not_found") => new GatewayError(m, 404, code);
export const conflict = (m: string, code = "conflict") => new GatewayError(m, 409, code);
export const unavailable = (m: string, code = "unavailable") => new GatewayError(m, 503, code);
