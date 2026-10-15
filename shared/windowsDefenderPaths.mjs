import {
  join as joinWindowsPath,
  normalize as normalizeWindowsPath,
  parse as parseWindowsPath,
} from "node:path/win32";

const isDriveRoot = value => /^[a-z]:\\$/i.test(value);
const DEFENDER_PLATFORM_VERSION = /^\d+(?:\.\d+){2,4}(?:-\d+)?$/;

export function getWindowsDefenderLocations(input = {}) {
  const runtimeVolumeRoot = parseWindowsPath(
    input.runtimePath ?? process.execPath
  ).root;
  const systemRoot = input.systemRoot ?? process.env.SystemRoot;
  const systemVolumeRoot = systemRoot ? parseWindowsPath(systemRoot).root : "";
  if (
    !isDriveRoot(runtimeVolumeRoot) ||
    !isDriveRoot(systemVolumeRoot) ||
    runtimeVolumeRoot.toLowerCase() !== systemVolumeRoot.toLowerCase()
  ) {
    return null;
  }
  const volumeRoot = runtimeVolumeRoot;

  const getLocalDirectory = (value, fallback) => {
    if (!value) return fallback;
    const normalized = normalizeWindowsPath(value);
    return isDriveRoot(parseWindowsPath(normalized).root)
      ? normalized
      : fallback;
  };
  const programFiles = getLocalDirectory(
    input.programFiles,
    joinWindowsPath(volumeRoot, "Program Files")
  );
  const programData = getLocalDirectory(
    input.programData,
    joinWindowsPath(volumeRoot, "ProgramData")
  );

  return {
    legacyExecutable: joinWindowsPath(
      programFiles,
      "Windows Defender",
      "MpCmdRun.exe"
    ),
    platformRoot: joinWindowsPath(
      programData,
      "Microsoft",
      "Windows Defender",
      "Platform"
    ),
  };
}

export function getWindowsDefenderExecutableCandidates(
  locations,
  platformVersions = []
) {
  if (!locations) return [];
  const versioned = [...platformVersions]
    .filter(version => DEFENDER_PLATFORM_VERSION.test(version))
    .sort((left, right) =>
      right.localeCompare(left, undefined, { numeric: true })
    )
    .map(version =>
      joinWindowsPath(locations.platformRoot, version, "MpCmdRun.exe")
    );
  return [...versioned, locations.legacyExecutable];
}

