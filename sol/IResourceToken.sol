pragma solidity ^0.5;

/// @title Definition for a resource token used by upcity.
/// @author Lawrence Forman (me@merklejerk.com)
interface IResourceToken {
	
	function transfer(address to, uint256 amt) external returns (bool);
	function mint(address to, uint256 amt) external;
	function burn(address from, uint256 amt) external;
	function totalSupply() external view returns (uint256);
	function balanceOf(address who) external view returns (uint256);
	function isAuthority(address addr) external view returns (bool);
	function decimals() external view returns (uint8);
}
