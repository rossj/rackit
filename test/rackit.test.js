/*global require, describe, it, before, after*/

var Rackit = require('../lib/rackit.js').Rackit;
var async = require('async');
var should = require('should');
var nock = require('nock');
var host = 'https://auth.api.rackspacecloud.com';
var base = '/v1.0';

describe('Rackit', function() {
	describe('Constructor', function() {
		it('should have default options', function() {
			var rackit = new Rackit();
			rackit.should.be.an['instanceof'](Rackit);
			rackit.options.prefix.should.equal('dev');
			rackit.options.useCDN.should.equal(true);
			rackit.options.baseURI.should.equal(host + base);
		});
		it('should allow overriding of default options', function() {
			var rackit = new Rackit({
				pre : 'dep',
				useCDN : false
			});
			rackit.options.pre.should.equal('dep');
			rackit.options.useCDN.should.equal(false);
			// Check non-overridden options are still there
			rackit.options.baseURI.should.equal(host + base);
		});
	});
	describe('#init', function() {
		var badUser = 'boopity';
		var badKey = 'bop';
		
		// Setup nock to respond to bad auth request
		nock(host).get(base)
		//
		.matchHeader('X-Auth-User', badUser).matchHeader('X-Auth-Key', badKey)
		//
		.reply(401, 'Unauthorized');

		it('should return an error when no credentials are given', function(cb) {
			var rackit = new Rackit();
			rackit.init(function(err) {
				should.exist(err);
				err.should.be.an['instanceof'](Error);
				cb();
			});
		});
		it('should return an error when bad credentials are given', function(cb) {
			var rackit = new Rackit({
				user: badUser,
				key: badKey
			});
			rackit.init(function(err) {
				should.exist(err);
				err.should.be.an['instanceof'](Error);
				cb();
			});
		});
	});
});
