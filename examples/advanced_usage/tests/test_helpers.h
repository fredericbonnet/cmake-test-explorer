#ifndef TEST_HELPERS_H
#define TEST_HELPERS_H

#include <stdlib.h>
#include <stdio.h>

#define ASSERT(expr)                                                             \
	if (!(expr))                                                                 \
	{                                                                            \
		fprintf(stderr, "%s(%d): assertion failed: " #expr, __FILE__, __LINE__); \
		exit(1);                                                                 \
	}

#endif // TEST_HELPERS_H