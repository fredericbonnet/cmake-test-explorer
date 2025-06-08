# Simple Project

Minimalist CMake + CTest project, works out-of-the-box with default settings and CMake Tools.

If you don't have CMake Tools, set the `cmakeExplorer.buildConfig` setting to `Debug` for test discovery to work.

Instructions:

```sh
mkdir build
cd build
cmake ..
cmake --build .
ctest -C Debug
```
