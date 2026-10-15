export interface DatabaseAcceptanceEnvironment {
  HIRE_AI_DATABASE_ACCEPTANCE?: string;
  NODE_ENV?: string;
  DATABASE_URL?: string;
}

export function isDatabaseAcceptanceTarget(
  environment?: DatabaseAcceptanceEnvironment
): boolean;
