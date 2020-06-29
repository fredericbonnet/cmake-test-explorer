# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[unreleased]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/fredericbonnet/cmake-test-explorer/releases/tag/v0.1.0
