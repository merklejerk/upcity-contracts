'use strict'
const _ = require('lodash');
const constants = require('../../constants.js');

module.exports = _.zipObject(constants.ERRORS, _.map(constants.ERRORS,
	err => new RegExp(`revert ${err}$`)));
