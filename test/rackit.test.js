/*global require, __dirname, describe, it, before, beforeEach, after*/

var Rackit = require('../lib/main.js').Rackit;
var url = require('url');
var async = require('async');
var should = require('should');
var nock = require('nock');

// Fake vars for our mock
var clientOptions = Rackit.defaultOptions;

var mockOptions = {
	user : 'boopity',
	key : 'bop',
	tempURLKey : '3522d2sa',
	storage : 'https://storage.blablah.com/v1/blah',
	cdn : 'https://cdn.blablah.com/v1/blah',
	token : 'boopitybopitydadabop'
};

var superNock = {
	aScopes : [],
	typicalResponse : function() {
		return this.auth().storage().CDN();
	},
	auth : function() {
		// Setup nock to respond to a good auth request, twice
		var path = url.parse(clientOptions.baseURI).pathname;
		var scope = nock(clientOptions.baseURI).get(path).matchHeader('X-Auth-User', mockOptions.user).matchHeader('X-Auth-Key', mockOptions.key).reply(204, 'No Content', {
			'x-storage-url' : mockOptions.storage,
			'x-cdn-management-url' : mockOptions.cdn,
			'x-auth-token' : mockOptions.token
		});

		this.aScopes.push(scope);
		return this;
	},
	tempURL : function() {
		var path = url.parse(mockOptions.storage).pathname;
		var scope = nock(mockOptions.storage).post(path).matchHeader('X-Account-Meta-Temp-Url-Key', mockOptions.tempURLKey).reply(204, 'No Content');

		this.aScopes.push(scope);
		return this;
	},
	storage : function() {

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

		var path = url.parse(mockOptions.storage).pathname + '?format=json';
		var scope = nock(mockOptions.storage).get(path).matchHeader('X-Auth-Token', mockOptions.token).reply(200, JSON.stringify(aContainers));

		this.aScopes.push(scope);
		return this;
	},
	CDN : function() {
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

		var path = url.parse(mockOptions.cdn).pathname + '?format=json';
		var scope = nock(mockOptions.cdn).get(path).matchHeader('X-Auth-Token', mockOptions.token).reply(200, JSON.stringify(aContainers));

		this.aScopes.push(scope);
		return this;
	},
	allDone : function() {
		// Assert that all the scopes are done
		for (var i = 0; i < this.aScopes.length; i++) {
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
			rackit.options.baseURI.should.equal('https://auth.api.rackspacecloud.com/v1.0');
		});
		it('should allow overriding of default options', function() {
			var rackit = new Rackit({
				pre : 'dep',
				useCDN : false
			});
			rackit.options.pre.should.equal('dep');
			rackit.options.useCDN.should.equal(false);
			// Check non-overridden options are still there
			rackit.options.baseURI.should.equal('https://auth.api.rackspacecloud.com/v1.0');
		});
	});
	describe('#init', function() {

		it('should return an error when no credentials are given', function(cb) {
			var rackit = new Rackit();
			rackit.init(function(err) {
				should.exist(err);
				err.should.be.an['instanceof'](Error);
				err.message.should.equal('No credentials');
				cb();
			});
		});
		it('should return an error when bad credentials are given', function(cb) {
			// Setup nock to respond to bad auth request
			var path = url.parse(clientOptions.baseURI).pathname;
			var scope = nock(clientOptions.baseURI).get(path).reply(401, 'Unauthorized');

			var rackit = new Rackit({
				user : mockOptions.user + 'blahblah',
				key : mockOptions.key + 'bloopidy'
			});
			rackit.init(function(err) {
				should.exist(err);
				err.should.be.an['instanceof'](Error);
				scope.done();
				cb();
			});
		});
		it('should not return an error with good credentials', function(cb) {
			superNock.typicalResponse();

			var rackit = new Rackit({
				user : mockOptions.user,
				key : mockOptions.key,
			});
			rackit.init(function(err) {
				should.not.exist(err);
				superNock.allDone();
				cb();
			});
		});
		it('should set temp url key if provided, and get container info', function(cb) {
			superNock.typicalResponse().tempURL();

			var rackit = new Rackit({
				user : mockOptions.user,
				key : mockOptions.key,
				tempURLKey : mockOptions.tempURLKey
			});
			rackit.init(function(err) {
				should.not.exist(err);
				superNock.allDone();
				cb();
			});
		});
		it('should get container info and cache it', function(cb) {
			superNock.typicalResponse();

			var rackit = new Rackit({
				user : mockOptions.user,
				key : mockOptions.key,
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
			superNock.typicalResponse();
			rackit = new Rackit({
				user : mockOptions.user,
				key : mockOptions.key,
			});
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
