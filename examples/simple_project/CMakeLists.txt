cmake_minimum_required(VERSION 3.10)
project(SimpleProject LANGUAGES C)

add_subdirectory(src)
enable_testing()
add_subdirectory(tests)
