/*global require, __dirname, describe, it, before, beforeEach, after*/

var Rackit = require('../lib/rackit.js').Rackit;
var async = require('async');
var should = require('should');
var nock = require('nock');

// Fake vars for our mock
var host = 'https://auth.api.rackspacecloud.com';
var base = '/v1.0';
var user = 'boopity';
var key = 'bop';
var storage = {
	base : 'https://storage.blablah.com',
	path : '/v1/blah'
};
var cdn = {
	base : 'https://cdn.blablah.com',
	path : '/v1/blah'
};
var token = 'boopitybopitydadabop';

var superNock = {
	aScopes : [],
	setupResponse : function() {
		this.setupAuthResponse().setupStorageResponse().setupCDNResponse();
	},
	setupAuthResponse : function() {

		// Setup nock to respond to a good auth request, twice
		var scope = nock(host)
		//
		.get(base).matchHeader('X-Auth-User', user).matchHeader('X-Auth-Key', key)
		//
		.reply(204, 'No Content', {
			'x-storage-url' : storage.base + storage.path,
			'x-cdn-management-url' : cdn.base + cdn.path,
			'x-auth-token' : token
		});
		this.aScopes.push(scope);
		return this;
	},
	setupStorageResponse : function() {

		var aContainers = [{
			name : 'one',
			count : 2,
			bytes : 12
		}, {
			name : 'two',
			count : 3,
			bytes : 12
		}, {
			name : 'three',
			count : 3,
			bytes : 12
		}];
		var scope = nock(storage.base)
		//
		.matchHeader('X-Auth-Token', token).get(storage.path + '?format=json')
		//
		.reply(200, JSON.stringify(aContainers));

		this.aScopes.push(scope);
		return this;
	},
	setupCDNResponse : function() {
		var aContainers = [{
			name : 'one',
			cdn_enabled : true,
			ttl : 28800,
			log_retention : false,
			cdn_uri : 'http://c2.r2.cf1.rackcdn.com',
			cdn_ssl_uri : 'https://c2.ssl.cf1.rackcdn.com',
			cdn_streaming_uri : 'https://c2.r2.stream.cf1.rackcdn.com'
		}, {
			name : 'two',
			cdn_enabled : true,
			ttl : 28800,
			log_retention : false,
			cdn_uri : 'http://c2.r2.cf1.rackcdn.com',
			cdn_ssl_uri : 'https://c2.ssl.cf1.rackcdn.com',
			cdn_streaming_uri : 'https://c2.r2.stream.cf1.rackcdn.com'
		}];
		var scope = nock(cdn.base)
		//
		.matchHeader('X-Auth-Token', token).get(cdn.path + '?format=json')
		//
		.reply(200, JSON.stringify(aContainers));

		this.aScopes.push(scope);
		return this;
	},
	allDone : function() {
		// Assert that all the scopes are done
		for(var i = 0; i < this.aScopes.length; i++) {
			this.aScopes[i].done();
		}
		// Clear all scopes
		this.aScopes = [];
	}
};

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

		it('should return an error when no credentials are given', function(cb) {
			var rackit = new Rackit();
			rackit.init(function(err) {
				should.exist(err);
				err.should.be.an['instanceof'](Error);
				cb();
			});
		});
		it('should return an error when bad credentials are given', function(cb) {
			// Setup nock to respond to bad auth request
			var scope = nock(host).get(base).reply(401, 'Unauthorized');

			var rackit = new Rackit({
				user : user + 'blahblah',
				key : key + 'bloopidy'
			});
			rackit.init(function(err) {
				should.exist(err);
				err.should.be.an['instanceof'](Error);
				scope.done();
				cb();
			});
		});
		it('should get container info when good credentials are given', function(cb) {
			superNock.setupResponse();

			var rackit = new Rackit({
				user : user,
				key : key
			});
			rackit.init(function(err) {
				should.not.exist(err);
				superNock.allDone();
				cb();
			});
		});
		it('should properly cache container info when good credentials are given', function(cb) {
			superNock.setupResponse();

			var rackit = new Rackit({
				user : user,
				key : key
			});
			rackit.init(function(err) {
				should.not.exist(err);

				rackit.aContainers.should.have.length(3);
				rackit.hContainers.should.have.ownProperty('one');
				rackit.hContainers.should.have.ownProperty('two');
				rackit.hContainers.should.have.ownProperty('three');
				rackit.aCDNContainers.should.have.length(2);
				rackit.hCDNContainers.should.have.ownProperty('one');
				rackit.hCDNContainers.should.have.ownProperty('two');

				superNock.allDone();
				cb();
			});
		});
	});
	describe('#add', function() {
		var rackit;

		beforeEach(function(cb) {
			rackit = new Rackit({
				user : user,
				key : key
			});
			
			superNock.setupResponse();
			rackit.init(function(err) {
				superNock.allDone();
				cb(err);
			});
		});
		it('should return an error if the file does not exist', function(cb) {
			rackit.add(__dirname + '/blah.jpg', function(err, cloudPath) {
				should.exist(err);
				err.should.be.an['instanceof'](Error);
				should.not.exist(cloudPath);
				cb();
			});
		});
	});
});
