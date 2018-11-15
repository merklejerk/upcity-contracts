pragma solidity ^0.4.24;

/// @dev Definition for a resource token used by upcity.
interface IResourceToken {
	function totalSupply() external view returns (uint256);
	function balanceOf(address who) external view returns (uint256);
	function transfer(address to, uint256 amt) external returns (bool);
	function mint(address to, uint256 amt) external returns (bool);
	function burn(address from, uint256 amt) external returns (bool);
	function authority() external view returns (address);
	function decimals() external view returns (uint8);
}
