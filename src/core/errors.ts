export class DiagnosticError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "DiagnosticError";
  }
}

export function toSafeError(error: unknown): {code: string; message: string} {
  if (error instanceof DiagnosticError) {
    return {code: error.code, message: error.message};
  }

  if (error instanceof Error) {
    return {code: "UNEXPECTED_ERROR", message: error.message};
  }

  return {code: "UNEXPECTED_ERROR", message: "An unknown error occurred."};
}
