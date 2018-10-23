pragma solidity ^0.4.24;

/// @dev Definition for a resource token used by upcity.
interface ResourceToken {
	function totalSupply() public view returns (uint256);
	function balanceOf(address who) public view returns (uint256);
	function transfer(address to, uint256 amt) public returns (bool);
	function mint(address to, uint256 amt) public returns (bool);
	function burn(address from, uint256 amt) public returns (bool);
	function authority() public view returns (address);
	function decimals() public view returns (uint8);
}
