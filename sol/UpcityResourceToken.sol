pragma solidity ^0.5;

// solhint-disable-next-line
import './base/openzeppelin/token/ERC20/ERC20.sol';

/// @title ERC20 token contract for upcity resources (onite, topite, rubite).
contract UpcityResourceToken is ERC20 {
	using SafeMath for uint256;

	address internal constant ZERO_ADDRESS = address(0x0);

	string public name;
	string public symbol;
	// solhint-disable-next-line
	uint8 public constant decimals = 18;
	mapping(address=>bool) public isAuthority;

	/// @dev Creates the contract.
	/// @param _name Token name
	/// @param _symbol Token symbol
	/// @param reserve Amount of tokens the contract instantly mint and will keep
	/// @param _authorities Who can mint and burn tokens arbitrarily
	/// locked up forever.
	constructor(
			string memory _name,
			string memory _symbol,
			uint256 reserve,
			address[] memory _authorities)
			public {

		require(reserve >= 0, 'reserve must be nonzero');
		name = _name;
		symbol = _symbol;
		for (uint256 i = 0; i < _authorities.length; i++)
			isAuthority[_authorities[i]] = true;
		_mint(address(this), reserve);
	}

	modifier onlyAuthority() {
		require(isAuthority[msg.sender], 'caller is not an authority');
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
		require(from != ZERO_ADDRESS && from != address(this),
			'cannot burn from token contract');
		_burn(from, amt);
	}

	/// @dev Oerride transfer() to burn tokens if sent to
	/// 0x0 or this contract address.
	function transfer(address to, uint256 amt) public returns (bool) {
		// Transfers to 0x0 or this contract are burns.
		if (to == ZERO_ADDRESS || to == address(this)) {
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
		if (to == ZERO_ADDRESS || to == address(this)) {
			_burnFrom(from, amt);
			return true;
		}
		return super.transferFrom(from, to, amt);
	}
}
