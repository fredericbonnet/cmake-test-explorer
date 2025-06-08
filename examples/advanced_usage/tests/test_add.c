#include "simple_lib.h"
#include "test_helpers.h"

#include <string.h>

static void test_success()
{
	ASSERT(add(1, 2) == 3);
}

static void test_failure()
{
	ASSERT(add(1, 2) == 4);
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
