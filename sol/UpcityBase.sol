pragma solidity ^0.4.24;

/// @title Constants and types for UpCityGame
contract UpCityBase {

	struct Position {
		int32 x, y;
	}

	struct Tile {
		bytes16 id;
		bytes16 blocks;
		address owner;
		uint32 timesBought;
		Position position;
		uint64 lastTouchTime;
		uint256 basePrice;
		Inbox inbox;
	}

	struct Inbox {
		uint256[NUM_RESOURCES] resources;
		uint256 eth;
	}

	struct BlockStats {
		uint64 count;
		uint256 score;
		uint256 production;
	}

	uint32 constant PPM_ONE = 10**6;
	uint8 constant ONITE_BLOCK = 0;
	uint8 constant TOPITE_BLOCK = 1;
	uint8 constant RUBITE_BLOCK = 2;
	uint8 constant MAX_BLOCK_VALUE = RUBITE_BLOCK;
	uint8 constant NUM_RESOURCES = 3;
	uint8 constant MAX_HEIGHT = 16;
	uint32 constant TAX_RATE = 166666;
	uint32 constant PURCHASE_PREMIUM = 1333333;
	uint8 constant NUM_NEIGHBORS = 6;
	Position[NUM_NEIGHBORS] constant NEIGHBOR_OFFSETS = [
		Position(1,0),
		Position(1,-1),
		Position(0,-1),
		Position(-1,0),
		Position(-1,1),
		Position(0,1)
	];
	uint32[16] constant BLOCK_HEIGHT_PREMIUM = [
		1000000,
		1047294,
		1096824,
		1148698,
		1203025,
		1259921,
		1319507,
		1381912,
		1447269,
		1515716,
		1587401,
		1662475,
		1741101,
		1823444,
		1909683,
		2000000
	];
	uint32[16] constant BLOCK_HEIGHT_BONUS = [
		1000000,
		1096824,
		1203025,
		1319507,
		1447269,
		1587401,
		1741101,
		1909683,
		2094588,
		2297396,
		2519842,
		2763825,
		3031433,
		3324951,
		3646889,
		4000000
	];
}
