#include "simple_lib.h"
#include <assert.h>

int main()
{
	assert(add(2, 3) == 5);
	assert(add(-1, 1) == 0);
	assert(add(0, 0) == 0);
	return 0;
}
