pragma solidity ^0.4.24;

import {ResourceToken} from './ResourceToken.sol';

/// @title Game contract for upcity.app
contract UpCityGame {

	uint8 constant ONITE_BLOCK = 1;
	uint8 constant TOPITE_BLOCK = 2;
	uint8 constant RUBITE_BLOCK = 3;

	struct Position {
		int32 x, y;
	}

	struct Tile {
		bytes16 id;
		bytes16 blocks;
		address owner;
		uint32 timesBought;
		Position position;
	}

	Position[6] constant NEIGHBOR_OFFSETS = [
		Position(1,0),
		Position(1,-1),
		Position(0,-1),
		Position(-1,0),
		Position(-1,1),
		Position(0,1)
	];

	/// @dev Maps a (1-based) resource ID to its token.
	mapping(uint8=>ResourceToken) private _tokens;
	/// @dev Tiles by ID.
	mapping(bytes16=>Tile) private _tiles;

	constructor(address[] tokens, address genesisOwner) public {
		for (uint8 i = 0; i < tokens.length; i++) {
			address addr = tokens[i];
			_tokens[i+1] = ResourceToken(addr);
		}
		Tile storage tile = _createTileAt(0, 0);
		tile.owner = genesisOwner;
		tile.timesBought = 1;
		_createNeighbors(tile.x, tile.y);
	}

	_createTileAt(int32 x, int32 y) private returns (Tile storage) {
		bytes16 id = bytes16(abi.encodePacked(x, y, block.number));
		Tile storage tile = _tiles[id];
		require(tile.id == 0x0);
		tile.id = id;
		tile.position = Position(x, y);
		return tile;
	}

	_createNeighbors(int32 x, int32 y) private returns (Tile storage) {
		for (uint8 i = 0; i < NEIGHBOR_OFFSETS.length; i++) {
			Position memory o = NEIGHBOR_OFFSETS[i];
			int32 nx = x + o.x;
			int32 ny = y + o.y;
			if (!isTileAt(nx, ny))
				_createTileAt(nx, ny);
		}
	}

	toTileId(int32 x, int32 y) public view returns (bytes16) {
		return bytes16(abi.encodePacked(x, y, address(this)));
	}

	_getTileAt(int32 x, int32 y) private view returns (Tile storage) {
		return _tiles[toTileId(x, y)];
	}

	_getExistingTileAt(int32 x, int32 y) private view returns (Tile storage) {
		bytes16 id = toTileId(x, y);
		Tile storage tile = _tiles[id];
		require(tile.id == id);
		return tile;
	}

	isTileAt(int32 x, int32 y) public view returns (bool) {
		Tile storage tile = _getTileAt(x, y);
		return tile.id != 0x0;
	}

	describeTileAt(int32 x, int32 y) public view
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
		timesBought = tile.timesBought;
		owner = tile.owner;
		blocks = tile.blocks;
		price = _getTilePrice(tile);
	}

	buyTileAt(int32 x, int32 y) public payable returns (bool) {
		Tile storage tile = _getExistingTileAt(x, y);
		require(tile.owner != msg.sender);
		uint256 price = _getTilePrice(tile);
		require(msg.value >= price);
		tile.owner = msg.sender;
		// Refund any overpayment.
		if (msg.value > price)
			msg.sender.transfer(msg.value - price);
		return true;
	}

	buildBlockAt(int32 x, int32 y, uint8 block) public returns (bool) {
		_tokens
	}
}
