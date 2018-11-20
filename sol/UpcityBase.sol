pragma solidity ^0.4.24;

import './UpcityMath.sol';

// #def NUM_NEIGHBORS 6
// #def MAX_HEIGHT 16
// #def DECIMALS 18
// #def ONE_DAY 24 * 60 * 60
// #def ONE_TOKEN 10**DECIMALS
// #def NUM_RESOURCES 3
// #def NEIGHBOR_OFFSET(idx) ((int32(idx)%3-1), (1-int32(idx)/2))

/// @title Constants and types for UpCityGame
contract UpcityBase is UpcityMath {
	struct Position {
		int32 x;
		int32 y;
	}

	struct Tile {
		bytes16 id;
		bytes16 blocks;
		address owner;
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

	uint256 constant ONE_TOKEN = $${ONE_TOKEN};

	uint8 constant ONITE_BLOCK = 0;
	uint8 constant TOPITE_BLOCK = 1;
	uint8 constant RUBITE_BLOCK = 2;
	uint8 constant MAX_BLOCK_VALUE = RUBITE_BLOCK;
	uint8 constant NUM_RESOURCES = $${NUM_RESOURCES};
	uint8 constant MAX_HEIGHT = ${MAX_HEIGHT};
	bytes16 constant EMPTY_BLOCKS = $${hex(2**(8*MAX_HEIGHT)-1)};
	// 1/6
	uint64 constant TAX_RATE = $${TO_PPM(1/NUM_NEIGHBORS)};
	// 133.333...%
	uint64 constant PURCHASE_PREMIUM = $${TO_PPM(1+1/3)};
	// 133.333...%
	uint64 constant PURCHASE_MARKUP = $${TO_PPM(1+1/3)};
	uint8 constant NUM_NEIGHBORS = $${NUM_NEIGHBORS};

	// #def BLOCK_HEIGHT_PREMIUM_BASE 2**(1/(MAX_HEIGHT-1))
	// In PPM.
	uint64[MAX_HEIGHT] BLOCK_HEIGHT_PREMIUM = [
		$${join(map(range(MAX_HEIGHT),
			h => AS_UINT64(TO_PPM(BLOCK_HEIGHT_PREMIUM_BASE**h))),
			concat(',\n', __indent))}
	];

	// #def BLOCK_HEIGHT_BONUS_BASE 4**(1/(MAX_HEIGHT-1))
	// In PPM.
	uint64[MAX_HEIGHT] BLOCK_HEIGHT_BONUS = [
		$${join(map(range(MAX_HEIGHT),
			h => AS_UINT64(TO_PPM(BLOCK_HEIGHT_BONUS_BASE**h))),
			concat(',\n', __indent))}
	];

	// #def RESOURCE_ALPHAS [0.05, 0.25, 0.66]
	uint64[NUM_RESOURCES] RESOURCE_ALPHAS = [
		$${join(map(RESOURCE_ALPHAS,
			v => AS_UINT64(TO_PPM(v))),
			concat(',\n', __indent))}
	];

	// #def RECIPES [[3, 1, 1], [1, 3, 1], [1, 1, 3]]
	uint256[NUM_RESOURCES][NUM_RESOURCES] RECIPES = [
		// #for I, IDX in RECIPES
		[
			$${join(map(I,
				t => AS_UINT256(t * ONE_TOKEN)),
				concat(',\n', __indent))}
		]$${IDX + 1 == len(RECIPES) ? '' : ','}
		// #done
	];
}
