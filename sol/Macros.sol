pragma solidity ^0.5;

// #def ONE_DAY 24 * 60 * 60

// #def ONE_TOKEN (1 ether)

// #def ARRAY_SEP concat(",\n", __indent)

// #def UINT256_ARRAY(count, value) \
// 	map(filled(count, value), AS_UINT256)

// #def UINT64_ARRAY(count, value) \
// 	map(filled(count, value), AS_UINT64)

// #def UINT8_ARRAY(count, value) \
// 	map(filled(count, value), AS_UINT64)

// #def TO_PPM(x) round(x * PRECISION)

// #def AS_UINT64(x) `uint64($${uint64(x)})`

// #def AS_UINT256(x) `uint256($${uint256(x)})`

// #def PPM_ONE TO_PPM(1)

// #def MAX(a, b) ((a) >= (b) ? (a) : (b))

// #def MIN(a, b) ((a) <= (b) ? (a) : (b))
