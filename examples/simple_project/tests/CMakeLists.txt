file(GLOB TEST_SOURCES "*.c")
add_executable(test_simple_lib ${TEST_SOURCES})
target_link_libraries(test_simple_lib simple_lib)
add_test(NAME test_simple_lib COMMAND test_simple_lib)
