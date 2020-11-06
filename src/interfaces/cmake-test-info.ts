/**
 * CMake test metadata
 *
 * `ctest --show-only=json-v1` outputs test info in JSON format
 *
 * @see JSON Object Model https://cmake.org/cmake/help/latest/manual/ctest.1.html#show-as-json-object-model
 *
 * @remarks We only declare the subset we need
 */
export interface CmakeTestInfo {
  name: string;
  config: string;
  command: string[];
  properties: {
    name: string;
    value: string | string[];
  }[];
}
