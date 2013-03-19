/*global require, __dirname, describe, it, before, beforeEach, after*/
var
// Node modules
	url = require('url'),
	path = require('path'),
	fs = require('fs'),
	http = require('http'),

// Npm modules
	async = require('async'),
	should = require('should'),
	nock = require('nock'),
	request = require('request');

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
var testFile = {
	path : path.resolve(__dirname, 'upload.txt'),
	type : 'text/plain'
};
testFile.data = fs.readFileSync(testFile.path, 'utf8');

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
		var path = url.parse(clientOptions.baseURIs[clientOptions.region]).pathname;
		var scope = nock(clientOptions.baseURIs[clientOptions.region])
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
	aContainers : [
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
			name : 'empty0',
			count : 0,
			bytes : 12
		},
		{
			name : 'single0',
			count : 2,
			bytes : 2000,
			objects : [{
				name : 'obj1',
				hash : 'randomhash',
				bytes : 1000,
				content_type : 'application\/octet-stream',
				last_modified : '2012-1-01T00:00:0.0'
			}, {
				name : 'obj2',
				hash : 'randomhash',
				bytes : 1000,
				content_type : 'application\/octet-stream',
				last_modified : '2012-1-01T00:00:0.0'
			}]
		},
		{
			name : 'multiple0',
			count : 3,
			bytes : 3000,
			objects : [{
				name : 'obj1',
				hash : 'randomhash',
				bytes : 1000,
				content_type : 'application\/octet-stream',
				last_modified : '2012-1-01T00:00:0.0'
			}, {
				name : 'obj2',
				hash : 'randomhash',
				bytes : 1000,
				content_type : 'application\/octet-stream',
				last_modified : '2012-1-01T00:00:0.0'
			}, {
				name : 'obj3',
				hash : 'randomhash',
				bytes : 1000,
				content_type : 'application\/octet-stream',
				last_modified : '2012-1-01T00:00:0.0'
			}]
		},
		{
			name : 'multiple1',
			count : 2,
			bytes : 2000,
			objects : [{
				name : 'obj4',
				hash : 'randomhash',
				bytes : 1000,
				content_type : 'application\/octet-stream',
				last_modified : '2012-1-01T00:00:0.0'
			}, {
				name : 'obj5',
				hash : 'randomhash',
				bytes : 1000,
				content_type : 'application\/octet-stream',
				last_modified : '2012-1-01T00:00:0.0'
			}]
		},
		{
			name : 'multiplemultiple0',
			count : 0,
			bytes : 2000
		}
	],

	storage : function () {
		var path = url.parse(mockOptions.storage).pathname + '?format=json';
		var scope = nock(mockOptions.storage)
			.get(path)
			.matchHeader('X-Auth-Token', mockOptions.token)
			.reply(200, JSON.stringify(this.aContainers));

		this.scopes.push(scope);
		return this;
	},
	aCDNContainers : [{
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
	],
	// Gets an array of containers matching a prefix
	getPrefixedContainers : function (prefix) {
		var container, containers = [];
		var i = this.aContainers.length;
		var reg = new RegExp('^' + prefix + '\\d+$');

		while (i--) {
			container = this.aContainers[i];

			// If the container doesn't have the prefix, skip it
			if (!container.name.match(reg))
				continue;

			containers.push(container);
		}

		return containers;
	},
	CDN : function () {
		var path = url.parse(mockOptions.cdn).pathname + '?format=json';
		var scope = nock(mockOptions.cdn)
			.get(path)
			.matchHeader('X-Auth-Token', mockOptions.token)
			.reply(200, JSON.stringify(this.aCDNContainers));

		this.scopes.push(scope);
		return this;
	},
	add : function (container, data, type, chunked) {
		var path = url.parse(mockOptions.storage).pathname + '/' + container + '/filename';
		var scope = nock(mockOptions.storage)
			.filteringPath(new RegExp(container + '/.*', 'g'), container + '/filename')
			.put(path, data)
			.matchHeader('X-Auth-Token', mockOptions.token)
			.matchHeader('Content-Type', type)
			.matchHeader('ETag', undefined);

		if (chunked) {
			scope.matchHeader('Transfer-Encoding', 'chunked');
		} else {
			scope.matchHeader('Content-Length', '' + Buffer.byteLength(data));
		}

		scope = scope.reply(201);

		this.scopes.push(scope);
		return this;
	},
	get : function (cloudpath, data) {
		var path = url.parse(mockOptions.storage).pathname + '/' + cloudpath;
		var scope = nock(mockOptions.storage)
			.get(path)
			.reply(200, data);
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
	list : function (prefix, limit) {
		var containers = this.getPrefixedContainers(prefix);
		var i = containers.length;
		var container, basepath, path, count, j, objects;
		var scope = nock(mockOptions.storage);

		// There may be more than one container with this prefix, and the client will be requesting from all
		while (i--) {
			container = containers[i];

			// Skip containers that don't have the given prefix
			if (container.name.indexOf(prefix) !== 0)
				continue;

			basepath = url.parse(mockOptions.storage).pathname + '/' + container.name;
			basepath += '?format=json&limit=' + limit;

			// If the container has no objects, respond with 204.
			if (!container.objects || container.objects.length === 0) {
				scope.get(basepath).reply(204);
				continue;
			}

			// The client may have to make multiple requests to this container depending on the limit
			for (count = 0; count <= container.objects.length; count += limit) {
				path = basepath;

				// If count > 0, the client will be requesting with a marker item from last response
				if (count > 0) {
					path = basepath + '&marker=' + container.objects[count-1].name
				}

				// Generate an array of object data to reply with
				objects = [];
				for (j = count; j < count+limit && j < container.objects.length; j++) {
					objects.push(container.objects[j]);
				}

				scope.get(path).reply(200, JSON.stringify(objects));
			}
		}

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
			rackit.options.region.should.equal('US');
			rackit.options.baseURIs[clientOptions.region].should.equal('https://auth.api.rackspacecloud.com/v1.0');
			rackit.options.baseURIs['UK'].should.equal('https://lon.auth.api.rackspacecloud.com/v1.0');
		});
		it('should allow overriding of default options', function () {
			var rackit = new Rackit({
				pre : 'dep',
				useCDN : false
			});
			rackit.options.pre.should.equal('dep');
			rackit.options.useCDN.should.equal(false);
			// Check non-overridden options are still there
			rackit.options.region.should.equal('US');
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
			var path = url.parse(clientOptions.baseURIs[clientOptions.region]).pathname;
			var scope = nock(clientOptions.baseURIs[clientOptions.region]).get(path).reply(401, 'Unauthorized');

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
				var i;

				should.not.exist(err);

				// Check the storage container cache
				rackit.aContainers.should.have.length(superNock.aContainers.length);
				for (i = 0; i < superNock.aContainers.length; i++) {
					rackit.hContainers.should.have.ownProperty(superNock.aContainers[i].name);
				}

				// Check the CDN container cache
				rackit.aCDNContainers.should.have.length(superNock.aCDNContainers.length);
				for (i = 0; i < superNock.aCDNContainers.length; i++) {
					rackit.hCDNContainers.should.have.ownProperty(superNock.aCDNContainers[i].name);
				}

				superNock.allDone();
				cb();
			});
		});

	});

	describe('#_getPrefixedContainers', function() {
		var rackit;

		// Start off with a new, initialized rackit
		before(function (cb) {
			superNock.typicalResponse();
			rackit = new Rackit({
				user : rackitOptions.user,
				key : rackitOptions.key
			});
			rackit.init(function (err) {
				superNock.allDone();
				cb(err);
			});
		});

		it('should return an empty array if no prefixed containers have been made', function() {
			// Hack some data into Rackit
			rackit.options.prefix = 'nonexistent';
			rackit.aContainers = [{
				name: 'existent'
			}];

			rackit._getPrefixedContainers().should.have.length(0);
		});

		it('should return a sorted array of prefixed containers', function() {
			// Hack some data into Rackit
			rackit.options.prefix = 'existent';
			rackit.aContainers = [{
				name: 'blah0'
			}, {
				name: 'existent2'
			}, {
				name: 'existent3'
			}, {
				name: 'existent0'
			}];

			rackit._getPrefixedContainers().should.eql(['existent0', 'existent2', 'existent3']);
		});

		it('should not include containers with a matching sub-prefix', function() {
			// Hack some data into Rackit
			rackit.options.prefix = 'existent';
			rackit.aContainers = [{
				name: 'blah0'
			}, {
				name: 'existent2'
			}, {
				name: 'existent3'
			}, {
				name: 'existent0'
			}, {
				name: 'existenter0'
			}];

			rackit._getPrefixedContainers().should.eql(['existent0', 'existent2', 'existent3']);
		});
	});

	describe('#add', function () {
		var rackit;

		// This function does some setup and checks for tests which are not intended to test automatic container creation.
		// It sets the container prefix for the Rackit instance, and asserts that the container is not full.
		// The return value is the current size of the container.
		function getFreeContainerCount(container) {
			// Get the prefix
			var prefix = container.replace(/\d+$/, '');

			rackit.options.prefix = prefix;

			// Assert that the container exists, and is not to capacity
			rackit.hContainers.should.have.property(container);

			var count = rackit.hContainers[container].count;
			count.should.be.below(50000);
			return count;
		}

		// Asserts that a successful file upload occured.
		function assertAdd(container, count, cb) {
			return function (err, cloudpath) {
				if (err) {
					console.log(err);
				}

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

		describe('local file upload (string param)', function() {

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

			it('should successfuly upload a file (to existing, non-full container)', function (cb) {
				var container = 'empty0';
				var count = getFreeContainerCount(container);

				// Perform the actual test
				superNock.add(container, testFile.data, testFile.type);
				rackit.add(testFile.path, assertAdd(container, count + 1, cb));
			});

			it('should allow overriding of the content-type', function (cb) {
				var container = 'empty0';
				var count = getFreeContainerCount(container);

				var type = 'text/mytype';
				superNock.add(container, testFile.data, type);
				rackit.add(testFile.path, { type: type }, assertAdd(container, count + 1, cb));
			});

		});

		describe('streaming upload (ReadableStream param)', function() {

			it('should return an error if the stream is not readable', function (cb) {
				var stream = fs.createReadStream(testFile.path);
				stream.destroy();

				rackit.add(stream, function (err, cloudpath) {
					should.exist(err);
					err.should.be.an['instanceof'](Error);
					should.not.exist(cloudpath);
					cb();
				});
			});

			it('should return an error if no type is specified (and no content-type header)', function(cb) {
				var stream = fs.createReadStream(testFile.path);
				rackit.add(stream, function (err, cloudpath) {
					should.exist(err);
					err.should.be.an['instanceof'](Error);
					should.not.exist(cloudpath);
					cb();
				});
			});

			it('should successfuly upload a file stream with explicit type', function (cb) {
				var container = 'empty0';
				var count = getFreeContainerCount(container);

				var stream = fs.createReadStream(testFile.path);
				superNock.add(container, testFile.data, testFile.type, true);
				rackit.add(stream, {type: testFile.type}, assertAdd(container, count + 1, cb));
			});

			it('should successfuly upload a ServerRequest stream with forwarded type', function (cb) {
				var container = 'empty0';
				var count = getFreeContainerCount(container);

				superNock.add(container, testFile.data, testFile.type, true);

				// Set up the small server that will forward the request to Rackit
				var server = http.createServer(function(req, res) {
					rackit.add(req, assertAdd(container, count + 1, cb));
					server.close();
				}).listen(7357);

				// Create the request to the small server above
				var req = request.put({
					uri : 'http://localhost:7357',
					headers: {
						'content-type': 'text/plain'
					}
				});

				fs.createReadStream(testFile.path).pipe(req);
			});

			it('should successfuly upload a ServerRequest stream with forwarded length', function (cb) {
				var container = 'empty0';
				var count = getFreeContainerCount(container);

				superNock.add(container, testFile.data, testFile.type, false);

				// Set up the small server that will forward the request to Rackit
				var server = http.createServer(function(req, res) {
					rackit.add(req, assertAdd(container, count + 1, cb));
					server.close();
				}).listen(7357);

				// Create the request to the small server above
				var req = request.put({
					uri : 'http://localhost:7357',
					headers: {
						'content-type': 'text/plain',
						'content-length': '' + Buffer.byteLength(testFile.data)
					}
				});

				fs.createReadStream(testFile.path).pipe(req);
			});

			it('should not forward the etag header of a ServerRequest stream', function (cb) {
				var container = 'empty0';
				var count = getFreeContainerCount(container);

				superNock.add(container, testFile.data, testFile.type, true);

				// Set up the small server that will forward the request to Rackit
				var server = http.createServer(function(req, res) {
					rackit.add(req, assertAdd(container, count + 1, cb));
					server.close();
				}).listen(7357);

				// Create the request to the small server above
				var req = request.put({
					uri : 'http://localhost:7357',
					headers: {
						'content-type': 'text/plain',
						'etag' : 'somehashvalue234'
					}
				});

				fs.createReadStream(testFile.path).pipe(req);
			});

			it('should successfuly upload a ServerRequest stream with explicit type', function (cb) {
				var container = 'empty0';
				var count = getFreeContainerCount(container);
				var type = 'text/pdf';

				superNock.add(container, testFile.data, type, true);

				// Set up the small server that will forward the request to Rackit
				var server = http.createServer(function(req, res) {
					rackit.add(req, {type : type}, assertAdd(container, count + 1, cb));
					server.close();
				}).listen(7357);

				// Create the request to the small server above
				var req = request.put({
					uri : 'http://localhost:7357',
					headers: {
						'content-type': 'text/plain'
					}
				});

				fs.createReadStream(testFile.path).pipe(req);
			});

		});

		describe('automatic container creation - non-CDN enabled', function () {

			it('should create a prefixed, non-CDN container when none exist', function (cb) {
				var prefix = 'new';
				var container = prefix + '0';

				rackit.options.prefix = prefix;
				rackit.options.useCDN = false;

				// Assert that the container does not exist
				rackit.hContainers.should.not.have.property(container);

				// Add on the mock for the add request
				superNock
					.createContainer(container)
					.add(container, testFile.data, testFile.type);

				rackit.add(testFile.path, assertAdd(container, 1, function () {
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

				// Add on the mock for the add request
				superNock
					.createContainer(container)
					.add(container, testFile.data, testFile.type);

				rackit.add(testFile.path, assertAdd(container, 1, function () {
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

				// Add on the mock for the add request
				superNock
					.createContainer(container)
					.enableCDN(container)
					.add(container, testFile.data, testFile.type);

				rackit.add(testFile.path, assertAdd(container, 1, function () {
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

				// Add on the mock for the add request
				superNock
					.createContainer(container)
					.enableCDN(container)
					.add(container, testFile.data, testFile.type);

				rackit.add(testFile.path, assertAdd(container, 1, function () {
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
				superNock
					.createContainer(container)
					.createContainer(container)
					.add(container, testFile.data, testFile.type)
					.add(container, testFile.data, testFile.type);

				// Upload two files in parallel
				async.parallel({
					one : function (cb) {
						rackit.add(testFile.path, cb);
					},
					two : function (cb) {
						rackit.add(testFile.path, cb);
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
				superNock
					.createContainer(container)
					.createContainer(container)
					.add(container, testFile.data, testFile.type)
					.add(container, testFile.data, testFile.type);

				// Upload two files in parallel
				async.parallel({
					one : function (cb) {
						rackit.add(testFile.path, cb);
					},
					two : function (cb) {
						rackit.add(testFile.path, cb);
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

	describe('#get', function () {
		var rackit;

		before(function (cb) {
			superNock.typicalResponse();
			rackit = new Rackit({
				user : rackitOptions.user,
				key : rackitOptions.key
			});
			rackit.init(function (err) {
				superNock.allDone();
				cb(err);
			});
		});

		it('should return a readable stream', function (cb) {
			var cloudpath = 'container/file';
			var filepath = __dirname + '/tempfile.txt';
			superNock.get(cloudpath, testFile.data);

			// Get the file
			var stream = rackit.get(cloudpath);

			var data = '';
			stream.on('data', function(chunk) {
				data += chunk;
			});

			stream.on('end', function() {
				superNock.allDone();
				data.should.equal(testFile.data);
				cb();
			});
		});

		it('should download to a file when specified', function (cb) {
			var cloudpath = 'container/file';
			var filepath = __dirname + '/tempfile.txt';
			superNock.get(cloudpath, testFile.data);

			// Get the file
			rackit.get(cloudpath, filepath, function(err) {
				// Test the data
				fs.readFile(filepath, 'utf8', function(err, data) {
					data.should.equal(testFile.data);
					fs.unlink(filepath, cb);
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

	describe('#list', function () {
		var rackit;

		// Initialize Rackit before the tests
		before(function (cb) {
			superNock.typicalResponse();
			rackit = new Rackit({
				user : rackitOptions.user,
				key : rackitOptions.key
			});
			rackit.init(function (err) {
				superNock.allDone();
				cb(err);
			});
		});



		// Gets all of the object cloudpaths belonging to the given containers. This function gets the objects
		// from the mock (the "actual" data store) for validation of what Rackit gives
		function getObjects (containers) {
			var i, j, container, object, objects = [];

			// Find the actual container objects to validate
			for (i = 0; i < containers.length; i++) {
				container = containers[i];

				// If the container doesn't have any objects, skip it
				if (!container.objects || !container.objects.length)
					continue;

				// Iterate each object in this container, adding the container to the object name
				for (j = 0; j < container.objects.length; j++) {
					object = container.objects[j];
					objects.push({
						cloudpath : container.name + '/' + object.name,
						name : object.name,
						hash : object.hash,
						bytes : object.bytes,
						content_type : object.content_type,
						last_modified : object.last_modified
					});
				}
			}
			return objects;
		}

		function getObjectCloudpaths (objects) {
			var i = objects.length;
			while (i--)
				objects[i] = objects[i].cloudpath;

			return objects;
		}

		// Asserts the list operation matches the provided list
		function assertList(prefix, listLimit, objects, cb) {
			// Set the test options to Rackit
			rackit.options.prefix = prefix;
			rackit.options.listLimit = listLimit;

			// Set up the nock to respond to Rackit's requests
			superNock.list(prefix, listLimit);

			// Call Rackits list method
			rackit.list(function(err, list) {
				superNock.allDone();
				should.not.exist(err);
				should.exist(list);

				// Check the result length
				list.should.have.length(objects.length);

				// Check the result contents
				for (var i = 0; i < objects.length; i++) {
					list.should.include(objects[i]);
				}

				cb();
			});
		}

		it('should return an empty array if there are yet no files', function (cb) {
			var prefix = 'empty';

			// Assert the test conditions (no files)
			getObjects(superNock.getPrefixedContainers(prefix)).length.should.equal(0);

			assertList(prefix, 10000, [], cb);
		});

		it('should return all items when there is one container (under list limit)', function (cb) {
			var prefix = 'single';

			// Assert the test conditions (one container)
			var containers = superNock.getPrefixedContainers(prefix);
			containers.length.should.equal(1);

			// Find the actual container objects to validate
			var objects = getObjects(containers);
			objects.length.should.be.above(0);

			// Set the list limit to be greater than this, to ensure test conditions
			var listLimit = objects.length + 1;

			assertList(prefix, listLimit, getObjectCloudpaths(objects), cb);
		});

		it('should return all items when there is one container (over list limit)', function (cb) {
			var prefix = 'single';

			// Assert the test conditions (one container)
			var containers = superNock.getPrefixedContainers(prefix);
			containers.length.should.equal(1);

			// Find the actual container objects to validate
			var objects = getObjects(containers);
			objects.length.should.be.above(1);

			// Set the list limit to be greater than this, to ensure test conditions
			var listLimit = objects.length - 1;

			assertList(prefix, listLimit, getObjectCloudpaths(objects), cb);
		});

		it('should return all items when there are multiple containers (over list limit)', function (cb) {
			var prefix = 'multiple';
			var listLimit = 1;

			// Assert the test conditions (multiple containers, above limit)
			var containers = superNock.getPrefixedContainers(prefix);
			containers.length.should.be.above(1);

			// Assert that one of the containers (first one) is above the list limit
			getObjects([containers[0]]).length.should.be.above(listLimit);

			// Find the actual container objects to validate
			var objects = getObjects(containers);

			assertList(prefix, listLimit, getObjectCloudpaths(objects), cb);
		});

		it('should return extended item info when specified as option', function (cb) {
			var prefix = 'multiple';
			var listLimit = 1;

			// Assert the test conditions (at least one container with some objects)
			var containers = superNock.getPrefixedContainers(prefix);
			containers.length.should.be.above(0);

			// Find the actual container objects to validate
			var objects = getObjects(containers);
			objects.length.should.be.above(0);

			// Set the test options to Rackit
			rackit.options.prefix = prefix;
			rackit.options.listLimit = listLimit;

			// Set up the nock to respond to Rackit's requests
			superNock.list(prefix, listLimit);

			// Call Rackits list method
			rackit.list({ extended : true }, function(err, list) {
				superNock.allDone();
				should.not.exist(err);
				should.exist(list);

				// Check the result length
				list.should.have.length(objects.length);

				// Check the result contents
				for (var i = 0; i < objects.length; i++) {
					list.should.includeEql(objects[i]);
				}

				cb();
			});
		});
	});

});
