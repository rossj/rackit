/*global require, __dirname, describe, it, before, beforeEach, after*/
var
// Node modules
	url = require('url'),
	path = require('path'),
	fs = require('fs'),

// Npm modules
	async = require('async'),
	should = require('should'),
	nock = require('nock');

var Rackit = require('../lib/main.js').Rackit;

// Fake vars for our mock
var clientOptions = Rackit.defaultOptions;

var rackitOptions = {
	user : 'boopity',
	key : 'bop',
	tempURLKey : '3522d2sa'
};

var mockOptions = {
	storage : 'https://storage.blablah.com/v1/blah',
	cdn : 'https://cdn.blablah.com/v1/blah',
	token : 'boopitybopitydadabop'
};

// Info for the file we will upload
var filepath = path.resolve(__dirname, 'upload.txt');
var filedata = fs.readFileSync(filepath, 'utf8');

/**
 * A simple helper object for generating sequences of mock Rackspace responses
 * @type {Object}
 */
var superNock = {
	scopes : [],
	typicalResponse : function () {
		return this.auth().storage().CDN();
	},
	auth : function () {
		// Setup nock to respond to a good auth request, twice
		var path = url.parse(clientOptions.baseURI).pathname;
		var scope = nock(clientOptions.baseURI)
			.get(path)
			.matchHeader('X-Auth-User', rackitOptions.user)
			.matchHeader('X-Auth-Key', rackitOptions.key)
			.reply(204, 'No Content', {
				'x-storage-url' : mockOptions.storage,
				'x-cdn-management-url' : mockOptions.cdn,
				'x-auth-token' : mockOptions.token
			});

		this.scopes.push(scope);
		return this;
	},
	tempURL : function () {
		var path = url.parse(mockOptions.storage).pathname;
		var scope = nock(mockOptions.storage)
			.post(path)
			.matchHeader('X-Account-Meta-Temp-Url-Key', rackitOptions.tempURLKey)
			.reply(204, 'No Content');

		this.scopes.push(scope);
		return this;
	},
	storage : function () {

		var aContainers = [
			{
				name : 'one',
				count : 2,
				bytes : 12
			},
			{
				name : 'full0',
				count : 50000,
				bytes : 12000
			},
			{
				name : 'exists0',
				count : 3,
				bytes : 12
			}
		];

		var path = url.parse(mockOptions.storage).pathname + '?format=json';
		var scope = nock(mockOptions.storage).get(path).matchHeader('X-Auth-Token', mockOptions.token).reply(200, JSON.stringify(aContainers));

		this.scopes.push(scope);
		return this;
	},
	CDN : function () {
		var aContainers = [
			{
				name : 'one',
				cdn_enabled : true,
				ttl : 28800,
				log_retention : false,
				cdn_uri : 'http://c1.r2.cf1.rackcdn.com',
				cdn_ssl_uri : 'https://c1.ssl.cf1.rackcdn.com',
				cdn_streaming_uri : 'https://c1.r2.stream.cf1.rackcdn.com'
			},
			{
				name : 'full0',
				cdn_enabled : true,
				ttl : 28800,
				log_retention : false,
				cdn_uri : 'http://c2.r2.cf1.rackcdn.com',
				cdn_ssl_uri : 'https://c2.ssl.cf1.rackcdn.com',
				cdn_streaming_uri : 'https://c2.r2.stream.cf1.rackcdn.com'
			}
		];

		var path = url.parse(mockOptions.cdn).pathname + '?format=json';
		var scope = nock(mockOptions.cdn).get(path).matchHeader('X-Auth-Token', mockOptions.token).reply(200, JSON.stringify(aContainers));

		this.scopes.push(scope);
		return this;
	},
	add : function (container) {
		var path = url.parse(mockOptions.storage).pathname + '/' + container + '/filename';
		var scope = nock(mockOptions.storage)
			.filteringPath(new RegExp(container + '/.*', 'g'), container + '/filename')
			.put(path, filedata)
			.matchHeader('X-Auth-Token', mockOptions.token)
			.reply(201);

		this.scopes.push(scope);
		return this;
	},
	createContainer : function (container) {
		var path = url.parse(mockOptions.storage).pathname + '/' + container;
		var scope = nock(mockOptions.storage)
			.put(path)
			.matchHeader('X-Auth-Token', mockOptions.token)
			.reply(201);

		this.scopes.push(scope);
		return this;
	},
	enableCDN : function (container) {
		var path = url.parse(mockOptions.cdn).pathname + '/' + container;
		var scope = nock(mockOptions.cdn)
			.put(path)
			.matchHeader('X-Auth-Token', mockOptions.token)
			.reply(201);

		this.scopes.push(scope);
		return this;
	},
	allDone : function () {
		// Assert that all the scopes are done
		for ( var i = 0; i < this.scopes.length; i++ ) {
			this.scopes[i].done();
		}
		// Clear all scopes
		this.scopes = [];
	}
};

