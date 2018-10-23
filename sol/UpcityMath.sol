library UpcityMath {
	uint32 constant PPM_ONE = 10**6;

	/// @dev x^y
	/// @param x base expressed in ppm (e.g., 1e6 == 1.0)
	/// @param y exponent, whole number (0<=y<256)
	function ppm_pow(uint32 x, uint8 y) pure returns (uint32) {
		if (y == 0)
			return PPM_ONE;
		uint32 _x = x;
		for (uint32 i = 1; i < y; i++)
			_x = (_x * x) / PPM_ONE;
		return _x;
	}

	function ppm_sqrt(uint32 x, uint32 hint) pure returns (uint32) {
		if (x == 0)
			return 0;
		if (x == PPM_ONE)
			return PPM_ONE;
		uint32 r = hint;
		for (uint i = 0; i < 8; i++)
			r = (r + (n * PPM_ONE) / r) / 2
		return r;
	}

	function ppm_sqrt(uint32 x) pure returns (uint32) {
		return ppm_sqrt(x, (x+1)/2);
	}

}
