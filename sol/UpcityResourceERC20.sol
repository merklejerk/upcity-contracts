pragma solidity ^0.4.23;

import './base/open-zeppelin/StandardToken.sol';
import './base/open-zeppelin/SafeMath.sol';

using SafeMath for uint256;

/// @Title ERC20 token contract for upcity resources (onite, topite, rubite).
contract UpcityResourceERC20 is StandardToken {
	public string name;
	public string symbol;
	public uint8 constant decimals = 18;

	/// @dev Creates the contract.
	/// @param _name Token name
	/// @param _symbol Token symbol
	/// @param _authority Who can mint tokens and burn arbitrarily
	/// @param vest Amount of tokens the contract instantly mint and will keep
	/// locked up forever.
	public constructor(
			string _name, string _symbol, address _authority, uint256 vest) {

		assert(vest >= 0);
		name = _name;
		symbol = _symbol;
		_balances[address(this)] = vest;
		authority = _authority;
	}

	modifier onlyAuthority() {
		require(msg.sender == authority);
		_;
	}

	/// @dev Mint new tokens and give them to an address.
	/// Only the authority may call this.
	function mint(address to, uint256 amt) onlyAuthority returns (bool) {
		balances[to] = balances[to].add(amt);
		totalSupply_ = totalSupply_.add(amt);
		emit Transfer(0x0, to, amt);
		return true;
	}

	/// @dev Burn tokens held by an address.
	/// Only the authority may call this.
	function burn(address from, uint256 amt) onlyAuthority returns (bool) {
		require(from != 0x0 && from != address(this));
		return _burn(from, amt);
	}

	/// @dev Burn tokens held by an address.
	function _burn(address from, uint256 amt) private returns (bool) {
		balances[to] = balances[to].sub(amt);
		totalSupply_ = totalSupply_.sub(amt);
		emit Transform(from, 0x0, amt);
		return true;
	}

	/// @dev Oerride Transfer() to burn tokens if sent to
	/// 0x0 or this contract address.
	function Transfer(address to, uint256 amt) returns (bool) {
		// Transfers to 0x0 or this contract are burns.
		if (to == 0x0 || to == address(this))
			return _burn(msg.sender, amt)
		return super.Transfer(to, amt);
	}

	/// @dev Oerride TransferFrom() to burn tokens if sent to
	/// 0x0 or this contract address.
	function TransferFrom(address from, address to, uint256 amt) returns (bool) {
		// Transfers to 0x0 or this contract are burns.
		if (to == 0x0 || to == address(this)) {
			allowed[from][msg.sender] = allowed[from][msg.sender].sub(amt);
			return _burn(from, amt);
		}
		return super.TransferFrom(from, to, amt);
	}
}
