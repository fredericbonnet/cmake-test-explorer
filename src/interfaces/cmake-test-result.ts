/**
 * CMake test result
 */
export interface CmakeTestResult {
  /** Process return code */
  code: number | null;

  /** Stdout capture */
  out?: string;
}
