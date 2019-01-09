module.exports = {
	CALENDAR_START: Math.floor((new Date('Jan 1, 2019')).getTime() / 1000),
	NUM_SEASONS: 8,
	SEASON_FREQUENCY: 3,
	SEASON_YIELD_BONUS: 0.25,
	SEASON_PRICE_BONUS: 0.5,
	NUM_RESOURCES: 3,
	NUM_NEIGHBORS: 6,
	MAX_HEIGHT: 16,
	PRECISION: 1e6,
	PURCHASE_MARKUP: 1/4,
	TAX_RATE: 1/6,
	MINIMUM_TILE_PRICE: 0.025,
	ERRORS: [
		'MAX_HEIGHT',
		'NOT_ALLOWED',
		'ALREADY',
		'INSUFFICIENT',
		'RESTRICTED',
		'UNINITIALIZED',
		'TIME_TRAVEL',
		'INVALID',
		'NOT_FOUND',
		'GAS',
		'TRANSFER_FAILED'
	]
};
