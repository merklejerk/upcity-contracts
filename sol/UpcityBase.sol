pragma solidity ^0.5;

// #def ONE_DAY 24 * 60 * 60

// #def SEASON_DURATION \
//		uint64((365.25 * ONE_DAY) / NUM_SEASONS / SEASON_FREQUENCY)

// #def ONE_TOKEN (1 ether)

// #def NEIGHBOR_OFFSET(idx) (((int32(idx)%3)-1), (1-int32(idx)/2))

// #def ARRAY_SEP concat(",\n", __indent)

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

// #def MAX_BLOCK_VALUE NUM_RESOURCES-1

// #def MAX(a, b) ((a) >= (b) ? (a) : (b))

// #def MIN(a, b) ((a) <= (b) ? (a) : (b))

// #if TEST
// #def BLOCKTIME __blockTime
// #else
// #def BLOCKTIME uint64(block.timestamp)
// #endif

/// @title Constants, types, and helpers for UpCityGame
/// @author Lawrence Forman (me@merklejerk.com)
contract UpcityBase {

	// Tile data.
	struct Tile {
		// Deterministic ID of the tile. Will be 0x0 if tile does not exist.
		bytes10 id;
		// Right-aligned, packed representation of blocks,
		// where 0x..FF is empty.
		bytes16 blocks;
		// The height of the tower on the tile (length of blocks).
		uint8 height;
		// NUM_NEIGHBORS + the height of each neighbor's tower.
		uint8 neighborCloutsTotal;
		// How many times the tile has been bought. Always >= 1.
		uint32 timesBought;
		// When the tile was last collected.
		uint64 lastTouchTime;
		// The x coordinate of the tile.
		int32 x;
		// The y coordinate of the tile.
		int32 y;
		// The name of the tile.
		bytes16 name;
		// The "base" price of a tile, NOT including neighborhood bonus,
		// resource costs, and seasonal bonus. This goes up every time a
		// tile is bought.
		uint256 basePrice;
		// The aggregated shared resources from neighbor tiles after
		// they do a collect().
		uint256[NUM_RESOURCES] sharedResources;
		// The aggregated shared ether from neighbor tiles. after they
		// do a collect().
		uint256 sharedFunds;
		// The aggregate scores for each resource on this tile.
		uint64[NUM_RESOURCES] scores;
		// The current owner of the tile.
		address owner;
	}

	// Global metrics, for a specific resource;
	struct BlockStats {
		// The total number of blocks of this resource, across all tiles.
		uint64 count;
		// The global production daily limit for this resource, expressed in PPM.
		// Note that this is a "soft" limit, as tiles in season produce bonus
		// resources defined by SEASON_YIELD_BONUS.
		uint64 production;
		// The total "score" of blocks of this resource, across all tiles.
		// Score for a block depends on its height.
		uint128 score;
	}

	// solhint-disable
	// Zero address (0x0).
	address internal constant ZERO_ADDRESS = address(0x0);
	// 100%, or 1.0, in parts per million.
	uint64 internal constant PPM_ONE = $$(AS_UINT64(PPM_ONE));
	// The number of wei in one token (10**18).
	uint256 internal constant ONE_TOKEN = $$(ONE_TOKEN);
	// The number of seconds in one day.
	uint64 internal constant ONE_DAY = $$(ONE_DAY);
	// The number of resource types.
	uint8 internal constant NUM_RESOURCES = $$(NUM_RESOURCES);
	// The number of neighbors for each tile.
	uint8 internal constant NUM_NEIGHBORS = $$(NUM_NEIGHBORS);
	// The maximum number of blocks that can be built on a tile.
	uint8 internal constant MAX_HEIGHT = $(MAX_HEIGHT);
	// Packed representation of an empty tower.
	bytes16 internal constant EMPTY_BLOCKS = $$(hex(2**(8*MAX_HEIGHT)-1));
	// The ratio of collected resources to share with neighbors, in ppm.
	uint64 internal constant TAX_RATE = $$(TO_PPM(TAX_RATE));
	// The minimum tile price.
	uint256 internal constant MINIMUM_TILE_PRICE = $$(uint256(ONE_TOKEN * MINIMUM_TILE_PRICE));
	// How much to increase the base tile price every time it's bought, in ppm.
	uint64 internal constant PURCHASE_MARKUP = $$(TO_PPM(1+PURCHASE_MARKUP));
	// Scaling factor for global production limits.
	uint64 internal constant PRODUCTION_ALPHA = $$(TO_PPM(PRODUCTION_ALPHA));
	// The number of seasons.
	uint64 internal constant NUM_SEASONS = $$(NUM_SEASONS);
	// The length of each season, in seconds.
	uint64 internal constant SEASON_DURATION = $$(SEASON_DURATION);
	// The start of the season calendar, in unix time.
	uint64 internal constant CALENDAR_START = $$(uint64(CALENDAR_START));
	// Multiplier for the total price of a tile when it is in season, in ppm.
	uint64 internal constant SEASON_PRICE_BONUS = $$(TO_PPM(1+SEASON_PRICE_BONUS));
	// Multiplier for to resources generated when a tile is in season, in ppm.
	uint64 internal constant SEASON_YIELD_BONUS = $$(TO_PPM(1+SEASON_YIELD_BONUS));
	// The building cost multiplier for any block at a certain height, in ppm.
	uint64[MAX_HEIGHT] internal BLOCK_HEIGHT_PREMIUM = [
		$$(join(map(range(MAX_HEIGHT),
		h => AS_UINT64(TO_PPM(BLOCK_HEIGHT_PREMIUM_BASE**h))), ARRAY_SEP))
	];
	// The yield multiplier for any block at a certain height, in ppm.
	uint64[MAX_HEIGHT] internal BLOCK_HEIGHT_BONUS = [
		$$(join(map(range(MAX_HEIGHT),
		h => AS_UINT64(TO_PPM(BLOCK_HEIGHT_BONUS_BASE**h))), ARRAY_SEP))
	];
	// The linear rate at which each block's costs increase with the total
	// blocks built, in ppm.
	uint64[NUM_RESOURCES] internal RESOURCE_ALPHAS =
		$$(map([0.05, 0.33, 0.66], TO_PPM));
	// Recipes for each block type, as whole tokens.
	uint256[NUM_RESOURCES][NUM_RESOURCES] internal RECIPES = [
		[3, 1, 1],
		[1, 3, 1],
		[1, 1, 3]
	];
	// solhint-enable

	/// @dev Given an amount, subtract taxes from it.
	function _toTaxed(uint256 amount) internal pure returns (uint256) {
		return amount - (amount * TAX_RATE) / PPM_ONE;
	}

	/// @dev Given an amount, get the taxed quantity.
	function _toTaxes(uint256 amount) internal pure returns (uint256) {
		return (amount * TAX_RATE) / PPM_ONE;
	}

	/// @dev Given a tile coordinate, return the tile id.
	function _toTileId(int32 x, int32 y) internal pure returns (bytes10) {
		return bytes10($$(hex(0x1337 << (8*8)))) |
			bytes10(uint80(((uint64(y) & uint32(-1)) << (8*4)) |
				(uint64(x) & uint32(-1))));
	}

	/// @dev Check if a block ID number is valid.
	function _isValidBlock(uint8 _block) internal pure returns (bool) {
		return _block <= $$(MAX_BLOCK_VALUE);
	}

	/// @dev Check if a tower height is valid.
	function _isValidHeight(uint8 height) internal pure returns (bool) {
		return height <= MAX_HEIGHT;
	}

	/// @dev Insert packed representation of a tower `b` into `a`.
	/// @param a Packed represenation of the current tower.
	/// @param b Packed represenation of blocks to append.
	/// @param idx The index in `a` to insert the new blocks.
	/// @param count The length of `b`.
	function _assignBlocks(bytes16 a, bytes16 b, uint8 idx, uint8 count)
			internal pure returns (bytes16) {

		uint128 mask = ((uint128(1) << (count*8)) - 1) << (idx*8);
		uint128 v = uint128(b) << (idx*8);
		return bytes16((uint128(a) & ~mask) | (v & mask));
	}

	/// @dev Get the current season.
	function _getSeason() private view returns (uint128) {
		return (($(BLOCKTIME) - CALENDAR_START) / SEASON_DURATION) % NUM_SEASONS;
	}

	/// @dev Check if a tile is in season (has a bonus in effect).
	/// @param tile The tile to check.
	/// @return true if tile is in season.
	function _isTileInSeason(Tile storage tile) internal view returns (bool) {
		bytes32 hash = keccak256(abi.encodePacked(address(this), tile.id));
		return uint256(hash) % NUM_SEASONS == _getSeason();
	}

	/// @dev Estimate the sqrt of an integer n, returned in ppm, using small
	/// steps of the Babylonian method.
	/// @param n The integer whose sqrt is to the found, NOT in ppm.
	/// @param hint A number close to the sqrt, in ppm.
	/// @return sqrt(n) in ppm
	function _estIntegerSqrt(uint64 n, uint64 hint)
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

	// The current blocktime.
	uint64 public __blockTime = uint64(block.timestamp);

	// Set the current blocktime.
	function __setBlockTime(uint64 t) public {
		__blockTime = t;
	}

	// Advance the current blocktime.
	function __advanceTime(uint64 dt) public {
		__blockTime += dt;
	}
	// #endif
}
