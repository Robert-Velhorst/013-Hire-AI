import { win32 } from "node:path";

function resolveLocalAbsoluteDirectory(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    /[\x00-\x1f]/.test(value)
  ) {
    return null;
  }

  const normalized = win32.normalize(value);
  if (!win32.isAbsolute(normalized)) return null;

  const root = win32.parse(normalized).root;
  const driveRoot = root.startsWith("\\\\?\\") ? root.slice(4) : root;
  if (!/^[a-z]:\\$/i.test(driveRoot)) return null;

  const components = normalized.slice(root.length).split("\\");
  if (
    components.some(
      component =>
        /[<>:"|?*]/.test(component) ||
        /[ .]$/.test(component) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(component)
    )
  ) {
    return null;
  }

  return normalized;
}

function resolveDirectory(configured, fallback) {
  return configured === undefined
    ? fallback
    : resolveLocalAbsoluteDirectory(configured);
}

export function resolveWindowsDefenderPaths(
  executablePath,
  programFilesDirectory,
  programDataDirectory
) {
  const executable = resolveLocalAbsoluteDirectory(executablePath);
  if (!executable) return null;

  const root = win32.parse(executable).root;
  const driveRoot = root.startsWith("\\\\?\\") ? root.slice(4) : root;
  const programFiles = resolveDirectory(
    programFilesDirectory,
    win32.join(driveRoot, "Program Files")
  );
  const programData = resolveDirectory(
    programDataDirectory,
    win32.join(driveRoot, "ProgramData")
  );

  return {
    legacyExecutable: programFiles
      ? win32.join(programFiles, "Windows Defender", "MpCmdRun.exe")
      : null,
    platformRoot: programData
      ? win32.join(
          programData,
          "Microsoft",
          "Windows Defender",
          "Platform"
        )
      : null,
  };
}
