#include "simple_lib.h"
#include "test_helpers.h"

#include <string.h>

static void test_success()
{
	ASSERT(multiply(2, 3) == 6);
}

static void test_failure()
{
	ASSERT(multiply(2, 3) == 7);
}

int main(int argc, char **argv)
{
	if (argc < 2)
	{
		test_success();
		test_failure();
	}
	else if (strcmp(argv[1], "test_success") == 0)
	{
		test_success();
	}
	else if (strcmp(argv[1], "test_failure") == 0)
	{
		test_failure();
	}
	return 0;
}
