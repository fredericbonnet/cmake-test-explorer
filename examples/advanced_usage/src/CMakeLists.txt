file(GLOB SOURCES "*.c")
add_library(simple_lib ${SOURCES})
target_include_directories(simple_lib PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/../include)
