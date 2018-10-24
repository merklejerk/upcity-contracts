library UpcityMath {
	uint32 constant PPM_ONE = 10**6;

	/// @dev x^y
	/// @param x base expressed in ppm (e.g., 1e6 == 1.0)
	/// @param y exponent, whole number (0<=y<256)
	/// @return x^y in ppm
	function ppm_pow(uint32 x, uint8 y) internal pure returns (uint32) {
		if (y == 0)
			return PPM_ONE;
		uint256 _x = x;
		for (uint32 i = 1; i < y; i++)
			_x = (_x * x) / PPM_ONE;
		return uint32(_x);
	}

	/// @dev Estimate the sqrt of an integer n, returned in ppm, using one step
	/// of the Babylonian method.
	/// @param n The integer whose sqrt is to the found, NOT in ppm.
	/// @param hint A number close to the sqrt, in ppm.
	/// @return sqrt(n) in ppm
	function est_integer_sqrt(uint32 n, uint32 hint)
			internal pure returns (uint32) {

		if (x == 0)
			return 0;
		if (x == 1)
			return PPM_ONE;
		uint256 _n = n * PPM_ONE;
		uint256 r = hint == 0 ? r = ((n+1) * PPM_ONE)) / 2 : hint;
		r = (r + (_n * PPM_ONE) / r) / 2
		return uint32(r);
	}
}
