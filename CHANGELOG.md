# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Check that buildDir exists before loading tests
- Add CTest path autodetect from CMakeCache.txt file; this should avoid useless creation of `Testing` subdirs in non-CMake project dirs

## [0.1.0] - 2019-08-19

### Added

- First release.

[unreleased]: https://github.com/fredericbonnet/cmake-test-explorer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/fredericbonnet/cmake-test-explorer/releases/tag/v0.1.0
