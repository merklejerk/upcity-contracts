pragma solidity ^0.4.24;

import {IResourceToken} from './IResourceToken.sol';
import {IMarket} from './IMarket.sol';
import {UpcityMath} from './UpcityMath.sol';
import {UpCityBase} from './UpCityBase.sol';

/// @title Game contract for upcity.app
contract UpCityGame is UpCityBase {
	/// @dev Tokens for each resource.
	ResourceToken[NUM_RESOURCES] private _tokens;
	/// @dev The market for all resources.
	Market private _market;
	/// @dev Tiles by ID.
	mapping(bytes16=>Tile) private _tiles;

	constructor(address[] tokens, address market, address genesisOwner) public {
		assert(tokens.length == NUM_RESOURCES);
		for (uint8 i = 0; i < NUM_RESOURCES; i++)
			_tokens[i] = ResourceToken(tokens[i]);
		_market = Market(market);
		Tile storage tile = _createTileAt(0, 0);
		tile.owner = genesisOwner;
		tile.timesBought = 1;
		_createNeighbors(tile.x, tile.y);
	}

	function _createTileAt(int32 x, int32 y) private returns (Tile storage) {
		bytes16 id = bytes16(abi.encodePacked(x, y, block.number));
		Tile storage tile = _tiles[id];
		require(tile.id == 0x0);
		tile.id = id;
		tile.position = Position(x, y);
		return tile;
	}

	function _createNeighbors(int32 x, int32 y) private returns (Tile storage) {
		for (uint8 i = 0; i < NUM_NEIGHBORS; i++) {
			Position memory o = NEIGHBOR_OFFSETS[i];
			int32 nx = x + o.x;
			int32 ny = y + o.y;
			if (!isTileAt(nx, ny))
				_createTileAt(nx, ny);
		}
	}

	function toTileId(int32 x, int32 y) public view returns (bytes16) {
		return bytes16(abi.encodePacked(x, y, address(this)));
	}

	function _getTileAt(int32 x, int32 y) private view returns (Tile storage) {
		return _tiles[toTileId(x, y)];
	}

	function _getExistingTileAt(int32 x, int32 y) private view returns (Tile storage) {
		bytes16 id = toTileId(x, y);
		Tile storage tile = _tiles[id];
		require(tile.id == id);
		return tile;
	}

	function isTileAt(int32 x, int32 y) public view returns (bool) {
		Tile storage tile = _getTileAt(x, y);
		return tile.id != 0x0;
	}

	function describeTileAt(int32 x, int32 y) public view
			returns (
				bytes16 id,
				int32 x,
				int32 y,
				uint32 timesBought,
				address owner,
				bytes16 blocks,
				uint256 price) {

		Tile storage tile = _getExistingTileAt(x, y);
		id = tile.id;
		x = tile.x;
		y = tile.y;
		timesBought = tile.timesBought; owner = tile.owner;
		blocks = tile.blocks;
		price = _getTilePrice(tile);
	}

	function buyTile(int32 x, int32 y) public payable returns (bool) {
		Tile storage tile = _getExistingTileAt(x, y);
		require(tile.owner != msg.sender);
		uint256 price = _getTilePrice(tile);
		require(msg.value >= price);
		address oldOwner = tile.owner;
		tile.owner = msg.sender;
		// Base price increases every time a tile is bought.
		tile.basePrice = (tile.basePrice * PURCHASE_MARKUP) / PPM_ONE;
		// Refund any overpayment.
		if (msg.value > price)
			_payTo(msg.sender, msg.value - price);
		uint256 taxes = TAX_RATE * price;
		assert(taxes <= price);
		// Pay previous owner.
		_payTo(oldOwner, price - taxes);
		// Pay neighborhood tax.
		for (uint8 i = 0; i < NUM_NEIGHBORS; i++) {
			Position memory o = NEIGHBOR_OFFSETS[i];
			int32 nx = x + o.x;
			int32 ny = y + o.y;
			Tile storage neighbor = _getTileAt(nx, ny);
			if (neighbor.id != 0x0)
				_payToTile(neighbor, taxes / NUM_NEIGHBORS);
		}
		return true;
	}

	function buildBlocks(int32 x, int32 y, bytes16 blocks)
			public returns (bool) {

		collect(x, y);
		Tile storage tile = _getExistingTileAt(x, y);
		require(tile.owner == msg.sender);
		uint8 height = _getHeight(tile.blocks);
		require(height < MAX_HEIGHT);
		uint256[NUM_RESOURCES] memory cost = [0, 0, 0];
		for (uint8 i = 0; i < MAX_HEIGHT - height; i++) {
			uint8 block = (block >> (8*i)) & 0xFF;
			if (block == 0xFF)
				break;
			require(block <= MAX_BLOCK_VALUE);
			uint256[NUM_RESOURCES] memory _cost = getBlockCost(block, height + i);
			for (uint8 j = 0; j < NUM_RESOURCES; j++)
				cost[j] = _cost[j].add(cost[j]);
			tile.blocks = _setBlockAtIndex(tile.blocks, height + i, block);
			_incrementBlockStats(block, height + i)
		}
		for (uint8 res = 0; res < NUM_RESOURCES; res++)
			_burn(tile.owner, res, cost[j]);
		return true;
	}

	function _incrementBlockStats(block, height) private {
		assert(block <= MAX_BLOCK_VALUE && height < MAX_HEIGHT);
		BlockStats storage bs = blockStats[block];
		bs.score += HEIGHT_BONUS[height + i];
		bs.count += 1;
		uint32 r = bs.count > 1 ? (bs.count * PPM_ONE)/(bs.count-1) : PPM_ONE;
		r = (r * [block].production) / 2;
		bs.production = 2 * UpcityMath.est_integer_sqrt(bs.count, r);
	}

	function getBlockCost(uint8 block, uint8 height)
			public returns (uint256[NUM_RESOURCES] memory cost) {

		assert(block <= MAX_BLOCK_VALUE && height < MAX_HEIGHT);
		uint32 total = blockStats[block].count > 0 ? blockStats[block].count : 1;
		uint32 s = blockCostCurves[block].slope;
		uint32 b = blockCostCurves[block].intercept;
		uint32 scaling = BLOCK_HEIGHT_PREMIUM[height] * (total * s + b);
		for (uint8 i = 0; i < NUM_RESOURCES; i++)
			cost[i] = (RECIPES[block][i] * scaling) / PPM_ONE;
	}

	function collect(int32 x, int32 y) public returns (bool) {
		Tile storage tile = _getExistingTileAt(x, y);
		require(tile.owner == msg.sender);
		assert(_getBlockTime() > tile.lastTouchTime);
		uint256 dt = _getBlockTime() - tile.lastTouchTime;
		tile.lastTouchTime = _getBlockTime();
		uint256[NUM_RESOURCES] memory amounts = [0, 0, 0];
		for (uint8 height = 0; height < MAX_HEIGHT; height++) {
			uint8 block = (tile.blocks >> (8*height)) & 0xFF;
			if (block == 0)
				break;
			block -= 1;
			uint256 amt = 10**DECIMALS * blockStats[block].production;
			amt *= dt;
			amt *= HEIGHT_BONUS[height];
			amt /= blockStats[block].score;
			amt /= (1 days);
			amt /= PPM_ONE;
			amt /= PPM_ONE;
			amounts[block] = amounts[block].add(amt);
		}
		for (uint8 res = 0; res < NUM_RESOURCES; res++)
			_produce(tile, res, amounts[res]);
		return true;
	}

	function _produce(Tile storage tile, uint8 resource, uint256 amount)
			private returns (bool) {

		if (amount > 0) {
			uint256 taxes = (TAX_RATE * amount) / PPM_ONE;
			assert(taxes <= amount);
			_mintTo(tile.owner, resource, amount - taxes);
			for (uint8 i = 0; i < NUM_NEIGHBORS; i++) {
				Position memory o = NEIGHBOR_OFFSETS[i];
				int32 nx = x + o.x;
				int32 ny = y + o.y;
				Tile storage neighbor = _getTileAt(nx, ny);
				if (neighbor.id != 0x0)
					_mintToTile(neighbor, resource, taxes / NUM_NEIGHBORS);
			}
		}
		return true;
	}


	// #ifdef TEST
	uint64 _blockTime = block.timestamp;

	function _getBlockTime() public view returns (uint64) {
		return _blockTime;
	}

	function _setBlockTime(uint64 t) public {
		_blockTime = t;
	}
	// #else
	function _getBlockTime() internal view returns (uint64) {
		return uint64(block.timestamp);
	}

	// #endif
}
