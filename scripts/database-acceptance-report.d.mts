export function verifyDatabaseAcceptanceReport(
  report: {
    testResults?: Array<{
      name: string;
      assertionResults?: Array<{ status: string }>;
    }>;
    numFailedTests?: number;
    numPendingTests?: number;
  },
  suites: string[],
  root: string
): string[];
