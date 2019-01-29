MAX_HEIGHT = 16;
module.exports = {
	CALENDAR_START: Math.floor((new Date('Jan 1, 2019')).getTime() / 1000),
	NUM_SEASONS: 8,
	SEASON_FREQUENCY: 3,
	SEASON_YIELD_BONUS: 0.25,
	SEASON_PRICE_BONUS: 0.5,
	CONNECTOR_WEIGHT: 0.66,
	NUM_RESOURCES: 3,
	RESOURCE_NAMES: ['Onite', 'Topite', 'Rubite'],
	RESOURCE_SYMBOLS: ['UC-OT', 'UC-TP', 'UC-RB'],
	NUM_NEIGHBORS: 6,
	MAX_HEIGHT: MAX_HEIGHT,
	PRECISION: 1e6,
	PURCHASE_MARKUP: 1/3,
	TAX_RATE: 1/6,
	MINIMUM_TILE_PRICE: 0.001,
	PRODUCTION_ALPHA: 1.5,
	BLOCK_HEIGHT_PREMIUM_BASE: 4**(1/(MAX_HEIGHT-1)),
	BLOCK_HEIGHT_BONUS_BASE: 2**(1/(MAX_HEIGHT-1)),
	ERRORS: [
		'MAX_HEIGHT',
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
