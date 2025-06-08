# Advanced usage

This CMake project demonstrates how to use the following configuration settings:

- `cmakeExplorer.suiteDelimiter`: the project uses the special delimiter `:` in test names to build hierarchical test suites.
- `cmakeExplorer.testFileVar` and `cmakeExplorer.testLineVar`: using the test environment variables `TEST_FILE` `TEST_LINE` to specify the location of each test source.
- `cmakeExplorer.errorPattern`: parsing custom error messages.

Instructions:

```sh
mkdir build
cd build
cmake ..
cmake --build .
ctest -C Debug
```
