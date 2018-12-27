pragma solidity ^0.5;

// #def NUM_WEEKS 52

// #def ONE_WEEK 365.25 / NUM_WEEKS

// #def ONE_DAY 24 * 60 * 60

// #def ONE_TOKEN 10**DECIMALS

// #def NEIGHBOR_OFFSET(idx) (((int32(idx)%3)-1), (1-int32(idx)/2))

// #def ARRAY_SEP concat(",\n", __indent)

// #def UNPACK_BLOCK(blocks, idx) uint8(uint128(blocks) >> (8*(idx)))

// #def UINT256_ARRAY(count, value) \
// 	map(filled(count, value), AS_UINT256)

// #def UINT64_ARRAY(count, value) \
// 	map(filled(count, value), AS_UINT64)

// #def UINT8_ARRAY(count, value) \
// 	map(filled(count, value), AS_UINT64)

// #def TO_PPM(x) round(x * PRECISION)

// #def AS_UINT64(x) `uint64($${uint64(x)})`

// #def AS_UINT256(x) `uint256($${uint256(x)})`

// #def PPM_ONE TO_PPM(1)

// #def MAX(a, b) ((a) >= (b) ? (a) : (b))

// #if TEST
// #def BLOCKTIME _blockTime
// #else
// #def BLOCKTIME uint64(block.timestamp)
// #endif

/// @title Constants and types for UpCityGame
contract UpcityBase {

	struct Tile {
		bytes16 id;
		bytes16 blocks;
		uint32 timesBought;
		uint64 lastTouchTime;
		int32 x;
		int32 y;
		uint8 height;
		uint8 neighborCloutsTotal;
		address owner;
		uint256 basePrice;
		uint256[NUM_RESOURCES] sharedResources;
		uint256 sharedFunds;
	}

	struct BlockStats {
		uint64 count;
		uint256 score;
		uint256 production;
	}

	// solhint-disable
	address internal constant ZERO_ADDRESS = address(0x0);
	uint8 internal constant DECIMALS = $$(DECIMALS);
	uint64 internal constant PPM_ONE = $$(AS_UINT64(PPM_ONE));
	uint256 internal constant ONE_TOKEN = $$(ONE_TOKEN);
	uint256 internal constant ONE_DAY = $$(ONE_DAY);
	uint8 internal constant ONITE_BLOCK = $$(ONITE_BLOCK);
	uint8 internal constant TOPITE_BLOCK = $$(TOPITE_BLOCK);
	uint8 internal constant RUBITE_BLOCK = $$(RUBITE_BLOCK);
	uint8 internal constant MAX_BLOCK_VALUE = RUBITE_BLOCK;
	uint8 internal constant NUM_RESOURCES = $$(NUM_RESOURCES);
	uint8 internal constant NUM_NEIGHBORS = $$(NUM_NEIGHBORS);
	uint8 internal constant MAX_HEIGHT = $(MAX_HEIGHT);
	bytes16 internal constant EMPTY_BLOCKS = $$(hex(2**(8*MAX_HEIGHT)-1));
	uint64 internal constant TAX_RATE = $$(TO_PPM(1/NUM_NEIGHBORS));
	uint256 internal constant MINIMUM_TILE_PRICE = $$(int(ONE_TOKEN * MINIMUM_TILE_PRICE));
	uint64 internal constant PURCHASE_MARKUP = $$(TO_PPM(1+PURCHASE_MARKUP));
	uint64 internal constant NUM_WEEKS = $$(NUM_WEEKS);
	uint64 internal constant ONE_WEEK = $$(uint64(ONE_DAY * ONE_WEEK));
	uint64 internal constant CALENDAR_START = $$(uint64(CALENDAR_START));
	uint64 internal constant SEASON_PRICE_BONUS = $$(TO_PPM(1+SEASON_PRICE_BONUS));
	uint64 internal constant SEASON_YIELD_BONUS = $$(TO_PPM(1+SEASON_YIELD_BONUS));
	// #def BLOCK_HEIGHT_PREMIUM_BASE 4**(1/(MAX_HEIGHT-1))
	// In PPM.
	uint64[MAX_HEIGHT] BLOCK_HEIGHT_PREMIUM = [
		$$(join(map(range(MAX_HEIGHT),
		h => AS_UINT64(TO_PPM(BLOCK_HEIGHT_PREMIUM_BASE**h))), ARRAY_SEP))
	];
	// #def BLOCK_HEIGHT_BONUS_BASE 2**(1/(MAX_HEIGHT-1))
	// In PPM.
	uint64[MAX_HEIGHT] BLOCK_HEIGHT_BONUS = [
		$$(join(map(range(MAX_HEIGHT),
		h => AS_UINT64(TO_PPM(BLOCK_HEIGHT_BONUS_BASE**h))), ARRAY_SEP))
	];
	uint64[NUM_RESOURCES] RESOURCE_ALPHAS = $$(map([0.05, 0.25, 0.66], TO_PPM));
	uint256[NUM_RESOURCES][NUM_RESOURCES] RECIPES = [
		[3, 1, 1],
		[1, 3, 1],
		[1, 1, 3]
	];
	// solhint-enable

	function _toTaxed(uint256 amount) internal pure returns (uint256) {
		return amount - (amount * TAX_RATE) / PPM_ONE;
	}

	function _toTaxes(uint256 amount) internal pure returns (uint256) {
		return (amount * TAX_RATE) / PPM_ONE;
	}

	function _toTileId(int32 x, int32 y) internal view returns (bytes16) {
		return bytes16(keccak256(abi.encodePacked(x, y, address(this))));
	}

	function _isValidBlock(uint8 _block) internal pure returns (bool) {
		return _block <= MAX_BLOCK_VALUE;
	}

	function _isValidHeight(uint8 height) internal pure returns (bool) {
		return height <= MAX_HEIGHT;
	}

	function _assignBlocks(bytes16 a, bytes16 b, uint8 idx, uint8 count)
			internal pure returns (bytes16) {

		uint128 mask = ((uint128(1) << (count*8)) - 1) << (idx*8);
		uint128 v = uint128(b) << (idx*8);
		return bytes16((uint128(a) & ~mask) | (v & mask));
	}

	function _getCalendarWeek() internal view returns (uint64) {
		return ((uint64(block.timestamp) - CALENDAR_START) / ONE_WEEK) % NUM_WEEKS;
	}

	/// @dev Estimate the sqrt of an integer n, returned in ppm, using small
	/// steps of the Babylonian method.
	/// @param n The integer whose sqrt is to the found, NOT in ppm.
	/// @param hint A number close to the sqrt, in ppm.
	/// @return sqrt(n) in ppm
	function _est_integer_sqrt(uint64 n, uint64 hint)
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

	// #if TEST
	// solhint-disable
	/* Test functions/properties. *******************************************/

	uint64 public _blockTime = uint64(block.timestamp);

	function __setBlockTime(uint64 t) public {
		_blockTime = t;
	}

	function __advanceTime(uint64 dt) public {
		_blockTime += dt;
	}
	// #endif
}
