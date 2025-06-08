file(GLOB TEST_SOURCES "*.c")

add_executable(test_add test_add.c)
target_link_libraries(test_add simple_lib)

add_test(NAME test_add:test_success COMMAND test_add test_success)
set_tests_properties(test_add:test_success PROPERTIES
    ENVIRONMENT "TEST_FILE=${CMAKE_CURRENT_SOURCE_DIR}/test_add.c;TEST_LINE=6"
    )
add_test(NAME test_add:test_failure COMMAND test_add test_failure)
set_tests_properties(test_add:test_failure PROPERTIES
    ENVIRONMENT "TEST_FILE=${CMAKE_CURRENT_SOURCE_DIR}/test_add.c;TEST_LINE=11"
)

add_executable(test_multiply test_multiply.c)
target_link_libraries(test_multiply simple_lib)

add_test(NAME test_multiply:test_success COMMAND test_multiply test_success)
set_tests_properties(test_multiply:test_success PROPERTIES
    ENVIRONMENT "TEST_FILE=${CMAKE_CURRENT_SOURCE_DIR}/test_multiply.c;TEST_LINE=6"
    )
add_test(NAME test_multiply:test_failure COMMAND test_multiply test_failure)
set_tests_properties(test_multiply:test_failure PROPERTIES
    ENVIRONMENT "TEST_FILE=${CMAKE_CURRENT_SOURCE_DIR}/test_multiply.c;TEST_LINE=11"
)
