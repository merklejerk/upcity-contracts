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
	/// @dev Payments to individual players when someone buys their tile.
	/// Can be pulled vial collectPayment().
	mapping(address=>uint256) public payments;
	/// @dev Fees collected.
	/// These are funds that have been shared to unowned tiles as well as
	/// funds paid to buy unowned tiles.
	/// An authority may call collectFees() to withdraw these fees.
	uint256 public feesCollected = 0;

	event Bought(bytes16 indexed id, address from, address to, uint256 price);
	event TileCollected(bytes16 indexed id, address owner);
	event PaymentCollected(address indexed owner, address to, uint256 amount);
	event Built(bytes16 indexed id, bytes16 blocks);
	event Credited(address indexed to, uint256 amount);
	event FeesCollected(address to, uint256 amount);

	/// @dev Doesn't really do anything.
	/// init() needs to be called by the creator before this contract
	/// can be interacted with.
	constructor() public { /* NOOP */ }

	function init(
			address[NUM_RESOURCES] calldata tokens,
			address market,
			address[] calldata authorities,
			address genesisOwner)
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
		_createNeighbors(tile.x, tile.y);

		isInitialized = true;
	}

	function buyTile(int32 x, int32 y)
			external payable onlyInitialized returns (bool) {

		collect(x, y);
		Tile storage tile = _getExistingTileAt(x, y);
		require(tile.owner != msg.sender, ERROR_ALREADY);
		uint256 price = _getTilePrice(tile);
		require(msg.value >= price, ERROR_INSUFFICIENT);
		address oldOwner = tile.owner;
		tile.owner = msg.sender;
		// Base price increases every time a tile is bought.
		tile.basePrice = (tile.basePrice * PURCHASE_MARKUP) / PPM_ONE;
		// Create the neighboring tiles.
		_createNeighbors(tile.x, tile.y);
		// Share with neighbors.
		_share(tile, price, $$(UINT256_ARRAY(NUM_RESOURCES, 0)));
		// Pay previous owner.
		_creditTo(oldOwner, _toTaxed(price));
		// Refund any overpayment.
		if (msg.value > price)
			_creditTo(msg.sender, msg.value - price);
		emit Bought(tile.id, oldOwner, tile.owner, price);
		return true;
	}

	function buildBlocks(int32 x, int32 y, bytes16 blocks)
			external onlyInitialized returns (bool) {

		collect(x, y);
		Tile storage tile = _getExistingTileAt(x, y);
		require(tile.owner == msg.sender, ERROR_NOT_ALLOWED);
		(uint256[NUM_RESOURCES] memory cost, uint8 count) =
			_getBuildCostAndCount(x, y, blocks);
		require(count > 0, ERROR_INVALID);
		require(_isValidHeight(tile.height + count), ERROR_MAX_HEIGHT);
		_burn(msg.sender, cost);
		tile.blocks = _assignBlocks(tile.blocks, blocks, tile.height, count);
		tile.height += count;
		// Increase clout total for each neighbor.
		for (uint8 i = 0; i < NUM_NEIGHBORS; i++) {
			(int32 ox, int32 oy) = $(NEIGHBOR_OFFSET(i));
			Tile storage neighbor = _getTileAt(tile.x + ox, tile.y + oy);
			neighbor.neighborCloutsTotal += count;
		}
		_incrementBlockStats(blocks);
		emit Built(tile.id, tile.blocks);
		return true;
	}

	function collectFees(address to)
			external onlyInitialized onlyAuthority {

		assert(feesCollected <= address(this).balance);
		if (feesCollected > 0) {
			uint256 amount = feesCollected;
			feesCollected = 0;
			_transferTo(to, amount);
			emit FeesCollected(to, amount);
		}
	}

	function collectPayment(address to) external {
		uint256 amount = payments[msg.sender];
		if (amount > 0) {
			payments[msg.sender] = 0;
			_transferTo(to, amount);
			emit PaymentCollected(msg.sender, to, amount);
		}
	}

	function getPlayerBalance(address player)
			external view returns (
				uint256 funds,
				uint256[NUM_RESOURCES] memory resources) {

		funds = player.balance;
		// #for RES in range(NUM_RESOURCES)
		resources[$$(RES)] = _tokens[$$(RES)].balanceOf(player);
		// #done
	}

	function describeTileAt(int32 _x, int32 _y) external view
			returns (
				bytes16 id,
				int32 x,
				int32 y,
				uint32 timesBought,
				uint64 lastTouchTime,
				address owner,
				bytes16 blocks,
				uint256 price,
				uint256[NUM_RESOURCES] memory resources,
				uint256 funds) {

		Tile storage tile = _getExistingTileAt(_x, _y);
		id = tile.id;
		x = tile.x;
		y = tile.y;
		timesBought = tile.timesBought; owner = tile.owner;
		lastTouchTime = tile.lastTouchTime;
		blocks = tile.blocks;
		price = _getTilePrice(tile);
		resources = _getTileYield(tile);
		// #for RES in range(NUM_RESOURCES)
		resources[$(RES)] =
			resources[$(RES)].add(_toTaxed(tile.sharedResources[$(RES)]));
		// #done
		funds = _toTaxed(tile.sharedFunds);
	}

	function collect(int32 x, int32 y)
			public onlyInitialized returns (bool) {

		Tile storage tile = _getExistingTileAt(x, y);
		// If tile is unowned, it cannot yield anything.
		if (tile.owner == ZERO_ADDRESS)
			return false;

		uint256[NUM_RESOURCES] memory produced = _getTileYield(tile);
		uint256 funds = tile.sharedFunds;

		tile.lastTouchTime = $(BLOCKTIME);
		tile.sharedResources = $$(UINT256_ARRAY(NUM_RESOURCES, 0));
		tile.sharedFunds = 0;

		// Share to neighbors.
		_share(tile, funds, produced);
		// Pay to owner.
		_claim(tile.owner, funds, produced);
		emit TileCollected(tile.id, tile.owner);
		return true;
	}

	function toTileId(int32 x, int32 y) public view returns (bytes16) {
		return bytes16(keccak256(abi.encodePacked(x, y, address(this))));
	}

	function isTileAt(int32 x, int32 y) public view returns (bool) {
		Tile storage tile = _getTileAt(x, y);
		return tile.id != 0x0;
	}

	function getBuildCost(int32 x, int32 y, bytes16 blocks)
			public view returns (uint256[NUM_RESOURCES] memory) {

		(uint256[NUM_RESOURCES] memory cost,) = _getBuildCostAndCount(x, y, blocks);
		return cost;
	}

	function _getBuildCostAndCount(int32 x, int32 y, bytes16 blocks)
			private view returns (uint256[NUM_RESOURCES] memory, uint8) {

		Tile storage tile = _getExistingTileAt(x, y);
		uint256[NUM_RESOURCES] memory cost = $$(UINT256_ARRAY(3, 0));
		// The global block totals.
		uint64[NUM_RESOURCES] memory blockTotals =
			$$(map(range(NUM_RESOURCES), (R) => `_blockStats[${R}].count`));
		uint8 count = 0;
		for (; count < MAX_HEIGHT; count++) {
			uint8 b = $(UNPACK_BLOCK(blocks, count));
			if (!_isValidBlock(b))
				break;
			require(_isValidHeight(tile.height + count + 1), ERROR_MAX_HEIGHT);
			uint256[NUM_RESOURCES] memory bc = _getBlockCost(
				b, blockTotals[b], tile.height + count);
			// #for N in range(NUM_RESOURCES)
			cost[$$(N)] = cost[$$(N)].add(bc[$$(N)]);
			// #done
			blockTotals[b] += 1;
		}
		return (cost, count);
	}

	function _getTileYield(Tile storage tile)
			private view returns (uint256[NUM_RESOURCES] memory) {

		assert(tile.id != 0x0);
		require($(BLOCKTIME) >= tile.lastTouchTime, ERROR_TIME_TRAVEL);
		uint64 dt = $(BLOCKTIME) - tile.lastTouchTime;
		// Geneerate resources on top of what's been shared to this tile.
		uint256[NUM_RESOURCES] memory produced = tile.sharedResources;
		for (uint8 height = 0; height < MAX_HEIGHT; height++) {
			uint8 b = $(UNPACK_BLOCK(tile.blocks, height));
			if (!_isValidBlock(b))
				break;
			uint256 amt = ONE_TOKEN * _blockStats[b].production;
			amt *= dt;
			amt *= BLOCK_HEIGHT_BONUS[height];
			amt /= _blockStats[b].score;
			amt /= ONE_DAY * PPM_ONE**2;
			produced[b] = produced[b].add(amt);
		}
		return produced;
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
		if (tile.id == 0x0) {
			tile.id = id;
			tile.x = x;
			tile.y = y;
			tile.blocks = EMPTY_BLOCKS;
			tile.neighborCloutsTotal = NUM_NEIGHBORS;
		}
		return tile;
	}

	function _createNeighbors(int32 x, int32 y) private {
		for (uint8 i = 0; i < NUM_NEIGHBORS; i++) {
			(int32 ox, int32 oy) = $(NEIGHBOR_OFFSET(i));
			_createTileAt(x + ox, y + oy);
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
		require(tile.id == id, ERROR_NOT_FOUND);
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

	function _share(
			Tile storage tile,
			uint256 funds,
			uint256[NUM_RESOURCES] memory resources)
			private {

		// Compute how much each neighbor is entitled to.
		uint256 sharedFunds = _toTaxes(funds) / NUM_NEIGHBORS;
		uint256[NUM_RESOURCES] memory sharedResources =
			$$(map(range(NUM_RESOURCES),
				(R) => `_toTaxes(resources[${R}]) / NUM_NEIGHBORS`));
		// Share with neighbors.
		for (uint8 i = 0; i < NUM_NEIGHBORS; i++) {
			(int32 ox, int32 oy) = $(NEIGHBOR_OFFSET(i));
			Tile storage neighbor = _getExistingTileAt(tile.x + ox, tile.y + oy);
			// Normalization factor so that taller towers receive more.
			uint64 clout = ($(MAX(neighbor.height, 1)) * PPM_ONE)
				/ tile.neighborCloutsTotal;
			// If the tile is owned, share resources and funds.
			if (neighbor.owner != ZERO_ADDRESS) {
				// #for RES in range(NUM_RESOURCES)
				neighbor.sharedResources[$$(RES)] =
					neighbor.sharedResources[$$(RES)].add(
						(clout * sharedResources[$$(RES)]) / PPM_ONE);
				// #done
				neighbor.sharedFunds = neighbor.sharedFunds.add(sharedFunds);
			} else {
				// If the tile is unowned, keep the funds as fees.
				feesCollected = feesCollected.add(
					(clout * sharedFunds) / PPM_ONE);
			}
		}
	}

	function _claim(
			address whom,
			uint256 funds,
			uint256[NUM_RESOURCES] memory resources)
			private {

		require(whom != ZERO_ADDRESS, ERROR_INVALID);
		// #for RES in range(NUM_RESOURCES)
		_mintTo(whom, $$(RES), _toTaxed(resources[$$(RES)]));
		// #done
		_transferTo(whom, _toTaxed(funds));
	}

	function _transferTo(address to, uint256 amount) private {
		// Use fallback function and forward all remaining gas.
		//solhint-disable-next-line
		(bool success,) = to.call.value(amount)("");
		require(success, ERROR_TRANSFER_FAILED);
	}

	function _getTilePrice(Tile storage tile) private view returns (uint256) {
		uint256[NUM_RESOURCES] memory marketPrices = _getMarketPrices();
		uint256 price = _getIsolatedTilePrice(tile, marketPrices);
		uint256 neighborPrices = 0;
		for (uint8 i = 0; i < NUM_NEIGHBORS; i++) {
			(int32 ox, int32 oy) = $(NEIGHBOR_OFFSET(i));
			Tile storage neighbor = _getTileAt(tile.x + ox, tile.y + oy);
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

	function _creditTo(address recipient, uint256 amount) private {
		if (amount > 0) {
			// Payments to zero address are just fees collected.
			if (recipient == ZERO_ADDRESS) {
				feesCollected = feesCollected.add(amount);
			} else {
				// Just credit the player. She can collect it later through
				// collectPayment().
				payments[recipient] = payments[recipient].add(amount);
			}
			emit Credited(recipient, amount);
		}
	}

	function _mintTo(
			address recipient, uint8 resource, uint256 amount) private {

		if (amount > 0)
			_tokens[resource].mint(recipient, amount);
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

	function _toTaxed(uint256 amount) private pure returns (uint256) {
		return amount - (amount * TAX_RATE) / PPM_ONE;
	}

	function _toTaxes(uint256 amount) private pure returns (uint256) {
		return (amount * TAX_RATE) / PPM_ONE;
	}

	// #if TEST
	function __fundTileAt(
			int32 x,
			int32 y,
			uint256[NUM_RESOURCES] calldata resources) external payable {

		Tile storage tile = _getExistingTileAt(x, y);
		tile.sharedFunds = tile.sharedFunds.add(msg.value);
		// #for RES in range(NUM_RESOURCES)
		tile.sharedResources[$(RES)] =
			tile.sharedResources[$(RES)].add(resources[$(RES)]);
		// #done
	}

	function __fundFees() external payable {
		feesCollected = feesCollected.add(msg.value);
	}

	function __fundPlayer(address to) external payable {
		payments[to] = payments[to].add(msg.value);
	}
	// #endif
}
