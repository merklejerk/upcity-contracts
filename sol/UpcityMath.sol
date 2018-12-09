pragma solidity ^0.5;

// #def TO_PPM(x) round(x * PRECISION)
// #def AS_UINT64(x) `uint64(${uint64(x)})`
// #def AS_UINT256(x) `uint256(${uint256(x)})`
// #def PPM_ONE TO_PPM(1)
// #def MAX(a, b) (a >= b ? a : b)

contract UpcityMath {
	// solhint-disable-next-line
	uint64 constant PPM_ONE = $$(AS_UINT64(PPM_ONE));

	/// @dev x^y
	/// @param x base expressed in ppm (e.g., 1e6 == 1.0)
	/// @param y exponent, whole number (0<=y<256)
	/// @return x^y in ppm
	function ppm_pow(uint64 x, uint8 y) internal pure returns (uint64) {
		if (y == 0)
			return PPM_ONE;
		uint256 _x = x;
		for (uint64 i = 1; i < y; i++)
			_x = (_x * uint256(x)) / PPM_ONE;
		return uint64(_x);
	}

	/// @dev Estimate the sqrt of an integer n, returned in ppm, using small
	/// steps of the Babylonian method.
	/// @param n The integer whose sqrt is to the found, NOT in ppm.
	/// @param hint A number close to the sqrt, in ppm.
	/// @return sqrt(n) in ppm
	function est_integer_sqrt(uint64 n, uint64 hint)
			internal pure returns (uint64) {

		if (n == 0)
			return 0;
		if (n == 1)
			return PPM_ONE;
		uint256 _n = uint256(n) * PPM_ONE;
		uint256 _n2 = _n * PPM_ONE;
		uint256 r = hint == 0 ? ((uint256(n)+1) * PPM_ONE) / 2 : hint;
		// #def SQRT_ITERATIONS 2
		// #for I in range(SQRT_ITERATIONS)
		r = (r + _n2 / r) / 2;
		// #done
		return uint64(r);
	}

	/// @dev Babylonian method of computing sqrt.
	/// @param n The integer whose sqrt is to the found, NOT in ppm.
	/// @return sqrt(n) in ppm
	function integer_sqrt(uint64 n)
			internal pure returns (uint64) {

		if (n == 0)
			return 0;
		if (n == 1)
			return PPM_ONE;
		uint256 _n = uint256(n) * PPM_ONE;
		uint256 _n2 = _n * PPM_ONE;
		uint256 r = (_n / 2) | 0x1;
		// #def SQRT_ITERATIONS 8
		// #for I in range(SQRT_ITERATIONS)
		r = (r + _n2 / r) / 2;
		// #done
		return uint64(r);
	}
}
