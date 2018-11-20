pragma solidity ^0.4.24;

import 'https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-solidity/9b3710465583284b8c4c5d2245749246bb2e0094/contracts/math/SafeMath.sol';
import './IResourceToken.sol';
import './IMarket.sol';
import './UpcityMath.sol';
import './UpcityBase.sol';

// #if TEST
// #def BLOCKTIME _blockTime
// #else
// #def BLOCKTIME uint64(block.timestamp)
// #endif

// #def UNPACK_BLOCK(blocks, idx) uint8((blocks >> (8*idx)) & 0xFF)
// #def PACK_BLOCK(blocks, idx, block) \
// 	((blocks) & (~(bytes16(uint8(0xFF)) << (8*(idx))))) \
// 	| ((bytes16(uint8(block)) & 0xFF) << (8*(idx)))
// #def UINT256_ARRAY(count, value) \
// 	`[${map(filled(count, value), AS_UINT256)}]`

/// @title Game contract for upcity.app
contract UpcityGame is UpcityBase {
	using SafeMath for uint256;

	/// @dev Global block stats for each resource.
	BlockStats[NUM_RESOURCES] private _blockStats;
	/// @dev Tokens for each resource.
	IResourceToken[NUM_RESOURCES] private _tokens;
	/// @dev The market for all resources.
	IMarket private _market;
	/// @dev Tiles by ID.
	mapping(bytes16=>Tile) private _tiles;
	/// @dev Who may call the claimFunds() function.
	mapping(address=>bool) private _authorities;
	/// @dev Ether which has "fallen off the edge".
	/// Increased every time ether propogates to a tile
	/// that has no owner. Can be claimed with claimFunds().
	uint256 fundsCollected = 0;

	constructor(
			address[] tokens,
			address market,
			address genesisOwner,
			address[] authorities) public {

		assert(tokens.length == NUM_RESOURCES);
		for (uint256 i = 0; i < authorities.length; i++)
			_authorities[authorities[i]] = true;
		for (i = 0; i < NUM_RESOURCES; i++)
			_tokens[i] = IResourceToken(tokens[i]);
		_market = IMarket(market);
		Tile storage tile = _createTileAt(0, 0);
		tile.owner = genesisOwner;
		tile.timesBought = 1;
		_createNeighbors(tile.position.x, tile.position.y);
	}

	/// @dev Restrict calls to only from an authority
	modifier onlyAuthority() {
		require(_authorities[msg.sender], 'authority restricted');
		_;
	}

	function _createTileAt(int32 x, int32 y) private returns (Tile storage) {
		bytes16 id = toTileId(x, y);
		Tile storage tile = _tiles[id];
		require(tile.id == 0x0, 'cannot create tile that is already owned');
		tile.id = id;
		tile.position = Position(x, y);
		tile.blocks = EMPTY_BLOCKS;
		return tile;
	}

	function _createNeighbors(int32 x, int32 y) private {
		for (uint8 i = 0; i < NUM_NEIGHBORS; i++) {
			(int32 ox, int32 oy) = ${NEIGHBOR_OFFSET(i)};
			int32 nx = x + ox;
			int32 ny = y + oy;
			if (!isTileAt(nx, ny))
				_createTileAt(nx, ny);
		}
	}

	function toTileId(int32 x, int32 y) public view returns (bytes16) {
		return bytes16(keccak256(abi.encodePacked(x, y, address(this))));
	}

	function _getTileAt(int32 x, int32 y) private view returns (Tile storage) {
		return _tiles[toTileId(x, y)];
	}

	function _getExistingTileAt(int32 x, int32 y) private view returns (Tile storage) {
		bytes16 id = toTileId(x, y);
		Tile storage tile = _tiles[id];
		require(tile.id == id, 'tile does not exist');
		return tile;
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
				address owner,
				bytes16 blocks,
				uint256 price) {

		Tile storage tile = _getExistingTileAt(_x, _y);
		id = tile.id;
		x = tile.position.x;
		y = tile.position.y;
		timesBought = tile.timesBought; owner = tile.owner;
		blocks = tile.blocks;
		price = _getTilePrice(tile);
	}

	function buyTile(int32 x, int32 y) public payable returns (bool) {
		collect(x, y);
		Tile storage tile = _getExistingTileAt(x, y);
		require(tile.owner != msg.sender, 'you already own this tile');
		uint256 price = _getTilePrice(tile);
		require(msg.value >= price, 'offer not high enough');
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
		_sharePurchase(tile, taxes);
		return true;
	}

	function buildBlocks(int32 x, int32 y, bytes16 blocks)
			public returns (bool) {

		collect(x, y);
		Tile storage tile = _getExistingTileAt(x, y);
		require(tile.owner == msg.sender, 'you do not own this tile');
		uint8 height = _getHeight(tile.blocks);
		require(height < MAX_HEIGHT, 'tower is at maximum height');
		uint256[NUM_RESOURCES] memory cost = $${UINT256_ARRAY(3, 0)};
		for (uint8 i = 0; i < MAX_HEIGHT - height; i++) {
			uint8 b = ${UNPACK_BLOCK(blocks, i)};
			if (b >= MAX_BLOCK_VALUE)
				break;
			uint256[NUM_RESOURCES] memory bc = getBlockCost(b, height + i);
			// #for I in range(NUM_RESOURCES)
			cost[$${I}] = bc[$${I}].add(cost[$${I}]);
			// #done
			tile.blocks = ${PACK_BLOCK(tile.blocks, height + i, b)};
			_incrementBlockStats(b, height + i);
		}
		// #for I in range(NUM_RESOURCES)
		_burn(tile.owner, $${I}, cost[$${I}]);
		// #done
		return true;
	}

	function _incrementBlockStats(uint8 _block, uint8 height) private {
		assert(_block <= MAX_BLOCK_VALUE && height < MAX_HEIGHT);
		BlockStats storage bs = _blockStats[_block];
		bs.score += BLOCK_HEIGHT_BONUS[height];
		bs.count += 1;
		bs.production = 2 * uint256(UpcityMath.est_integer_sqrt(bs.count,
			uint64(bs.production / 2)));
	}

	function getBlockCost(uint8 _block, uint8 height)
			public view returns (uint256[NUM_RESOURCES] memory cost) {

		assert(_block <= MAX_BLOCK_VALUE && height < MAX_HEIGHT);
		uint256 c = ${MAX(_blockStats[_block].count, 1)};
		uint256 a = RESOURCE_ALPHAS[_block];
		uint256 s = BLOCK_HEIGHT_PREMIUM[height] * ${MAX(c * a, PPM_ONE)};
		// #for I in range(NUM_RESOURCES)
		cost[${I}] = (ONE_TOKEN * RECIPES[_block][${I}] * s) / PPM_ONE;
		// #done
	}

	function collect(int32 x, int32 y) public returns (bool) {
		Tile storage tile = _getExistingTileAt(x, y);
		require(tile.owner == msg.sender, 'you do not own this tile');
		require(${BLOCKTIME} > tile.lastTouchTime, 'block time is in the past');
		uint256 dt = ${BLOCKTIME} - tile.lastTouchTime;
		tile.lastTouchTime = ${BLOCKTIME};
		uint256[NUM_RESOURCES] memory collected = $${UINT256_ARRAY(3, 0)};
		for (uint8 height = 0; height < MAX_HEIGHT; height++) {
			uint8 b = ${UNPACK_BLOCK(tile.blocks, height)};
			if (b >= MAX_BLOCK_VALUE)
				break;
			uint256 amt = ONE_TOKEN * _blockStats[b].production;
			amt *= dt;
			amt *= BLOCK_HEIGHT_BONUS[height];
			amt /= _blockStats[b].score;
			// amt /= ONE_DAY * PPM_ONE**2
			amt /= $${ONE_DAY * PPM_ONE**2};
			collected[b] = collected[b].add(amt);
		}
		// Share with neighbors.
		// #for I in range(NUM_RESOURCES)
		_shareYield(tile, $${I},
			(collected[$${I}] * TAX_RATE) / PPM_ONE);
		// #done
		// Credit owner.
		// #for I in range(NUM_RESOURCES)
		_mintTo(tile.owner, $${I},
			collected[$${I}] - (collected[$${I}] * TAX_RATE) / PPM_ONE);
		// #done
		return true;
	}

	function claimFunds() public onlyAuthority {
		assert(address(this).balance >= fundsCollected);
		if (fundsCollected > 0) {
			uint256 funds = fundsCollected;
			fundsCollected = 0;
			msg.sender.transfer(funds);
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
				(int32 ox, int32 oy) = ${NEIGHBOR_OFFSET(i)};
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
				(int32 ox, int32 oy) = ${NEIGHBOR_OFFSET(i)};
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
		for (uint8 i = 0; i < NUM_NEIGHBORS; i++) {
			(int32 ox, int32 oy) = ${NEIGHBOR_OFFSET(i)};
			int32 nx = tile.position.x + ox;
			int32 ny = tile.position.y + oy;
			Tile storage neighbor = _getTileAt(nx, ny);
			if (neighbor.id != 0x0)
				price += _getIsolatedTilePrice(neighbor, marketPrices);
		}
		return price;
	}

	function _getIsolatedTilePrice(
			Tile storage tile,
			uint256[NUM_RESOURCES] memory marketPrices)
			private view returns (uint256) {

		uint256 price = tile.basePrice;
		for (uint8 h = 0; h < MAX_HEIGHT; h++) {
			uint8 b = ${UNPACK_BLOCK(tile.blocks, h)};
			if (b >= MAX_BLOCK_VALUE)
				break;
			uint256[NUM_RESOURCES] memory bc = getBlockCost(b, h);
			// #for RES in range(NUM_RESOURCES)
			price.add(marketPrices[${RES}].mul(bc[${RES}]) / ONE_TOKEN);
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
		if (tile.owner == 0x0)
			fundsCollected = fundsCollected.add(amount);
		else
			tile.credits.funds = tile.credits.funds.add(amount);
	}

	function _payTo(address recipient, uint256 amount) private {
		if (amount > 0) {
			if (recipient == 0x0)
				fundsCollected = fundsCollected.add(amount);
			else if (!recipient.send(amount)) {
				// Ignored.
			}
		}
	}

	function _mintTo(address recipient, uint8 resource, uint256 amount) private {
		if (amount > 0) {
			if (recipient != 0x0)
				_tokens[resource].mint(recipient, amount);
		}
	}

	function _burn(address owner, uint8 resource, uint256 amount) private {
		assert(owner != 0x0);
		if (amount > 0)
			_tokens[resource].burn(owner, amount);
	}

	function _getHeight(bytes16 blocks) private pure returns (uint8) {
		for (uint8 i = 0; i < MAX_HEIGHT; i++) {
			if (${UNPACK_BLOCK(blocks, i)} > MAX_BLOCK_VALUE)
				return i;
		}
		return MAX_HEIGHT;
	}

	function _getMarketPrices() private view
			returns (uint256[NUM_RESOURCES] memory prices) {

		// #for RES in range(NUM_RESOURCES)
		prices[${RES}] = _market.getPrice(address(_tokens[${RES}]));
		// #done
		return prices;
	}

	// #if TEST
	/* Test functions/properties. *******************************************/

	uint64 public _blockTime = uint64(block.timestamp);

	function __setBlockTime(uint64 t) public {
		_blockTime = t;
	}
	// #endif
}