describe('Rackit', function () {
	describe('Constructor', function () {
		it('should have default options', function () {
			var rackit = new Rackit();
			rackit.should.be.an['instanceof'](Rackit);
			rackit.options.prefix.should.equal('dev');
			rackit.options.useCDN.should.equal(true);
			rackit.options.baseURI.should.equal('https://auth.api.rackspacecloud.com/v1.0');
		});
		it('should allow overriding of default options', function () {
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

	describe('#init', function () {

		it('should return an error when no credentials are given', function (cb) {
			var rackit = new Rackit();
			rackit.init(function (err) {
				should.exist(err);
				err.should.be.an['instanceof'](Error);
				err.message.should.equal('No credentials');
				cb();
			});
		});
		it('should return an error when bad credentials are given', function (cb) {
			// Setup nock to respond to bad auth request
			var path = url.parse(clientOptions.baseURI).pathname;
			var scope = nock(clientOptions.baseURI).get(path).reply(401, 'Unauthorized');

			var rackit = new Rackit({
				user : rackitOptions.user + 'blahblah',
				key : rackitOptions.key + 'bloopidy'
			});
			rackit.init(function (err) {
				should.exist(err);
				err.should.be.an['instanceof'](Error);
				scope.done();
				cb();
			});
		});
		it('should not return an error with good credentials', function (cb) {
			superNock.typicalResponse();

			var rackit = new Rackit({
				user : rackitOptions.user,
				key : rackitOptions.key
			});
			rackit.init(function (err) {
				should.not.exist(err);
				superNock.allDone();
				cb();
			});
		});
		it('should set temp url key if provided', function (cb) {
			superNock.typicalResponse().tempURL();

			var rackit = new Rackit({
				user : rackitOptions.user,
				key : rackitOptions.key,
				tempURLKey : rackitOptions.tempURLKey
			});
			rackit.init(function (err) {
				should.not.exist(err);
				superNock.allDone();
				cb();
			});
		});
		it('should get container info and cache it', function (cb) {
			superNock.typicalResponse();

			var rackit = new Rackit({
				user : rackitOptions.user,
				key : rackitOptions.key
			});
			rackit.init(function (err) {
				should.not.exist(err);

				rackit.aContainers.should.have.length(3);
				rackit.hContainers.should.have.ownProperty('one');
				rackit.hContainers.should.have.ownProperty('full0');
				rackit.hContainers.should.have.ownProperty('exists0');
				rackit.aCDNContainers.should.have.length(2);
				rackit.hCDNContainers.should.have.ownProperty('one');
				rackit.hCDNContainers.should.have.ownProperty('full0');

				superNock.allDone();
				cb();
			});
		});

	});

	describe('#add', function () {
		var rackit;

		// Asserts that a successful file upload occured.
		function assertAdd(container, count, cb) {
			return function (err, cloudpath) {
				superNock.allDone();
				should.not.exist(err);
				should.exist(cloudpath);

				// Assert the container exists
				rackit.hContainers.should.have.property(container);

				// Assert the file was added to the expected container
				cloudpath.split('/')[0].should.equal(container);

				// Assert the containers file count is as expected
				rackit.hContainers[container].count.should.equal(count);

				// Execute the callback for additonal asserts
				cb && cb();
			}
		}

		// Start off each test with a new, initialized rackit
		beforeEach(function (cb) {
			superNock.typicalResponse().tempURL();
			rackit = new Rackit({
				user : rackitOptions.user,
				key : rackitOptions.key,
				tempURLKey : rackitOptions.tempURLKey
			});
			rackit.init(function (err) {
				superNock.allDone();
				cb(err);
			});
		});

		it('should return an error if the file does not exist', function (cb) {
			var filepath = path.resolve(__dirname, 'fakefile.txt');

			// Assert the file doesn't exist
			fs.stat(filepath, function (err, stats) {
				should.exist(err);

				rackit.add(filepath, function (err, cloudpath) {
					should.exist(err);
					err.should.be.an['instanceof'](Error);
					should.not.exist(cloudpath);
					cb();
				});
			});
		});

		it('should upload a file to existing, non-full container', function (cb) {
			var prefix = 'exists';
			var container = prefix + '0';

			rackit.options.prefix = prefix;

			// Assert that the container exists, and is not to capacity
			rackit.hContainers.should.have.property(container);

			var count = rackit.hContainers[container].count;
			count.should.be.below(50000);

			superNock.add(container);
			rackit.add(filepath, assertAdd(container, count + 1, cb));
		});

		describe('automatic container creation - non-CDN enabled', function () {
			it('should create a prefixed, non-CDN container when none exist', function (cb) {
				var prefix = 'new';
				var container = prefix + '0';

				rackit.options.prefix = prefix;
				rackit.options.useCDN = false;

				// Assert that the container does not exist
				rackit.hContainers.should.not.have.property(container);

				superNock.createContainer(container).add(container);
				rackit.add(filepath, assertAdd(container, 1, function () {
					// Assert the container is not CDN enabled
					rackit.hCDNContainers.should.not.have.property(container);
					cb();
				}));
			});

			it('should create a prefixed, non-CDN container when existing are full', function (cb) {
				var prefix = 'full';
				var container = prefix + '1';

				rackit.options.prefix = prefix;
				rackit.options.useCDN = false;

				// Assert that the container does not exist
				rackit.hContainers.should.not.have.property(container);

				superNock.createContainer(container).add(container);
				rackit.add(filepath, assertAdd(container, 1, function () {
					// Assert the container is not CDN enabled
					rackit.hCDNContainers.should.not.have.property(container);
					cb();
				}));
			});
		});

		describe('automatic container creation - CDN enabled', function () {
			it('should create a prefixed, CDN container when none exist', function (cb) {
				var prefix = 'new';
				var container = prefix + '0';

				rackit.options.prefix = prefix;
				rackit.options.useCDN = true;

				// Assert that the container does not exist
				rackit.hContainers.should.not.have.property(container);

				superNock.createContainer(container).enableCDN(container).add(container);
				rackit.add(filepath, assertAdd(container, 1, function () {
					// Assert the container is CDN enabled
					rackit.hCDNContainers.should.have.property(container);
					cb();
				}));
			});

			it('should create a prefixed, CDN container when existing are full', function (cb) {
				var prefix = 'full';
				var container = prefix + '1';

				rackit.options.prefix = prefix;
				rackit.options.useCDN = true;

				// Assert that the container does not exist
				rackit.hContainers.should.not.have.property(container);

				superNock.createContainer(container).enableCDN(container).add(container);
				rackit.add(filepath, assertAdd(container, 1, function () {
					// Assert the container is CDN enabled
					rackit.hCDNContainers.should.have.property(container);
					cb();
				}));
			});
		});

		describe('automatic container creation - concurrent operations', function (cb) {
			it('parallel operations should produce one new container when none exist', function (cb) {
				var prefix = 'new';
				var container = prefix + '0';

				rackit.options.prefix = prefix;
				rackit.options.useCDN = false;

				// Assert that the container does not exist
				rackit.hContainers.should.not.have.property(container);

				// Setup the nock with two add operations
				superNock.createContainer(container).createContainer(container).add(container).add(container);

				// Upload two files in parallel
				async.parallel({
					one : function (cb) {
						rackit.add(filepath, cb);
					},
					two : function (cb) {
						rackit.add(filepath, cb);
					}
				}, function (err, cloudpaths) {
					superNock.allDone();
					should.not.exist(err);
					should.exist(cloudpaths.one);
					should.exist(cloudpaths.two);

					// Assert the container was created
					rackit.hContainers.should.have.property(container);

					// Assert the container count
					rackit.hContainers[container].count.should.equal(2);

					// Assert the file was added to the expected container
					cloudpaths.one.split('/')[0].should.equal(container);
					cloudpaths.two.split('/')[0].should.equal(container);

					cb();
				});
			});

			it('parallel operations should produce one new container when existing are full', function (cb) {
				var prefix = 'full';
				var container = prefix + '1';

				rackit.options.prefix = prefix;
				rackit.options.useCDN = false;

				// Assert that the container does not exist
				rackit.hContainers.should.not.have.property(container);

				// Setup the nock with two add operations
				superNock.createContainer(container).createContainer(container).add(container).add(container);

				// Upload two files in parallel
				async.parallel({
					one : function (cb) {
						rackit.add(filepath, cb);
					},
					two : function (cb) {
						rackit.add(filepath, cb);
					}
				}, function (err, cloudpaths) {
					superNock.allDone();
					should.not.exist(err);
					should.exist(cloudpaths.one);
					should.exist(cloudpaths.two);

					// Assert the container was created
					rackit.hContainers.should.have.property(container);

					// Assert the container count
					rackit.hContainers[container].count.should.equal(2);

					// Assert the file was added to the expected container
					cloudpaths.one.split('/')[0].should.equal(container);
					cloudpaths.two.split('/')[0].should.equal(container);

					cb();
				});
			});
		});
	});

	describe('#getCloudpath', function () {
		var rackit;

		before(function (cb) {
			superNock.typicalResponse().tempURL();
			rackit = new Rackit({
				user : rackitOptions.user,
				key : rackitOptions.key,
				tempURLKey : rackitOptions.tempURLKey
			});
			rackit.init(function (err) {
				superNock.allDone();
				cb(err);
			});
		});

		it('should return null when given URI from container that does not exist', function () {
			should.not.exist(rackit.getCloudpath('http://not.a.real.cdn.container.uri.rackcdn.com/nofile'));
		});
		it('should properly decode a regular CDN URI', function () {
			// Turn off SSL
			rackit.options.useSSL = false;

			var cloudpath = 'one/g24FWFsf34';
			var uri = rackit.getURI(cloudpath);

			// Ensure we are testing regular CDN URIs
			var protocol = uri.split(':')[0];
			protocol.should.equal('http');

			// Do the URI to Cloudpath conversion, and check with original
			var cloudpath2 = rackit.getCloudpath(uri);
			should.exist(cloudpath2);
			cloudpath2.should.equal(cloudpath);
		});
		it('should properly decode an SSL CDN URI', function () {
			// Turn on SSL
			rackit.options.useSSL = true;

			var cloudpath = 'one/sdf32faADf';
			var uri = rackit.getURI(cloudpath);

			// Ensure we are testing SSL CDN URIs
			var protocol = uri.split(':')[0];
			protocol.should.equal('https');

			// Do the URI to Cloudpath conversion, and check with original
			var cloudpath2 = rackit.getCloudpath(uri);
			should.exist(cloudpath2);
			cloudpath2.should.equal(cloudpath);
		});
		it('should properly decode a temp URI', function () {
			var cloudpath = 'one/sdf32faADf';
			var uri = rackit.getURI(cloudpath, 1000);

			// Ensure we are testing temp SSL URIs
			var protocol = uri.split(':')[0];
			protocol.should.equal('https');

			// Do the URI to Cloudpath conversion, and check with original
			var cloudpath2 = rackit.getCloudpath(uri);
			should.exist(cloudpath2);
			cloudpath2.should.equal(cloudpath);
		});
	});
});
