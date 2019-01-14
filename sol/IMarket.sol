pragma solidity ^0.5;

/// @title Definition for a resource token used by upcity.
/// @author Lawrence Forman (me@merklejerk.com)
interface IMarket {

	function getPrice(address resource) external view returns (uint256);
	function mint(address resource, address to, uint256 amount) external;
	function burn(address resource, address from, uint256 amount) external;
}
