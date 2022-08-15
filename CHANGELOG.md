# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.16.3] - 2022-08-15

### Fixed

- Fix version issue in `package-lock.json`.

## [0.16.2] - 2022-08-15

### Fixed

- Fix npm vulnerabities.

## [0.16.1] - 2022-08-15

### Fixed

- Report disabled tests as skipped. This fixes issue #56.

## [0.16.0] - 2022-05-25

### Added

- Add support for reporting skipped tests (thanks @tustin2121!).

## [0.15.4] - 2022-03-02

### Fixed

- Allow test names with spaces in start/pass/fail regexes (thanks @barometz!).
  This fixes issue #52

## [0.15.3] - 2022-02-13

### Fixed

- Fix test detection in multi folder workspaces (thanks @Maetveis!). This fixes
  issue #46

## [0.15.2] - 2022-01-20

### Fixed

- Fix detection of crashed tests (see issue #47)
- Fix debug environment issue on macOS (see issue #48)

## [0.15.1] - 2021-11-25

### Fixed

- Fix environment handling with CodeLLDB debugger. This fixes issue #43.

## [0.15.0] - 2021-11-18

### Added

- Add support for extra CTest environment variables. This addresses issue #33.

## [0.14.2] - 2021-11-11

### Fixed

- Activate only when `CMakeLists.txt` file is present (thanks @dvirtz!)

## [0.14.1] - 2021-05-22

### Fixed

- Pass build config when running tests. This fixes issue #31.

## [0.14.0] - 2021-05-15

### Added

- Add environment variable substitutions with `${env:<VARNAME>}` syntax. This
  implements issue #28.

### Changed

- CMake Tools integration is enabled by default, with fallback to old behavior
  (thanks @HO-COOH!).

## [0.13.0] - 2021-01-27

## Fixed

- Pass environment variables to debugged tests. This fixes issue #25.

## [0.12.0] - 2021-01-05

### Changed

- Refactor test execution to use the native Ctest scheduler instead of letting
  the extension handle test process execution itself. This fixes issue #23 and
  should prevent future similar issues with resource locks/groups/fixtures/etc.

## [0.11.0] - 2020-11-07

### Added

- Add support for linking tests with source files. This implements issue #19.

## [0.10.1] - 2020-11-04

### Fixed

- Fix debug configuration handling with debuggers other than 'cppdbg' (see issue
  #22)

## [0.10.0] - 2020-08-28

### Added

- Add possibility to group tests based on delimiter in their names (thanks
  @macdems!)

### Changed

- No longer wait for CMake Tools during activation. This prevents issues with
  tests failing to load when CMake Tools integration is activated but the
  extension is not installed or activated (see issue #15).

### Fixed

- Fix issue #17 for tests with non-default `WORKING_DIRECTORY`

## [0.9.0] - 2020-07-28

### Added

- Add parallel tests execution (thanks @macdems!)

## [0.8.0] - 2020-07-14

### Added

- Add variable substitution in settings
- Add [CMake Tools](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cmake-tools) integration

Thanks to @andrewbridge for these contributions!

## [0.7.0] - 2020-06-29

### Added

- Add custom debug configurations

## [0.6.0] - 2020-05-03

### Added

- Add preliminary debug support

## [0.5.0] - 2020-03-01

### Added

- Add support for extra CTest command-line arguments

## [0.4.0] - 2019-12-02

### Fixed

- Run tests with CTest instead of executing the test commands directly. This fixes a number of issues with CTest options such as `PASS_REGULAR_EXPRESSION`. Fixes issues #4 and #5.

## [0.3.1] - 2019-11-01

### Changed

- Update README with the new `cmakeExplorer.buildConfig` setting

## [0.3.0] - 2019-11-01

### Added

- Add support for build configurations

## [0.2.0] - 2019-10-06

### Added

- Check that buildDir exists before loading tests
- Add CTest path autodetect from CMakeCache.txt file; this should avoid useless creation of `Testing` subdirs in non-CMake project dirs

### Changed

- Add better error message when using CTest version < 3.14

## [0.1.0] - 2019-08-19

### Added

- First release.

[unreleased]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.16.3...HEAD
[0.16.3]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.16.2...v0.16.3
[0.16.2]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.16.1...v0.16.2
[0.16.1]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.16.0...v0.16.1
[0.16.0]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.15.4...v0.16.0
[0.15.4]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.15.3...v0.15.4
[0.15.3]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.15.2...v0.15.3
[0.15.2]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.15.1...v0.15.2
[0.15.1]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.15.0...v0.15.1
[0.15.0]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.14.2...v0.15.0
[0.14.2]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.14.1...v0.14.2
[0.14.1]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/fredericbonnet/cmake-test-explorer/releases/tag/v0.1.0
