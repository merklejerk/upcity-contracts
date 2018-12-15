pragma solidity ^0.5;

import './base/openzeppelin/math/SafeMath.sol';
import './IResourceToken.sol';
import './IMarket.sol';
import './UpcityMath.sol';
import './Uninitialized.sol';
import './Restricted.sol';
import './Nonpayable.sol';
import './UpcityBase.sol';

/// @title Game contract for upcity.app
contract UpcityGame is
		UpcityBase,
		UpcityMath,
		Uninitialized,
		Nonpayable,
		Restricted {
	using SafeMath for uint256;

	/// @dev Global block stats for each resource.
	BlockStats[NUM_RESOURCES] private _blockStats;
	/// @dev Tokens for each resource.
	IResourceToken[NUM_RESOURCES] private _tokens;
	/// @dev The market for all resources.
	IMarket private _market;
	/// @dev Tiles by ID.
	mapping(bytes16=>Tile) private _tiles;
	/// @dev Ether which has "fallen off the edge".
	/// Increased every time ether propogates to a tile
	/// that has no owner. Can be claimed with claimFunds().
	uint256 public fundsCollected = 0;

	event Bought(bytes16 indexed id, address from, address to, uint256 price);
	event Collected(bytes16 indexed id);
	event Built(bytes16 indexed id, bytes16 blocks);

	/// @dev Doesn't really do anything.
	/// init() needs to be called by the creator before this contract
	/// can be interacted with.
	constructor() public { /* NOOP */ }

	function init(
			address[NUM_RESOURCES] calldata tokens,
			address market,
			address[] calldata authorities,
			address payable genesisOwner)
			external onlyCreator onlyUninitialized {

		require(tokens.length == NUM_RESOURCES, ERROR_INVALID);
		for (uint256 i = 0; i < authorities.length; i++)
			isAuthority[authorities[i]] = true;
		for (uint256 i = 0; i < NUM_RESOURCES; i++)
			_tokens[i] = IResourceToken(tokens[i]);
		_market = IMarket(market);

		// Create the genesis tile and its neighbors.
		Tile storage tile = _createTileAt(0, 0);
		tile.owner = genesisOwner;
		tile.timesBought = 1;
		tile.basePrice = (MINIMUM_TILE_PRICE * PURCHASE_MARKUP) / PPM_ONE;
		_createNeighbors(tile.position.x, tile.position.y);

		isInitialized = true;
	}

	function toTileId(int32 x, int32 y) public view returns (bytes16) {
		return bytes16(keccak256(abi.encodePacked(x, y, address(this))));
	}

	function isTileAt(int32 x, int32 y) public view returns (bool) {
		Tile storage tile = _getTileAt(x, y);
		return tile.id != 0x0;
	}

	function describeTileAt(int32 _x, int32 _y) public view
			returns (
				bytes16 id,
				int32 x,
				int32 y,
				uint32 timesBought,
				uint64 lastTouchTime,
				address owner,
				bytes16 blocks,
				uint256 price) {

		Tile storage tile = _getExistingTileAt(_x, _y);
		id = tile.id;
		x = tile.position.x;
		y = tile.position.y;
		timesBought = tile.timesBought; owner = tile.owner;
		lastTouchTime = tile.lastTouchTime;
		blocks = tile.blocks;
		price = _getTilePrice(tile);
	}

	function buyTile(int32 x, int32 y)
			public payable onlyInitialized returns (bool) {

		collect(x, y);
		Tile storage tile = _getExistingTileAt(x, y);
		require(tile.owner != msg.sender, ERROR_ALREADY);
		uint256 price = _getTilePrice(tile);
		require(msg.value >= price, ERROR_INSUFFICIENT);
		address payable oldOwner = tile.owner;
		tile.owner = msg.sender;
		// Base price increases every time a tile is bought.
		tile.basePrice = (tile.basePrice * PURCHASE_MARKUP) / PPM_ONE;
		// Create the neighboring tiles.
		_createNeighbors(tile.position.x, tile.position.y);
		uint256 taxes = (TAX_RATE * price) / PPM_ONE;
		assert(taxes <= price);
		// Pay previous owner.
		_payTo(oldOwner, price - taxes);
		_sharePurchase(tile, taxes);
		// Refund any overpayment.
		if (msg.value > price)
			_payTo(msg.sender, msg.value - price);
		emit Bought(tile.id, oldOwner, tile.owner, price);
		return true;
	}

	function buildBlocks(int32 x, int32 y, bytes16 blocks)
			public onlyInitialized returns (bool) {

		collect(x, y);
		Tile storage tile = _getExistingTileAt(x, y);
		require(tile.owner == msg.sender, ERROR_NOT_ALLOWED);
		uint8 count = _getHeight(blocks);
		require(count > 0 && count <= MAX_HEIGHT, ERROR_INVALID);
		uint8 height = _getHeight(tile.blocks);
		require(_isValidHeight(height + count), ERROR_MAX_HEIGHT);
		_burn(tile.owner, getBuildCost(x, y, blocks));
		tile.blocks = _assignBlocks(tile.blocks, blocks, height, count);
		_incrementBlockStats(blocks);
		emit Built(tile.id, tile.blocks);
		return true;
	}

	function getBuildCost(int32 x, int32 y, bytes16 blocks)
			public view returns (uint256[NUM_RESOURCES] memory) {

		Tile storage tile = _getExistingTileAt(x, y);
		uint8 height = _getHeight(tile.blocks);
		require(height < MAX_HEIGHT, ERROR_MAX_HEIGHT);
		uint256[NUM_RESOURCES] memory cost = $$(UINT256_ARRAY(3, 0));
		// The global block totals.
		uint64[NUM_RESOURCES] memory blockTotals =
			$$(map(range(NUM_RESOURCES), (R) => `_blockStats[${R}].count`));
		for (uint8 i = 0; i < MAX_HEIGHT; i++) {
			uint8 b = $(UNPACK_BLOCK(blocks, i));
			if (!_isValidBlock(b))
				break;
			require(_isValidHeight(height + i + 1), ERROR_MAX_HEIGHT);
			uint256[NUM_RESOURCES] memory bc = _getBlockCost(
				b, blockTotals[b], height + i);
			// #for N in range(NUM_RESOURCES)
			cost[$$(N)] = cost[$$(N)].add(bc[$$(N)]);
			// #done
			blockTotals[b] += 1;
		}
		return cost;
	}

	function collect(int32 x, int32 y)
			public onlyInitialized returns (bool) {

		Tile storage tile = _getExistingTileAt(x, y);
		require($(BLOCKTIME) >= tile.lastTouchTime, ERROR_TIME_TRAVEL);
		uint256 dt = $(BLOCKTIME) - tile.lastTouchTime;
		tile.lastTouchTime = $(BLOCKTIME);
		uint256[NUM_RESOURCES] memory collected = $$(UINT256_ARRAY(3, 0));
		for (uint8 height = 0; height < MAX_HEIGHT; height++) {
			uint8 b = $(UNPACK_BLOCK(tile.blocks, height));
			if (!_isValidBlock(b))
				break;
			uint256 amt = ONE_TOKEN * _blockStats[b].production;
			amt *= dt;
			amt *= BLOCK_HEIGHT_BONUS[height];
			amt /= _blockStats[b].score;
			amt /= ONE_DAY * PPM_ONE**2;
			collected[b] = collected[b].add(amt);
		}
		// Share with neighbors.
		// #for N in range(NUM_RESOURCES)
		_shareYield(tile, $$(N),
			(collected[$$(N)] * TAX_RATE) / PPM_ONE);
		// #done
		// Credit owner.
		// #for N in range(NUM_RESOURCES)
		_mintTo(tile.owner, $$(N),
			collected[$$(N)] - (collected[$$(N)] * TAX_RATE) / PPM_ONE);
		// #done
		emit Collected(tile.id);
		return true;
	}

	function claimFunds(address payable dst)
			public onlyInitialized onlyAuthority {

		assert(address(this).balance >= fundsCollected);
		if (fundsCollected > 0) {
			uint256 funds = fundsCollected;
			fundsCollected = 0;
			dst.transfer(funds);
		}
	}

	function _getBlockCost(uint8 _block, uint64 globalTotal, uint8 height)
			private view returns (uint256[NUM_RESOURCES] memory) {

		assert(_isValidBlock(_block) && _isValidHeight(height));
		uint256 c = $(MAX(globalTotal, 1));
		uint256 a = RESOURCE_ALPHAS[_block];
		uint256 s = BLOCK_HEIGHT_PREMIUM[height] * $(MAX(c * a, PPM_ONE));
		uint256[NUM_RESOURCES] memory cost = $$(UINT256_ARRAY(3, 0));
		// #for N in range(NUM_RESOURCES)
		cost[$(N)] = (ONE_TOKEN * RECIPES[_block][$(N)] * s) / $$(PPM_ONE**2);
		// #done
		return cost;
	}

	function _createTileAt(int32 x, int32 y) private returns (Tile storage) {
		bytes16 id = toTileId(x, y);
		Tile storage tile = _tiles[id];
		assert(tile.id == 0x0);
		tile.id = id;
		tile.position = Position(x, y);
		tile.blocks = EMPTY_BLOCKS;
		return tile;
	}

	function _createNeighbors(int32 x, int32 y) private {
		for (uint8 i = 0; i < NUM_NEIGHBORS; i++) {
			(int32 ox, int32 oy) = $(NEIGHBOR_OFFSET(i));
			int32 nx = x + ox;
			int32 ny = y + oy;
			if (!isTileAt(nx, ny))
				_createTileAt(nx, ny);
		}
	}

	function _getTileAt(int32 x, int32 y)
			private view returns (Tile storage) {

		return _tiles[toTileId(x, y)];
	}

	function _getExistingTileAt(int32 x, int32 y)
			private view returns (Tile storage) {

		bytes16 id = toTileId(x, y);
		Tile storage tile = _tiles[id];
		require(tile.id == id, ERROR_INVALID);
		return tile;
	}

	function _incrementBlockStats(bytes16 blocks) private {
		for (uint8 h = 0; h < MAX_HEIGHT; h++) {
			uint8 b = $(UNPACK_BLOCK(blocks, h));
			if (!_isValidBlock(b))
				break;
			BlockStats storage bs = _blockStats[b];
			bs.score += BLOCK_HEIGHT_BONUS[h];
			bs.count += 1;
			bs.production = 2 * uint256(UpcityMath.est_integer_sqrt(bs.count,
				uint64(bs.production / 2)));
		}
	}

	function _shareYield(
			Tile storage tile, uint8 resource, uint256 amount)
			private returns (bool) {

		if (amount > 0) {
			uint256 taxes = amount / NUM_NEIGHBORS;
			assert(taxes <= amount);
			_mintTo(tile.owner, resource, amount - taxes);
			for (uint8 i = 0; i < NUM_NEIGHBORS; i++) {
				(int32 ox, int32 oy) = $(NEIGHBOR_OFFSET(i));
				int32 nx = tile.position.x + ox;
				int32 ny = tile.position.y + oy;
				Tile storage neighbor = _getTileAt(nx, ny);
				if (neighbor.id != 0x0)
					_grantToTile(neighbor, resource, taxes);
			}
		}
		return true;
	}

	function _sharePurchase(
			Tile storage tile, uint256 amount)
			private returns (bool) {

			for (uint8 i = 0; i < NUM_NEIGHBORS; i++) {
				(int32 ox, int32 oy) = $(NEIGHBOR_OFFSET(i));
				int32 nx = tile.position.x + ox;
				int32 ny = tile.position.y + oy;
				Tile storage neighbor = _getTileAt(nx, ny);
				_payToTile(neighbor, amount / NUM_NEIGHBORS);
			}
		}

	function _getTilePrice(Tile storage tile)
			private view returns (uint256) {

		uint256[NUM_RESOURCES] memory marketPrices = _getMarketPrices();
		uint256 price = _getIsolatedTilePrice(tile, marketPrices);
		uint256 neighborPrices = 0;
		for (uint8 i = 0; i < NUM_NEIGHBORS; i++) {
			(int32 ox, int32 oy) = $(NEIGHBOR_OFFSET(i));
			int32 nx = tile.position.x + ox;
			int32 ny = tile.position.y + oy;
			Tile storage neighbor = _getTileAt(nx, ny);
			if (neighbor.id != 0x0)
				neighborPrices = neighborPrices.add(
					_getIsolatedTilePrice(neighbor, marketPrices));
		}
		return price.add(neighborPrices) / NUM_NEIGHBORS;
	}

	function _getIsolatedTilePrice(
			Tile storage tile,
			uint256[NUM_RESOURCES] memory marketPrices)
			private view returns (uint256) {

		uint256 price = tile.basePrice;
		for (uint8 h = 0; h < MAX_HEIGHT; h++) {
			uint8 b = $(UNPACK_BLOCK(tile.blocks, h));
			if (!_isValidBlock(b))
				break;
			uint256[NUM_RESOURCES] memory bc =
				_getBlockCost(b, _blockStats[b].count, h);
			// #for RES in range(NUM_RESOURCES)
			price.add(marketPrices[$(RES)].mul(bc[$(RES)]) / ONE_TOKEN);
			// #done
		}
		return price;
	}

	function _grantToTile(Tile storage tile, uint8 resource, uint256 amount)
			private {

		tile.credits.resources[resource] =
			tile.credits.resources[resource].add(amount);
	}

	function _payToTile(Tile storage tile, uint256 amount) private {
		// If the tile is unowned, just keep the ether.
		if (tile.owner == ZERO_ADDRESS)
			fundsCollected = fundsCollected.add(amount);
		else
			tile.credits.funds = tile.credits.funds.add(amount);
	}

	function _payTo(address payable recipient, uint256 amount) private {
		// solhint-disable multiple-sends, no-empty-blocks
		if (amount > 0) {
			if (recipient == ZERO_ADDRESS)
				fundsCollected = fundsCollected.add(amount);
			else if (!recipient.send(amount)) {
				// Ignored.
			}
		}
	}

	function _mintTo(
			address recipient, uint8 resource, uint256 amount) private {

		if (amount > 0) {
			if (recipient != ZERO_ADDRESS)
				_tokens[resource].mint(recipient, amount);
		}
	}

	function _burn(
			address owner,
			uint256[NUM_RESOURCES] memory resources) private {

		assert(owner != ZERO_ADDRESS);
		// #for N in range(NUM_RESOURCES)
		if (resources[$(N)] > 0)
			_tokens[$(N)].burn(owner, resources[$(N)]);
		// #done
	}

	function _getMarketPrices() private view
			returns (uint256[NUM_RESOURCES] memory prices) {

		// #for RES in range(NUM_RESOURCES)
		prices[$(RES)] = _market.getPrice(address(_tokens[$(RES)]));
		// #done
		return prices;
	}
}
