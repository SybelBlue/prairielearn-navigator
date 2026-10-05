/**
 * Editor-agnostic diagnostic shared by the VS Code extension and the CLI.
 * Ranges are character offsets into the checked text; adapters convert them
 * to their own position types.
 */

type Severity = "error" | "warning";

interface RelatedInfo {
  path: string;
  message: string;
}

export interface Diagnostic {
  startOffset: number;
  endOffset: number;
  message: string;
  severity: Severity;
  code?: string;
  related?: RelatedInfo[];
}

/** 1-based line/column for a character offset. */
export function offsetToPosition(
  text: string,
  offset: number
): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}
