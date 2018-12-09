pragma solidity ^0.5;

/// @dev Definition for a resource token used by upcity.
interface IMarket {
	function getPrice(address resource) external view returns (uint256);
}
