pragma solidity ^0.5;

import './UpcityMath.sol';

// #def ONE_DAY 24 * 60 * 60

// #def ONE_TOKEN 10**DECIMALS

// #def NEIGHBOR_OFFSET(idx) ((int32(idx)%3-1), (1-int32(idx)/2))

// #def ARRAY_SEP concat(",\n", __indent)

// #def UNPACK_BLOCK(blocks, idx) uint8(bytes1(blocks >> (8*idx)))

// #def PACK_BLOCK(blocks, idx, block) \
// 	(bytes16(blocks) & (~(bytes16(uint128(0xFF)) << (8*(idx))))) \
// 	| ((bytes16(uint128(block) & 0xFF)) << (8*(idx)))

// #def ASSIGN_BLOCKS(a, b, count, height) \
// bytes16(a) & bytes16(~((uint128(0x1) << (uint8(count)*8)) - 1))
// | (uint128(bytes16(b) >> (uint8(height)*8)));

// #def UINT256_ARRAY(count, value) \
// 	map(filled(count, value), AS_UINT256)

// #def UINT64_ARRAY(count, value) \
// 	map(filled(count, value), AS_UINT64)

// #def UINT8_ARRAY(count, value) \
// 	map(filled(count, value), AS_UINT64)

// #if TEST
// #def BLOCKTIME _blockTime
// #else
// #def BLOCKTIME uint64(block.timestamp)
// #endif

/// @title Constants and types for UpCityGame
contract UpcityBase is UpcityMath {
	struct Position {
		int32 x;
		int32 y;
	}

	struct Tile {
		bytes16 id;
		bytes16 blocks;
		address payable owner;
		uint32 timesBought;
		Position position;
		uint64 lastTouchTime;
		uint256 basePrice;
		Credits credits;
	}

	struct Credits {
		uint256[NUM_RESOURCES] resources;
		uint256 funds;
	}

	struct BlockStats {
		uint64 count;
		uint256 score;
		uint256 production;
	}

	string internal constant ERROR_MAX_HEIGHT = 'MAX_HEIGHT';
	string internal constant ERROR_NOT_ALLOWED = 'NOT_ALLOWED';
	string internal constant ERROR_ALREADY = 'ALREADY';
	string internal constant ERROR_INSUFFICIENT = 'INSUFFICIENT';
	string internal constant ERROR_RESTRICTED = 'RESTRICTED';
	string internal constant ERROR_UNINITIALIZED = 'UNITIALIZED';
	string internal constant ERROR_TIME_TRAVEL = 'TIME_TRAVEL';
	string internal constant ERROR_INVALID = 'INVALID';

	address internal constant ZERO_ADDRESS = address(0x0);
	uint8 internal constant DECIMALS = $$(DECIMALS);
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
	// #def BLOCK_HEIGHT_PREMIUM_BASE 2**(1/(MAX_HEIGHT-1))
	// In PPM.
	uint64[MAX_HEIGHT] BLOCK_HEIGHT_PREMIUM = [
		$$(join(map(range(MAX_HEIGHT),
		h => AS_UINT64(TO_PPM(BLOCK_HEIGHT_PREMIUM_BASE**h))), ARRAY_SEP))
	];
	// #def BLOCK_HEIGHT_BONUS_BASE 4**(1/(MAX_HEIGHT-1))
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

	function isValidBlock(uint8 _block) internal pure returns (bool) {
		return _block <= MAX_BLOCK_VALUE;
	}

	function isValidHeight(uint8 height) internal pure returns (bool) {
		return height <= MAX_HEIGHT;
	}

	// solhint-disable func-order
	// #if TEST
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
