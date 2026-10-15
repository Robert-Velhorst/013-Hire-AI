export interface WindowsDefenderLocations {
  legacyExecutable: string;
  platformRoot: string;
}

export interface WindowsDefenderPathInput {
  runtimePath?: string;
  systemRoot?: string;
  programFiles?: string;
  programData?: string;
}

export function getWindowsDefenderLocations(
  input?: WindowsDefenderPathInput
): WindowsDefenderLocations | null;

export function getWindowsDefenderExecutableCandidates(
  locations: WindowsDefenderLocations | null,
  platformVersions?: string[]
): string[];

