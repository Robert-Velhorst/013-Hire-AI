export interface WindowsDefenderPaths {
  legacyExecutable: string | null;
  platformRoot: string | null;
}

export function resolveWindowsDefenderPaths(
  executablePath: string,
  programFilesDirectory?: string,
  programDataDirectory?: string
): WindowsDefenderPaths | null;
