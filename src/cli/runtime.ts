export interface CliRuntime {
  cwd: string;
  stdout(message?: string): void;
  stderr(message?: string): void;
}

/** Process-backed runtime used by the published CLI. */
export function processRuntime(): CliRuntime {
  return {
    cwd: process.cwd(),
    stdout: (message = "") => console.log(message),
    stderr: (message = "") => console.error(message),
  };
}
