import { readNativeApi } from "../nativeApi";

/**
 * Load the text content of a file given its absolute path.
 *
 * When `worktreePath` is provided and the file resides within it, the
 * worktree root is used as `cwd` with a relative sub-path. Otherwise the
 * file's parent directory is used as `cwd` with the basename as the
 * relative path. This keeps the loader generic for markdown artifacts,
 * code previews, and any future read-only file viewer.
 */
export async function readWorkspaceFileContent(input: {
  worktreePath: string | null;
  absolutePath: string;
}): Promise<string> {
  const api = readNativeApi();
  if (!api) throw new Error("Native API not available");

  let cwd: string;
  let relativePath: string;

  if (input.worktreePath) {
    const normalizedWorktree = input.worktreePath.replace(/[/\\]+$/, "") + "/";
    if (input.absolutePath.startsWith(normalizedWorktree)) {
      cwd = input.worktreePath;
      relativePath = input.absolutePath.slice(normalizedWorktree.length);
    } else {
      const lastSlash = input.absolutePath.lastIndexOf("/");
      cwd = lastSlash > 0 ? input.absolutePath.slice(0, lastSlash) : "/";
      relativePath = lastSlash > 0 ? input.absolutePath.slice(lastSlash + 1) : input.absolutePath;
    }
  } else {
    const lastSlash = input.absolutePath.lastIndexOf("/");
    cwd = lastSlash > 0 ? input.absolutePath.slice(0, lastSlash) : "/";
    relativePath = lastSlash > 0 ? input.absolutePath.slice(lastSlash + 1) : input.absolutePath;
  }

  const result = await api.projects.readFile({ cwd, relativePath });
  return result.content;
}
