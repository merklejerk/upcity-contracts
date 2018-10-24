pragma solidity ^0.4.24;

/// @dev Definition for a resource token used by upcity.
interface IMarket {
	function getPrice(address resource) public view returns (uint256);
}
