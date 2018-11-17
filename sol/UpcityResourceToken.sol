pragma solidity ^0.4.24;

import 'https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-solidity/release-v2.0.0/contracts/token/ERC20/ERC20.sol';

/// @title ERC20 token contract for upcity resources (onite, topite, rubite).
contract UpcityResourceToken is ERC20 {
	using SafeMath for uint256;

	string public name;
	string public symbol;
	uint8 public constant decimals = 18;
	address public authority;

	/// @dev Creates the contract.
	/// @param _name Token name
	/// @param _symbol Token symbol
	/// @param _authority Who can mint tokens and burn arbitrarily
	/// @param reserve Amount of tokens the contract instantly mint and will keep
	/// locked up forever.
	constructor(
			string _name, string _symbol, address _authority, uint256 reserve)
			public {

		assert(reserve >= 0);
		name = _name;
		symbol = _symbol;
		authority = _authority;
		_mint(address(this), reserve);
	}

	modifier onlyAuthority() {
		require(msg.sender == authority);
		_;
	}

	/// @dev Mint new tokens and give them to an address.
	/// Only the authority may call this.
	function mint(address to, uint256 amt) public onlyAuthority {
		_mint(to, amt);
	}

	/// @dev Burn tokens held by an address.
	/// Only the authority may call this.
	function burn(address from, uint256 amt) public onlyAuthority {
		require(from != 0x0 && from != address(this));
		_burn(from, amt);
	}

	/// @dev Oerride transfer() to burn tokens if sent to
	/// 0x0 or this contract address.
	function transfer(address to, uint256 amt) public returns (bool) {
		// Transfers to 0x0 or this contract are burns.
		if (to == 0x0 || to == address(this)) {
			_burn(msg.sender, amt);
			return true;
		}
		return super.transfer(to, amt);
	}

	/// @dev Oerride transferFrom() to burn tokens if sent to
	/// 0x0 or this contract address.
	function transferFrom(address from, address to, uint256 amt)
			public returns (bool) {

		// Transfers to 0x0 or this contract are burns.
		if (to == 0x0 || to == address(this)) {
			_burnFrom(from, amt);
			return true;
		}
		return super.transferFrom(from, to, amt);
	}

	// #if TEST
	function __mint(address to, uint256 amt) public {
		_mint(to, amt);
	}
	// #endif
}
