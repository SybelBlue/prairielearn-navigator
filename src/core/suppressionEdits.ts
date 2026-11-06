import * as path from "node:path";
import { findNodeAtLocation, Node } from "jsonc-parser";
import { courseRelativePath, isWithinDir } from "./courseFiles";
import { edit, FileEdit } from "./fileEdits";
import { parseJsonDoc } from "./json";
import { removeJsonValues } from "./jsonEdits";
import { treeOf } from "./jsonTree";

interface FileSuppression {
  entry: Node;
  fileNode: Node;
  absoluteFile: string;
}

/** File-scoped entries in an `ignoredDiagnostics` array. */
function fileSuppressions(courseRoot: string, text: string): FileSuppression[] {
  const tree = treeOf(parseJsonDoc(text));
  const array = tree && findNodeAtLocation(tree, ["ignoredDiagnostics"]);
  if (array?.type !== "array") {
    return [];
  }
  return (array.children ?? []).flatMap((entry) => {
    const fileNode = findNodeAtLocation(entry, ["file"]);
    return typeof fileNode?.value === "string"
      ? [{ entry, fileNode, absoluteFile: path.resolve(courseRoot, fileNode.value) }]
      : [];
  });
}

/** Edits keeping file-scoped suppressions with a directory move. */
export function moveFileSuppressionEdits(
  courseRoot: string,
  config: string,
  text: string,
  oldDir: string,
  newDir: string
): FileEdit[] {
  return fileSuppressions(courseRoot, text).flatMap(({ fileNode, absoluteFile }) => {
    if (!isWithinDir(oldDir, absoluteFile) || absoluteFile === oldDir) {
      return [];
    }
    const moved = courseRelativePath(
      courseRoot,
      path.join(newDir, path.relative(oldDir, absoluteFile))
    );
    return [
      edit(
        config,
        text,
        fileNode.offset,
        fileNode.offset + fileNode.length,
        JSON.stringify(moved)
      ),
    ];
  });
}

/** Edits deleting file-scoped suppressions inside removed directories. */
export function removeFileSuppressionEdits(
  courseRoot: string,
  config: string,
  text: string,
  removedDirs: readonly string[]
): FileEdit[] {
  const entries = fileSuppressions(courseRoot, text)
    .filter(({ absoluteFile }) => removedDirs.some((dir) => isWithinDir(dir, absoluteFile)))
    .map(({ entry }) => entry);
  return removeJsonValues(config, text, entries);
}
