pragma solidity ^0.5;

import './base/openzeppelin/math/SafeMath.sol';
import './IResourceToken.sol';
import './IMarket.sol';
import './Uninitialized.sol';
import './Restricted.sol';
import './Nonpayable.sol';
import './UpcityBase.sol';

/// @title Game contract for upcity.app
contract UpcityGame is
		UpcityBase,
		Uninitialized,
		Nonpayable,
		Restricted {
	using SafeMath for uint256;

	/// @dev Payments to individual players when someone buys their tile.
	/// Can be pulled vial collectPayment().
	mapping(address=>uint256) public payments;
	/// @dev Fees collected.
	/// These are funds that have been shared to unowned tiles as well as
	/// funds paid to buy unowned tiles.
	/// An authority may call collectFees() to withdraw these fees.
	uint256 public fees = 0;
	// Global block stats for each resource.
	BlockStats[NUM_RESOURCES] private _blockStats;
	// Tokens for each resource.
	IResourceToken[NUM_RESOURCES] private _tokens;
	// The market for all resources.
	IMarket private _market;
	// Tiles by ID.
	mapping(bytes16=>Tile) private _tiles;

	event Bought(bytes16 indexed id, address from, address to, uint256 price);
	event Collected(bytes16 indexed id, address owner);
	event PaymentCollected(address indexed owner, address to, uint256 amount);
	event Built(bytes16 indexed id, bytes16 blocks);
	event Credited(address indexed to, uint256 amount);
	event FeesCollected(address to, uint256 amount);

	/// @dev Doesn't really do anything.
	/// init() needs to be called by the creator before this contract
	/// can be interacted with. All transactional functions will revert if
	/// init() has not been called first.
	constructor() public { /* NOOP */ }

	/// @dev Initialize this contract.
	/// All transactional functions will revert if this has not been called
	/// first by the the contract creator. This cannot be called twice.
	/// @param tokens Each resource's UpcityResourceToken addresses.
	/// @param market The UpcityMarket address.
	/// @param authorities Array of addresses allowed to collect fees.
	/// @param authorities Array of addresses allowed to call collectFees().
	/// @param genesisOwner The owner of the genesis tile, at <0,0>.
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
		_init();
	}

	/// @dev Get global stats for every resource type.
	/// @return A tuple of:
	/// array of the total number of blocks for each resource,
	/// array of the daily production limit for each resource.
	function getBlockStats()
			external view returns (
				uint64[NUM_RESOURCES] memory count,
				uint256[NUM_RESOURCES] memory production) {

		// #for RES in range(NUM_RESOURCES)
		count[$$(RES)] = _blockStats[$$(RES)].count;
		production[$$(RES)] =
			(_blockStats[$$(RES)].production * ONE_TOKEN) / PPM_ONE;
		// #done
	}

	/// @dev Gets the resource and ether balance of a player.
	/// Note that this does not include credits (see 'payments' field).
	/// @param player The player's address.
	/// @return A tuple of:
	/// ether balance,
	/// array of balance for each resource.
	function getPlayerBalance(address player)
			external view returns (
				uint256 funds,
				uint256[NUM_RESOURCES] memory resources) {

		funds = player.balance;
		// #for RES in range(NUM_RESOURCES)
		resources[$$(RES)] = _tokens[$$(RES)].balanceOf(player);
		// #done
	}

	/// @dev Get detailed information about a tile.
	/// @param x The x position of the tile.
	/// @param y The y position of the tile.
	/// @return A tuple of details.
	function describeTile(int32 x, int32 y) external view
			returns (
				/// @dev The id of the tile.
				bytes16 id,
				/// @dev The number of times the tile was bought.
				uint32 timesBought,
				/// @dev The number of times the tile was bought (0 of unowned).
				uint64 lastTouchTime,
				/// @dev The current owner of the tile (0x0 if unowned).
				address owner,
				// Right-aligned, packed representation of blocks,
				// where 0x..FF is empty.
				bytes16 blocks,
				/// @dev The current price of the tile.
				uint256 price,
				/// @dev The number of each resource available to collect()
				/// (including tax).
				uint256[NUM_RESOURCES] memory resources,
				/// @dev The amount ether available to collect()
				/// (including tax).
				uint256 funds,
				/// @dev Whether or not this tile is in season.
				/// Tiles in season yield more resources and have higher prices.
				bool inSeason) {

		Tile storage tile = _getExistingTileAt(x, y);
		id = tile.id;
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
		inSeason = _isTileInSeason(tile);
	}

	/// @dev Buy a tile.
	/// Ether equivalent to the price of the tile must be attached to this call.
	/// Any excess ether (overpayment) will be transfered back to the caller.
	/// The caller will be the new owner.
	/// This will first do a collect(), so the previous owner will be paid
	/// any resources/ether held by the tile. The buyer does not inherit
	/// existing funds/resources. Only the tile and its tower.
	/// @param x The x position of the tile.
	/// @param y The y position of the tile.
	function buyTile(int32 x, int32 y)
			external payable onlyInitialized {

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
			_transferTo(msg.sender, msg.value - price);
		emit Bought(tile.id, oldOwner, tile.owner, price);
	}

	/// @dev Build, by appending, blocks on a tile.
	/// This will first do a collect().
	/// Empty blocks, or building beyond MAX_HEIGHT will revert.
	/// @param x The x position of the tile.
	/// @param y The y position of the tile.
	/// @param blocks Right-aligned, packed representation of blocks to append.
	function buildBlocks(int32 x, int32 y, bytes16 blocks)
			external onlyInitialized {

		collect(x, y);
		Tile storage tile = _getExistingTileAt(x, y);
		// Must be owned by caller.
		require(tile.owner == msg.sender, ERROR_NOT_ALLOWED);
		// Get the costs and count of the new blocks.
		(uint256[NUM_RESOURCES] memory cost, uint8 count) =
			_getBuildCostAndCount(x, y, blocks);
		// Empty blocks aren't allowed.
		require(count > 0, ERROR_INVALID);
		// Building beyond the maximum height is not allowed.
		require(_isValidHeight(tile.height + count), ERROR_MAX_HEIGHT);
		// Burn the costs.
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
	}

	/// @dev Transfer fees (ether) collected to an address.
	/// May only be called by an authority set in init().
	/// @param to Recipient.
	function collectFees(address to)
			external onlyInitialized onlyAuthority {

		assert(fees <= address(this).balance);
		if (fees > 0) {
			uint256 amount = fees;
			fees = 0;
			_transferTo(to, amount);
			emit FeesCollected(to, amount);
		}
	}

	/// @dev Collect funds (ether) credited to the caller.
	/// Credits come from someone buying an owned tile, or when someone
	/// other than the owner of a tile calls collect().
	/// @param to Recipient.
	function collectPayment(address to) external {
		uint256 amount = payments[msg.sender];
		if (amount > 0) {
			payments[msg.sender] = 0;
			_transferTo(to, amount);
			emit PaymentCollected(msg.sender, to, amount);
		}
	}

	function collect(int32 x, int32 y)
			public onlyInitialized {

		Tile storage tile = _getExistingTileAt(x, y);
		// If tile is unowned, it cannot yield or hold anything.
		if (tile.owner == ZERO_ADDRESS)
			return;

		uint256[NUM_RESOURCES] memory produced = _getTileYield(tile);
		uint256 funds = tile.sharedFunds;

		tile.lastTouchTime = $(BLOCKTIME);
		tile.sharedResources = $$(UINT256_ARRAY(NUM_RESOURCES, 0));
		tile.sharedFunds = 0;

		// Share to neighbors.
		_share(tile, funds, produced);
		// Pay/credit owner.
		_claim(tile.owner, funds, produced);
		emit Collected(tile.id, tile.owner);
	}

	function toTileId(int32 x, int32 y) public view returns (bytes16) {
		return _toTileId(x, y);
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
		uint64 seasonBonus = _isTileInSeason(tile) ? SEASON_YIELD_BONUS : PPM_ONE;
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
			amt *= seasonBonus;
			amt /= (_blockStats[b].score) * $$(ONE_DAY * PPM_ONE**3);
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
		bytes16 id = _toTileId(x, y);
		Tile storage tile = _tiles[id];
		if (tile.id == 0x0) {
			tile.id = id;
			tile.x = x;
			tile.y = y;
			tile.blocks = EMPTY_BLOCKS;
			tile.neighborCloutsTotal = NUM_NEIGHBORS;
			tile.basePrice = MINIMUM_TILE_PRICE;
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

		return _tiles[_toTileId(x, y)];
	}

	function _getExistingTileAt(int32 x, int32 y)
			private view returns (Tile storage) {

		bytes16 id = _toTileId(x, y);
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
			bs.production = 2 * uint256(_estIntegerSqrt(bs.count,
				uint64(bs.production / 2)));
		}
	}

	function _share(
			Tile storage tile,
			uint256 funds,
			uint256[NUM_RESOURCES] memory resources)
			private {

		// Compute how much each neighbor is entitled to.
		uint256 sharedFunds = _toTaxes(funds);
		uint256[NUM_RESOURCES] memory sharedResources =
			$$(map(range(NUM_RESOURCES), (R) => `_toTaxes(resources[${R}])`));
		// Share with neighbors.
		for (uint8 i = 0; i < NUM_NEIGHBORS; i++) {
			(int32 ox, int32 oy) = $(NEIGHBOR_OFFSET(i));
			Tile storage neighbor = _getExistingTileAt(tile.x + ox, tile.y + oy);
			// Normalization factor so that taller towers receive more.
			uint64 clout = ((neighbor.height + 1) * PPM_ONE)
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
				fees = fees.add(
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
		// If caller is not recipient, only credit funds.
		if (whom != msg.sender)
			_creditTo(whom, _toTaxed(funds));
		else // Otherwise try to transfer the funds synchronously.
			_transferTo(whom, _toTaxed(funds));
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
		price = price.add(neighborPrices) / NUM_NEIGHBORS;
		// If the tile is in season, it has a price bonus.
		if (_isTileInSeason(tile))
			price = price.mul(SEASON_PRICE_BONUS) / PPM_ONE;
		return price;
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
			price = price.add(marketPrices[$(RES)].mul(bc[$(RES)]) / ONE_TOKEN);
			// #done
		}
		return price;
	}

	function _transferTo(address to, uint256 amount) private {
		// Use fallback function and forward all remaining gas.
		if (amount > 0) {
			//solhint-disable-next-line
			(bool success,) = to.call.value(amount)("");
			require(success, ERROR_TRANSFER_FAILED);
		}
	}

	function _creditTo(address recipient, uint256 amount) private {
		if (amount > 0) {
			// Payments to zero address are just fees collected.
			if (recipient == ZERO_ADDRESS) {
				fees = fees.add(amount);
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
	}

	// #if TEST
	// solhint-disable

	/// @dev Test function to add shared funds and resources to a tile.
	/// Any ether paid to this function will be added to the shared funds
	/// of the tile.
	/// @param x X coordinate of tile.
	/// @param y Y coordinate of tile.
	/// @param y Y Resources to add.
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

	/// @dev Test function to drain all funds and resources from a tile.
	/// @param x X coordinate of tile.
	/// @param y Y coordinate of tile.
	function __drainTileAt(int32 x, int32 y) external {
		Tile storage tile = _getExistingTileAt(x, y);
		tile.lastTouchTime = $(BLOCKTIME);
		tile.sharedFunds = 0;
		// #for RES in range(NUM_RESOURCES)
		tile.sharedResources[$(RES)] = 0;
		// #done
	}

	/// @dev Test function to add fees collected to the contract.
	function __fundFees() external payable {
		fees = fees.add(msg.value);
	}

	function __fundPlayer(address to) external payable {
		payments[to] = payments[to].add(msg.value);
	}

	// solhint-enable
	// #endif
}
