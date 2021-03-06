pragma solidity ^0.5;

import './base/openzeppelin/math/SafeMath.sol';
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
	/// Can be pulled vial collectCredits().
	mapping(address=>uint256) public credits;
	/// @dev Fees collected.
	/// These are funds that have been shared to unowned tiles as well as
	/// funds paid to buy unowned tiles.
	/// An authority may call collectFees() to withdraw these fees.
	uint256 public fees = 0;
	/// @dev List of all tile IDs that are owned.
	/// This gets appended to every time someone does a buy() on an empty
	/// tile.
	bytes10[] public tilesBought;
	// Global block stats for each resource.
	BlockStats[NUM_RESOURCES] private _blockStats;
	// The market for all resources.
	IMarket private _market;
	// Tiles by ID.
	mapping(bytes10=>Tile) private _tiles;

	/// @dev Raised whenever a tile is bought.
	event Bought(bytes10 indexed id, address indexed from, address indexed to, uint256 price);
	/// @dev Raised whenever a tile's resources/funds are collected.
	event Collected(bytes10 indexed id, address indexed owner);
	/// @dev Raised whenever credited funds (ether) are collected.
	event CreditsCollected(address indexed from, address indexed to, uint256 amount);
	/// @dev Raised whenever a block is built on a tile.
	event Built(bytes10 indexed id, address indexed owner, bytes16 blocks);
	/// @dev Raised whenever a tile is renamed.
	event Renamed(bytes10 indexed id, bytes16 name);
	/// @dev Raised whenever a player is credited some funds to be collected via
	/// collectCredits().
	event Credited(address indexed to, uint256 amount);
	/// @dev Raised whenever amn authority claims fees through collectFees().
	event FeesCollected(address indexed to, uint256 amount);

	/// @dev Doesn't really do anything.
	/// init() needs to be called by the creator before this contract
	/// can be interacted with. All transactional functions will revert if
	/// init() has not been called first.
	constructor() public { /* NOOP */ }

	/// @dev Initialize this contract.
	/// All transactional functions will revert if this has not been called
	/// first by the the contract creator. This cannot be called twice.
	/// @param market The UpcityMarket address.
	/// @param authorities Array of addresses allowed to call collectFees().
	/// @param genesisPlayer The owner of the genesis tile, at <0,0>.
	function init(
			address market,
			address genesisPlayer,
			address[] calldata authorities)
			external onlyCreator onlyUninitialized {

		for (uint256 i = 0; i < authorities.length; i++)
			isAuthority[authorities[i]] = true;
		_market = IMarket(market);

		// Create the genesis tile and its neighbors.
		Tile storage tile = _createTileAt(0, 0);
		tile.owner = genesisPlayer;
		tile.timesBought = 1;
		tilesBought.push(tile.id);
		_createNeighbors(tile.x, tile.y);
		_init();
	}

	/// @dev Get global stats for every resource type.
	/// @return A tuple of:
	/// array of the total number of blocks for each resource,
	/// array of the total scores for each resource, in ppm.
	/// array of the daily production limit for each resource, in tokens, in ppm.
	function getBlockStats()
			external view returns (
				uint64[NUM_RESOURCES] memory counts,
				uint64[NUM_RESOURCES] memory productions,
				uint128[NUM_RESOURCES] memory scores) {

		// #for RES in range(NUM_RESOURCES)
		counts[$$(RES)] = _blockStats[$$(RES)].count;
		scores[$$(RES)] = _blockStats[$$(RES)].score;
		productions[$$(RES)] = _blockStats[$$(RES)].production;
		// #done
	}

	/// @dev Get a slice of the tilesBought array.
	/// @param start The start index.
	/// @param count The maximum number of elements to return.
	/// @return A slice of the tilesBought array. If the length of the
	/// returned array is less than `count`, you've hit the end.
	function getTilesBoughtSlice(uint32 start, uint32 count)
			external view returns (bytes10[] memory) {

		if (tilesBought.length == 0)
			return new bytes10[](0);
		uint32 _start = $(MIN(start, uint32(tilesBought.length) - 1));
		uint32 _count = $(MIN(count, uint32(tilesBought.length) - _start));
		bytes10[] memory slice = new bytes10[](_count);
		for (uint32 i = 0; i < _count; i++)
			slice[i] = tilesBought[_start + i];
		return slice;
	}

	/// @dev Get detailed information about a tile.
	/// @param x The x position of the tile.
	/// @param y The y position of the tile.
	/// @return A tuple of details.
	function describeTile(int32 x, int32 y) external view
			returns (
				/// @dev The id of the tile. This will be 0x0 if the tile does not
				/// exist.
				bytes10 id,
				/// @dev The name of the tile. Zero-terminated UTF-8 string.
				bytes16 name,
				/// @dev The number of times the tile was bought.
				uint32 timesBought,
				/// @dev The current owner of the tile (0x0 if unowned).
				address owner,
				// Right-aligned, packed representation of blocks,
				// where 0x..FF is empty.
				bytes16 blocks,
				/// @dev The current price of the tile.
				uint256 price,
				/// @dev The number of shared resource available to collect()
				/// (untaxed).
				uint256[NUM_RESOURCES] memory sharedResources,
				/// @dev The amount ether available to collect()
				/// (including tax).
				uint256 funds,
				/// @dev The aggregated yield scores for each resource for this
				/// tile.
				uint64[NUM_RESOURCES] memory scores,
				/// @dev Whether or not this tile is in season.
				/// Tiles in season yield more resources and have higher prices.
				bool inSeason,
				/// @dev The last time the tile was touched (collected),
				// in unix time.
				uint64 lastTouchTime) {

		Tile storage tile = _getTileAt(x, y);
		id = tile.id;
		timesBought = tile.timesBought;
		name = tile.name;
		owner = tile.owner;
		blocks = tile.blocks;
		if (id != 0x0) {
			price = _getTilePrice(tile);
			sharedResources = tile.sharedResources;
			funds = _toTaxed(tile.sharedFunds);
			scores = tile.scores;
			inSeason = _isTileInSeason(tile);
			lastTouchTime = tile.lastTouchTime;
		}
		else {
			// Tile does not exist.
			assert(owner == address(0x0));
			name = 0x0;
			price = 0;
			sharedResources = $$(FILLED_ARRAY(uint256, NUM_RESOURCES, 0));
			funds = 0;
			scores = $$(FILLED_ARRAY(uint64, NUM_RESOURCES, 0));
			inSeason = false;
			lastTouchTime = 0;
		}
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
	function buy(int32 x, int32 y) external payable onlyInitialized {
		collect(x, y);
		Tile storage tile = _getExistingTileAt(x, y);
		require(tile.owner != msg.sender, ERROR_ALREADY);
		uint256 price = _getTilePrice(tile);
		require(msg.value >= price, ERROR_INSUFFICIENT);
		address oldOwner = tile.owner;
		tile.owner = msg.sender;
		tile.timesBought += 1;
		// Price multiplier increases every time a tile is bought.
		tile.priceMultiplier = (tile.priceMultiplier * PURCHASE_MARKUP) / PPM_ONE;
		// Create the neighboring tiles.
		_createNeighbors(tile.x, tile.y);
		// Share with neighbors.
		_share(tile, price, $$(FILLED_ARRAY(uint256, NUM_RESOURCES, 0)));
		// If this tile was previously unowned, append it to the tilesBought
		// list.
		if (oldOwner == ZERO_ADDRESS)
			tilesBought.push(tile.id);
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
		require(tile.owner == msg.sender, ERROR_RESTRICTED);
		// Get the costs and count of the new blocks.
		(uint256[NUM_RESOURCES] memory costs, uint8 count) =
			_getBuildCostAndCount(tile, blocks);
		// Empty blocks aren't allowed.
		require(count > 0, ERROR_INVALID);
		// Building beyond the maximum height is not allowed.
		require(_isValidHeight(tile.height + count), ERROR_MAX_HEIGHT);
		_increaseTileScores(tile, blocks, count);
		_increaseTileBuildCosts(tile, costs);
		_increaseNeighborCloutTotals(tile, count);
		_increaseBlockStats(blocks, count);
		tile.blocks = _assignBlocks(tile.blocks, blocks, tile.height, count);
		tile.height += count;
		// Stash the costs.
		_market.stash(msg.sender, costs);
		emit Built(tile.id, tile.owner, tile.blocks);
	}

	/// @dev Rename a tile.
	/// Only the owner of the tile may call this.
	/// @param x The x position of the tile.
	/// @param y The y position of the tile.
	/// @param name Name to give the tile (UTF-8, zero-terminated).
	function rename(int32 x, int32 y, bytes16 name) external onlyInitialized {
		Tile storage tile = _getExistingTileAt(x, y);
		// Must be owned by caller.
		require(tile.owner == msg.sender, ERROR_RESTRICTED);
		tile.name = name;
		emit Renamed(tile.id, name);
	}

	/// @dev Transfer fees (ether) collected to an address.
	/// May only be called by an authority set in init().
	/// @param to Recipient.
	function collectFees(address to) external onlyInitialized onlyAuthority {
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
	/// other than the owner of a tile (holding ether) calls collect().
	/// @param to Recipient.
	function collectCredits(address to) external {
		uint256 amount = credits[msg.sender];
		if (amount > 0) {
			credits[msg.sender] = 0;
			_transferTo(to, amount);
			emit CreditsCollected(msg.sender, to, amount);
		}
	}

	/// @dev Collect the resources from a tile.
	/// The caller need not be the owner of the tile.
	/// Calling this on unowned tiles is a no-op since unowned tiles cannot hold
	/// resources/funds.
	/// If the tile is holding resources, they will be immediately minted to
	/// the owner of the tile, with a portion (1/TAX_RATE) shared to its neighbors.
	/// If the tile has funds (ether), they will be credited to the tile owner
	/// (who can later redeem them via collectCredits()), and a portion
	/// (1/TAX_RATE) will be shared to its neighbors.
	/// If the caller is the owner, funds/ether will be directly transfered to the
	/// owner, rather than merely credited (push rather than pull).
	/// The exact proportion of resources and funds each neighbor receives will
	/// depend on its tower height relative to the tile's other immediate
	/// neighbors.
	/// @param x The x position of the tile.
	/// @param y The y position of the tile.
	function collect(int32 x, int32 y) public onlyInitialized {
		Tile storage tile = _getExistingTileAt(x, y);
		// If tile is unowned, it cannot yield or hold anything.
		if (tile.owner == ZERO_ADDRESS)
			return;

		uint256[NUM_RESOURCES] memory produced = _getTileYield(tile, $(BLOCKTIME));
		uint256 funds = tile.sharedFunds;

		tile.lastTouchTime = $(BLOCKTIME);
		tile.sharedResources = $$(FILLED_ARRAY(uint256, NUM_RESOURCES, 0));
		tile.sharedFunds = 0;

		// Share to neighbors.
		_share(tile, funds, produced);
		_claim(tile, funds, produced);
		emit Collected(tile.id, tile.owner);
	}

	/// @dev Get the build cost (in resources) to build a sequence of blocks on
	/// a tile.
	/// This will revert if the number of blocks would exceed the height limit
	/// or the tile does not exist.
	/// @param x The x position of the tile.
	/// @param y The y position of the tile.
	/// @param blocks Right-aligned, packed representation of blocks to append.
	function getBuildCost(int32 x, int32 y, bytes16 blocks)
			public view returns (uint256[NUM_RESOURCES] memory cost) {

		Tile storage tile = _getExistingTileAt(x, y);
		(cost,) = _getBuildCostAndCount(tile, blocks);
	}

	/// @dev Get the build cost (in resources) to build a sequence of blocks on
	/// a tile and the count of those blocks.
	/// @param tile The tile info structure.
	/// @param blocks Right-aligned, packed representation of blocks to append.
	/// @return A tuple of:
	/// The cost per-resource,
	/// The count of the blocks passed.
	function _getBuildCostAndCount(Tile storage tile, bytes16 blocks)
			private view returns (uint256[NUM_RESOURCES] memory, uint8) {

		assert(tile.id != 0x0);
		uint256[NUM_RESOURCES] memory cost = $$(FILLED_ARRAY(uint256, 3, 0));
		// The global block totals. We will increment this for each block to get
		// the accurate/integrated cost.
		uint64[NUM_RESOURCES] memory blockTotals =
			$$(map(range(NUM_RESOURCES), (R) => `_blockStats[${R}].count`));
		uint8 count = 0;
		uint8 baseHeight = tile.height;
		for (; count < MAX_HEIGHT; count++) {
			uint8 b = uint8(uint128(blocks));
			blocks = blocks >> 8;
			if (!_isValidBlock(b))
				break;
			require(_isValidHeight(baseHeight + count + 1), ERROR_MAX_HEIGHT);
			uint256[NUM_RESOURCES] memory bc = _getBlockCost(
				b, blockTotals[b], baseHeight + count);
			// #for N in range(NUM_RESOURCES)
			cost[$$(N)] = cost[$$(N)].add(bc[$$(N)]);
			// #done
			blockTotals[b] += 1;
		}
		return (cost, count);
	}

	/// @dev Update a tile's resource scores given new blocks to append.
	/// @param tile The tile.
	/// @param blocks the new blocks built
	/// @param count The number of new blocks built
	function _increaseTileScores(Tile storage tile, bytes16 blocks, uint8 count)
			private {

		for (uint8 h = 0; h < count; h++) {
			// Pop each block off the tower.
			uint8 b = uint8(uint128(blocks));
			blocks = blocks >> 8;
			tile.scores[b] += BLOCK_HEIGHT_BONUS[tile.height + h];
		}
	}

	/// @dev Update a tile's block costs
	/// @param tile The tile.
	/// @param costs the resource cost of building the new blocks
	function _increaseTileBuildCosts(
			Tile storage tile, uint256[NUM_RESOURCES] memory costs)
			private {

		// #for RES in range(NUM_RESOURCES)
		tile.buildCosts[$$(RES)] += costs[$$(RES)];
		// #done
	}

	/// @dev Update the clout totals for each neighbor of a given tile.
	/// @param center The center tile.
	/// @param amount The extra clout (height) the center tile gained .
	function _increaseNeighborCloutTotals(Tile storage center, uint8 amount)
			private {

		for (uint8 i = 0; i < NUM_NEIGHBORS; i++) {
			(int32 ox, int32 oy) = $(NEIGHBOR_OFFSET(i));
			Tile storage neighbor = _getTileAt(center.x + ox, center.y + oy);
			neighbor.neighborCloutsTotal += amount;
		}
	}

	/// @dev Get the amount resources held by a tile at a time (in the future).
	/// This will include shared resources from neighboring tiles.
	/// The resources held by a tile is an aggregate of the production rate
	/// of the blocks on it (multiplied by a seasonal bonus if the tile is in
	/// season) plus resources shared from neighboring tiles.
	/// @param tile The tile info structure.
	/// @param when The time when to evaluate the yield.
	/// @return The amount of each resource produced.
	function _getTileYield(Tile storage tile, uint64 when)
			private view returns (uint256[NUM_RESOURCES] memory produced) {

		require(when >= tile.lastTouchTime, ERROR_TIME_TRAVEL);
		uint64 seasonBonus = _isTileInSeason(tile) ? SEASON_YIELD_BONUS : PPM_ONE;
		uint64 dt = when - tile.lastTouchTime;
		// Geneerate resources on top of what's been shared to this tile.
		produced = tile.sharedResources;
		for (uint8 b = 0; b < NUM_RESOURCES; b++) {
			uint256 amt = ONE_TOKEN * _blockStats[b].production;
			amt *= dt;
			amt *= tile.scores[b];
			amt *= seasonBonus;
			amt /= $(MAX(_blockStats[b].score, PPM_ONE)) * $$(ONE_DAY * PPM_ONE**2);
			produced[b] += amt;
		}
	}

	/// @dev Get the resource costs to build a block at a height.
	/// @param _block The block ID number.
	/// @param globalTotal The total number of the same block type in existence.
	/// @param height The height of the block in the tower.
	/// @return The amount of each resource it would take to build this block.
	function _getBlockCost(uint8 _block, uint64 globalTotal, uint8 height)
			private view returns (uint256[NUM_RESOURCES] memory) {

		uint256 c = $(MAX(globalTotal, 1));
		uint256 a = RESOURCE_ALPHAS[_block];
		uint256 s = BLOCK_HEIGHT_PREMIUM[height] * $(MAX(c * a, PPM_ONE));
		uint256[NUM_RESOURCES] memory cost = $$(FILLED_ARRAY(uint256, 3, 0));
		// #for N in range(NUM_RESOURCES)
		cost[$(N)] = (ONE_TOKEN * RECIPES[_block][$(N)] * s) / $$(PPM_ONE**2);
		// #done
		return cost;
	}

	/// @dev Create a tile at a position.
	/// This will initalize the id, price, blocks, and neighbor clouts.
	/// @param x The x position of the tile.
	/// @param y The y position of the tile.
	/// @return The created Tile (storage) instance.
	function _createTileAt(int32 x, int32 y) private returns (Tile storage) {
		bytes10 id = _toTileId(x, y);
		Tile storage tile = _tiles[id];
		if (tile.id == 0x0) {
			tile.id = id;
			tile.x = x;
			tile.y = y;
			tile.blocks = EMPTY_BLOCKS;
			tile.priceMultiplier = PPM_ONE;
			// No need to iterate over neighbors to get accurate clouts since we know
			// tiles are only created when an unowned edge tile is bought, so its
			// only existing neighbor should be empty.
			tile.neighborCloutsTotal = NUM_NEIGHBORS;
		}
		return tile;
	}

	/// @dev Create neighbors for a tile at a position.
	/// @param x The x position of the tile.
	/// @param y The y position of the tile.
	function _createNeighbors(int32 x, int32 y) private {
		for (uint8 i = 0; i < NUM_NEIGHBORS; i++) {
			(int32 ox, int32 oy) = $(NEIGHBOR_OFFSET(i));
			_createTileAt(x + ox, y + oy);
		}
	}

	/// @dev Get the Tile storage object at a position.
	/// @param x The x position of the tile.
	/// @param y The y position of the tile.
	/// @return The tile storage object at that position.
	function _getTileAt(int32 x, int32 y)
			private view returns (Tile storage) {

		return _tiles[_toTileId(x, y)];
	}

	/// @dev Get the Tile storage object at a position.
	/// Reverts if it does not exist.
	/// @param x The x position of the tile.
	/// @param y The y position of the tile.
	/// @return The tile storage object at that position.
	function _getExistingTileAt(int32 x, int32 y)
			private view returns (Tile storage) {

		bytes10 id = _toTileId(x, y);
		Tile storage tile = _tiles[id];
		require(tile.id == id, ERROR_NOT_FOUND);
		return tile;
	}

	/// @dev Increment the global block stats for all blocks passed.
	/// This will adjust the total counts, production rates, and total scores.
	/// @param blocks Right-aligned, packed representation of blocks to append.
	/// @param count The number of blocks packed in 'blocks'.
	function _increaseBlockStats(bytes16 blocks, uint8 count) private {
		for (uint8 h = 0; h < count; h++) {
			// Pop each block off the tower.
			uint8 b = uint8(uint128(blocks));
			blocks = blocks >> 8;
			BlockStats storage bs = _blockStats[b];
			bs.score += BLOCK_HEIGHT_BONUS[h];
			bs.count += 1;
		}
		// Update production limits.
		for (uint8 i = 0; i < NUM_RESOURCES; i++) {
			BlockStats storage bs = _blockStats[i];
			uint64 production = (PPM_ONE * bs.production) / PRODUCTION_ALPHA;
			production = _estIntegerSqrt(bs.count, production);
			production = (production * PRODUCTION_ALPHA) / PPM_ONE;
			bs.production = production;
		}
	}

	/// @dev Share funds and resources from a tile to its immediate neighbors.
	/// The total amount distributed to all neighbors is defined by the TAX_RATE.
	/// The amount each neighbor actually receives depends on its relative
	/// 'clout', which is the height of its tower against all combined heights
	/// of all the towers of the tile's neighbors, so the tallest tower will
	/// receive the largest share.
	/// If a neighbor is unowned, its share of resources are discarded, but the
	/// funds are added to the 'fees' collected by this contract.
	/// @param tile The tile object sharing its funds/resources.
	/// @param funds The (untaxed) funds to share.
	/// @param resources The (untaxed) resources to share.
	function _share(
			Tile storage tile,
			uint256 funds,
			uint256[NUM_RESOURCES] memory resources)
			private {

		// Compute how much each neighbor is entitled to.
		uint8 neighborCloutsTotal = tile.neighborCloutsTotal;
		uint256 sharedFunds = _toTaxes(funds);
		uint256[NUM_RESOURCES] memory sharedResources =
			$$(map(range(NUM_RESOURCES), (R) => `_toTaxes(resources[${R}])`));
		// Share with neighbors.
		for (uint8 i = 0; i < NUM_NEIGHBORS; i++) {
			(int32 ox, int32 oy) = $(NEIGHBOR_OFFSET(i));
			Tile storage neighbor = _getExistingTileAt(tile.x + ox, tile.y + oy);
			// Scaling factor so that taller towers receive more.
			uint64 clout = ((neighbor.height + 1) * PPM_ONE)
				/ neighborCloutsTotal;
			// If the tile is owned, share resources and funds.
			if (neighbor.owner != ZERO_ADDRESS) {
				// #for RES in range(NUM_RESOURCES)
				neighbor.sharedResources[$$(RES)] =
					neighbor.sharedResources[$$(RES)].add(
						(clout * sharedResources[$$(RES)]) / PPM_ONE);
				// #done
				neighbor.sharedFunds = neighbor.sharedFunds.add(
					(clout * sharedFunds) / PPM_ONE);
			} else {
				// If the tile is unowned, keep the funds as fees.
				fees = fees.add((clout * sharedFunds) / PPM_ONE);
			}
		}
	}

	/// @dev Claims funds and resources from a tile to its owner.
	/// The amount minted/transfered/credited will be minus the tax.
	/// Resources are immediately minted to the tile owner.
	/// Funds (ether) are credited (pull pattern) to the tile owner unless
	/// the caller is also the tile owner, in which case it will be transfered
	/// immediately.
	/// @param tile The tile object.
	/// @param funds The funds (ether) held by the tile.
	/// @param resources The resources held by the tile.
	function _claim(
			Tile storage tile,
			uint256 funds,
			uint256[NUM_RESOURCES] memory resources)
			private {

		require(tile.owner != ZERO_ADDRESS, ERROR_INVALID);
		// Mint the taxed amount of resources held to the tile owner.
		_market.mint(tile.owner,
			$$(map(range(NUM_RESOURCES), (I) => `_toTaxed(resources[${I}])`)));
		// If caller is not the owner, only credit ether.
		if (tile.owner != msg.sender)
			_creditTo(tile.owner, _toTaxed(funds));
		else // Otherwise try to transfer the ether synchronously.
			_transferTo(tile.owner, _toTaxed(funds));
	}

	/// @dev Get the full price for a tile.
	/// This is the isolated tile price plus seasonal bonuses,
	/// and neighborhood bonus.
	/// @param tile The tile object.
	/// @return The ether price, in wei.
	function _getTilePrice(Tile storage tile) private view
			returns (uint256 price) {

		uint256[NUM_RESOURCES] memory marketPrices = _market.getPrices();
		price = _getIsolatedTilePrice(tile, marketPrices);
		/// Get the aggregate of neighbor prices.
		uint256 neighborPrices = 0;
		for (uint8 i = 0; i < NUM_NEIGHBORS; i++) {
			(int32 ox, int32 oy) = $(NEIGHBOR_OFFSET(i));
			Tile storage neighbor = _getTileAt(tile.x + ox, tile.y + oy);
			if (neighbor.id != 0x0)
				neighborPrices = neighborPrices.add(
					_getIsolatedTilePrice(neighbor, marketPrices));
		}
		// Add the average of the neighbor prices.
		price = price.add(neighborPrices / NUM_NEIGHBORS);
		// If the tile is in season, it has a price bonus.
		if (_isTileInSeason(tile))
			price = price.mul(SEASON_PRICE_BONUS) / PPM_ONE;
	}

	/// @dev Get the isolated price for a tile.
	/// This is a sum of the base price for a tile (which increases
	/// with every purchase of the tile) and the materials costs of each block
	/// built on the tile at current market prices.
	/// @param tile The tile object.
	/// @param marketPrices The current market price of each resource.
	function _getIsolatedTilePrice(
			Tile storage tile,
			uint256[NUM_RESOURCES] memory marketPrices)
			private view returns (uint256 price) {

		assert(tile.id != 0x0);
		price = 0;
		// #for RES in range(NUM_RESOURCES)
		// price += market_price * buildCost
		price = price.add(marketPrices[$(RES)].mul(tile.buildCosts[$(RES)]));
		// #done
		price = price / ONE_TOKEN +
			(BASE_TILE_PRICE * tile.priceMultiplier) / PPM_ONE;
	}

	/// @dev Do a direct transfer of ether to someone.
	/// This is like address.transfer() but with some key differences:
	/// The transfer will forward all remaining gas to the recipient and
	/// will revert with an ERROR_TRANSFER_FAILED on failure.
	/// Transfers to the zero address (0x0), will simply add to the fees
	/// collected.
	/// @param to Recipient address.
	/// @param amount Amount of ether (in wei) to transfer.
	function _transferTo(address to, uint256 amount) private {
		if (amount > 0) {
			if (to == ZERO_ADDRESS) {
				fees = fees.add(amount);
				return;
			}
			// Use fallback function and forward all remaining gas.
			//solhint-disable-next-line
			(bool success,) = to.call.value(amount)("");
			require(success, ERROR_TRANSFER_FAILED);
		}
	}

	/// @dev Credit someone some ether to be pulled via collectCredits() later.
	/// Transfers to the zero address (0x0), will simply add to the fees
	/// collected.
	/// @param to Recipient address.
	/// @param amount Amount of ether (in wei) to transfer.
	function _creditTo(address to, uint256 amount) private {
		if (amount > 0) {
			// Payments to zero address are just fees collected.
			if (to == ZERO_ADDRESS) {
				fees = fees.add(amount);
				return;
			}
			// Just credit the player. She can collect it later through
			// collectCredits().
			credits[to] = credits[to].add(amount);
			emit Credited(to, amount);
		}
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
		credits[to] = credits[to].add(msg.value);
	}

	function __getYield(int32 x, int32 y) external view returns
			(uint256[NUM_RESOURCES] memory resources, uint256 funds) {

		Tile storage tile = _getExistingTileAt(x, y);
		resources = _getTileYield(tile, $(BLOCKTIME));
		funds = tile.sharedFunds;
	}

	// solhint-enable
	// #endif
}
