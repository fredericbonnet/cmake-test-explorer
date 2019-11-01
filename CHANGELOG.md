# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[unreleased]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/fredericbonnet/cmake-test-explorer/releases/tag/v0.1.0
