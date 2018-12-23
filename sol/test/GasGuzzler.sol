// solhint-disable
pragma solidity ^0.5;

interface IGame {
	function describeTileAt(int32 _x, int32 _y) external view returns (
		bytes16 id,
		int32 x,
		int32 y,
		uint32 timesBought,
		uint64 lastTouchTime,
		address owner,
		bytes16 blocks,
		uint256 price);
	function buyTile(int32 x, int32 y) external payable returns (bool);
}

/// @dev A player that consumes all the gas in its fallback.
contract GasGuzzler {

	IGame internal _game;
	uint256[] _arr;

	constructor(address game) public payable {
		_game = IGame(game);
	}

	function () payable external {
		uint256 x = 0;
		for (uint256 i = 0; i < $$(10e6); i++) {
			x += 1;
			_arr.push(x);
		}
	}

	function buyTile(int32 x, int32 y) external payable returns (bool) {
		uint256 price = getTilePrice(x, y);
		return _game.buyTile.value(price)(x, y);
	}

	function getTilePrice(int32 x, int32 y) internal view returns (uint256) {
		bytes16 tid;
		int32 _tx;
		int32 _ty;
		uint32 timesBought;
		uint64 lastTouchTime;
		address owner;
		bytes16 blocks;
		uint256 price;
		(tid, _tx, _ty, timesBought, lastTouchTime, owner, blocks, price) =
			_game.describeTileAt(x, y);
		return price;
	}
}
