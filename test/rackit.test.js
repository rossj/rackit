/*global require, describe, it, before, beforeEach, after*/ // global functions
/*global Error, Buffer*/ // global classes
/*global __dirname*/ // global vars
var
// Node modules
	url = require('url'),
	path = require('path'),
	fs = require('fs'),
	http = require('http'),

// Npm modules
	_ = require('lodash'),
	async = require('async'),
	should = require('should'),
	request = require('request'),

// Project modules
	Rackit = require('../lib/main.js').Rackit,
	CloudFilesMock = require('./cloudfiles.mock.js');

var rackitOptions = {
	user : 'boopity',
	key : 'bop',
	tempURLKey : '3522d2sa'
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
var containers = {
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
			objects : [
				{
					name : 'obj1',
					hash : 'randomhash',
					bytes : 1000,
					content_type : 'application\/octet-stream',
					last_modified : '2013-12-14T00:05:20.908090'
				},
				{
					name : 'obj2',
					hash : 'randomhash',
					bytes : 1000,
					content_type : 'application\/octet-stream',
					last_modified : '2013-12-14T00:05:20.908090'
				}
			]
		},
		{
			name : 'multiple0',
			count : 3,
			bytes : 3000,
			objects : [
				{
					name : 'obj1',
					hash : 'randomhash',
					bytes : 1000,
					content_type : 'application\/octet-stream',
					last_modified : '2013-12-14T00:05:20.908090'
				},
				{
					name : 'obj2',
					hash : 'randomhash',
					bytes : 1000,
					content_type : 'application\/octet-stream',
					last_modified : '2013-12-14T00:05:20.908090'
				},
				{
					name : 'obj3',
					hash : 'randomhash',
					bytes : 1000,
					content_type : 'application\/octet-stream',
					last_modified : '2013-12-14T00:05:20.908090'
				}
			]
		},
		{
			name : 'multiple1',
			count : 2,
			bytes : 2000,
			objects : [
				{
					name : 'obj4',
					hash : 'randomhash',
					bytes : 1000,
					content_type : 'application\/octet-stream',
					last_modified : '2013-12-14T00:05:20.908090'
				},
				{
					name : 'obj5',
					hash : 'randomhash',
					bytes : 1000,
					content_type : 'application\/octet-stream',
					last_modified : '2013-12-14T00:05:20.908090'
				}
			]
		},
		{
			name : 'multiplemultiple0',
			count : 0,
			bytes : 2000
		}
	],
	aCDNContainers : [
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
	]
};

var superNock = new CloudFilesMock(rackitOptions, containers.aContainers, containers.aCDNContainers);

describe('Rackit', function () {

	describe('Constructor', function () {

		it('should have default options', function () {
			var rackit = new Rackit();
			rackit.should.be.an['instanceof'](Rackit);
			rackit.options.prefix.should.equal('dev');
			rackit.options.useCDN.should.equal(true);
			rackit.options.region.should.equal('');
			rackit.options.authRegion.should.equal('US');
			rackit.options.authURIs['US'].should.equal('https://identity.api.rackspacecloud.com/v2.0');
			rackit.options.authURIs['UK'].should.equal('https://lon.identity.api.rackspacecloud.com/v2.0');
		});

		it('should allow overriding of default options', function () {
			var rackit = new Rackit({
				pre : 'dep',
				useCDN : false,
				region : 'LON'
			});
			rackit.options.pre.should.equal('dep');
			rackit.options.useCDN.should.equal(false);
			rackit.options.region.should.equal('LON');
			// Check non-overridden options are still there
			rackit.options.authRegion.should.equal('US');
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
			var username = rackitOptions.user + 'blahblah';
			var apiKey = rackitOptions.key + 'bloopidy';

			superNock.auth(username, apiKey);

			var rackit = new Rackit({
				user : username,
				key : apiKey,
				tempURLKey : rackitOptions.tempURLKey
			});
			rackit.init(function (err) {
				should.exist(err);
				err.should.be.an['instanceof'](Error);
				superNock.allDone();
				cb();
			});
		});

		it('should not return an error with good credentials', function (cb) {
			superNock.typicalResponse();

			var rackit = new Rackit(rackitOptions);
			rackit.init(function (err) {
				should.not.exist(err);
				superNock.allDone();
				cb();
			});
		});

		it('should set temp url key if provided', function (cb) {
			superNock.typicalResponse();

			var rackit = new Rackit(rackitOptions);
			rackit.init(function (err) {
				should.not.exist(err);
				superNock.allDone();
				cb();
			});
		});

		it('should get container info and cache it', function (cb) {
			superNock.typicalResponse();

			var rackit = new Rackit(rackitOptions);
			rackit.init(function (err) {
				var i;

				should.not.exist(err);

				// Check the storage container cache
				rackit.aContainers.should.have.length(superNock.aContainers.length);
				for ( i = 0; i < superNock.aContainers.length; i++ ) {
					rackit.aContainers[i].should.have.property('name', superNock.aContainers[i].name);
					rackit.aContainers[i].should.have.property('count', superNock.aContainers[i].count);
					rackit.aContainers[i].should.have.property('bytes', superNock.aContainers[i].bytes);
				}

				// Check the CDN container cache
				rackit.aCDNContainers.should.have.length(superNock.aCDNContainers.length);
				for ( i = 0; i < superNock.aCDNContainers.length; i++ ) {
					rackit.aCDNContainers[i].should.have.property('name', superNock.aCDNContainers[i].name);
					rackit.aCDNContainers[i].should.have.property('cdnUri', superNock.aCDNContainers[i].cdn_uri);
					rackit.aCDNContainers[i].should.have.property('cdnSslUri', superNock.aCDNContainers[i].cdn_ssl_uri);
				}

				superNock.allDone();
				cb();
			});
		});

	});

	describe('improper initialization', function () {
		it('should throw an error if attempting to call certain methods before init()', function () {
			var rackit = new Rackit(rackitOptions);
			(function () {
				rackit.add(testFile.path);
			}).should.throw(/^Attempting to use/);
		});
	});

	describe('#_getPrefixedContainers', function () {
		var rackit;

		// Start off with a new, initialized rackit
		before(function (cb) {
			superNock.typicalResponse();
			rackit = new Rackit(rackitOptions);
			rackit.init(function (err) {
				superNock.allDone();
				cb(err);
			});
		});

		it('should return an empty array if no prefixed containers have been made', function () {
			// Hack some data into Rackit
			rackit.options.prefix = 'nonexistent';
			rackit.aContainers = [
				{
					name : 'existent'
				}
			];

			rackit._getPrefixedContainers().should.have.length(0);
		});

		it('should return a sorted array of prefixed containers', function () {
			// Hack some data into Rackit
			rackit.options.prefix = 'existent';
			var containers = [
				{
					name : 'blah0'
				},
				{
					name : 'existent2'
				},
				{
					name : 'existent3'
				},
				{
					name : 'existent0'
				}
			];

			var aContainers = rackit._getPrefixedContainers(containers);
			aContainers.should.have.length(3);
			aContainers[0].should.eql(containers[3]);
			aContainers[1].should.eql(containers[1]);
			aContainers[2].should.eql(containers[2]);
		});

		it('should not include containers with a matching sub-prefix', function () {
			// Hack some data into Rackit
			rackit.options.prefix = 'existent';
			var containers = [
				{
					name : 'blah0'
				},
				{
					name : 'existent2'
				},
				{
					name : 'existent3'
				},
				{
					name : 'existent0'
				},
				{
					name : 'existenter0'
				}
			];

			var aContainers = rackit._getPrefixedContainers(containers);
			aContainers.should.have.length(3);
			aContainers[0].should.eql(containers[3]);
			aContainers[1].should.eql(containers[1]);
			aContainers[2].should.eql(containers[2]);
		});
	});

	describe('#add', function () {
		var rackit;

		// This function does some setup and checks for tests which are not intended to test automatic container creation.
		// It sets the container prefix for the Rackit instance, and asserts that the container is not full.
		// The return value is the current size of the container.
		function getFreeContainerCount(container) {
			// Get the prefix
			rackit.options.prefix = container.replace(/\d+$/, '');

			// Assert that the container exists, and is not to capacity
			var _container = _.find(rackit.aContainers, { name : container });
			_container.count.should.be.below(50000);
			return _container.count;
		}

		// Asserts that a successful file upload occured.
		function assertAdd(sContainer, count, cb) {
			return function (err, cloudpath) {
				if ( err ) {
					console.log(err);
				}

				superNock.allDone();
				should.not.exist(err);
				should.exist(cloudpath);

				// Assert the container exists
				var container = _.find(rackit.aContainers, { name : sContainer });
				should.exist(container);

				// Assert the file was added to the expected container
				cloudpath.split('/')[0].should.equal(sContainer);

				// Assert the containers file count is as expected
				container.count.should.equal(count);

				// Execute the callback for additonal asserts
				cb && cb();
			}
		}

		// Start off each test with a new, initialized rackit
		beforeEach(function (cb) {
			superNock.typicalResponse();
			rackit = new Rackit(rackitOptions);
			rackit.options.prefix = 'empty';
			rackit.init(function (err) {
				superNock.allDone();
				cb(err);
			});
		});

		describe('local file upload (string param)', function () {

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
				rackit.add(testFile.path, { type : type }, assertAdd(container, count + 1, cb));
			});

		});

		describe('streaming upload (ReadableStream param)', function () {

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

			it('should return an error if no type is specified (and no content-type header)', function (cb) {
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
				rackit.add(stream, {type : testFile.type}, assertAdd(container, count + 1, cb));
			});

			it('should successfuly upload a ServerRequest stream with forwarded type', function (cb) {
				var container = 'empty0';
				var count = getFreeContainerCount(container);

				superNock.add(container, testFile.data, testFile.type, true);

				// Set up the small server that will forward the request to Rackit
				var server = http.createServer(function (req, res) {
					rackit.add(req, assertAdd(container, count + 1, cb));
					server.close();
				}).listen(7357);

				// Create the request to the small server above
				var req = request.put({
					uri : 'http://localhost:7357',
					headers : {
						'content-type' : 'text/plain'
					}
				});

				fs.createReadStream(testFile.path).pipe(req);
			});

			it('should successfuly upload a ServerRequest stream with forwarded length', function (cb) {
				var container = 'empty0';
				var count = getFreeContainerCount(container);

				superNock.add(container, testFile.data, testFile.type, false);

				// Set up the small server that will forward the request to Rackit
				var server = http.createServer(function (req, res) {
					rackit.add(req, assertAdd(container, count + 1, cb));
					server.close();
				}).listen(7357);

				// Create the request to the small server above
				var req = request.put({
					uri : 'http://localhost:7357',
					headers : {
						'content-type' : 'text/plain',
						'content-length' : '' + Buffer.byteLength(testFile.data)
					}
				});

				fs.createReadStream(testFile.path).pipe(req);
			});

			it('should not forward the etag header of a ServerRequest stream', function (cb) {
				var container = 'empty0';
				var count = getFreeContainerCount(container);

				superNock.add(container, testFile.data, testFile.type, true);

				// Set up the small server that will forward the request to Rackit
				var server = http.createServer(function (req, res) {
					rackit.add(req, assertAdd(container, count + 1, cb));
					server.close();
				}).listen(7357);

				// Create the request to the small server above
				var req = request.put({
					uri : 'http://localhost:7357',
					headers : {
						'content-type' : 'text/plain',
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
				var server = http.createServer(function (req, res) {
					rackit.add(req, {type : type}, assertAdd(container, count + 1, cb));
					server.close();
				}).listen(7357);

				// Create the request to the small server above
				var req = request.put({
					uri : 'http://localhost:7357',
					headers : {
						'content-type' : 'text/plain'
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
				should.not.exist(_.find(rackit.aContainers, { name : container }));

				// Add on the mock for the add request
				superNock
					.createContainer(container)
					.add(container, testFile.data, testFile.type);

				rackit.add(testFile.path, assertAdd(container, 1, function () {
					// Assert the container is not CDN enabled
					var _container = _.find(rackit.aCDNContainers, { name : container });
					should.not.exist(_container);
					cb();
				}));
			});

			it('should create a prefixed, non-CDN container when existing are full', function (cb) {
				var prefix = 'full';
				var container = prefix + '1';

				rackit.options.prefix = prefix;
				rackit.options.useCDN = false;

				// Assert that the container does not exist
				should.not.exist(_.find(rackit.aContainers, { name : container }));

				// Add on the mock for the add request
				superNock
					.createContainer(container)
					.add(container, testFile.data, testFile.type);

				rackit.add(testFile.path, assertAdd(container, 1, function () {
					// Assert the container is not CDN enabled
					var _container = _.find(rackit.aCDNContainers, { name : container });
					should.not.exist(_container);
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
				should.not.exist(_.find(rackit.aContainers, { name : container }));

				// Add on the mock for the add request
				superNock
					.createContainer(container)
					.enableCDN(container)
					.add(container, testFile.data, testFile.type);

				rackit.add(testFile.path, assertAdd(container, 1, function () {
					// Assert the container is CDN enabled
					var _container = _.find(rackit.aCDNContainers, { name : container });
					should.exist(_container);
					cb();
				}));
			});

			it('should create a prefixed, CDN container when existing are full', function (cb) {
				var prefix = 'full';
				var container = prefix + '1';

				rackit.options.prefix = prefix;
				rackit.options.useCDN = true;

				// Assert that the container does not exist
				should.not.exist(_.find(rackit.aContainers, { name : container }));

				// Add on the mock for the add request
				superNock
					.createContainer(container)
					.enableCDN(container)
					.add(container, testFile.data, testFile.type);

				rackit.add(testFile.path, assertAdd(container, 1, function () {
					// Assert the container is CDN enabled
					var _container = _.find(rackit.aCDNContainers, { name : container });
					should.exist(_container);
					cb();
				}));
			});
		});

		describe('automatic container creation - concurrent operations', function () {

			it('parallel operations should produce one new container when none exist', function (cb) {
				var prefix = 'new';
				var container = prefix + '0';

				rackit.options.prefix = prefix;
				rackit.options.useCDN = false;

				// Assert that the container does not exist
				should.not.exist(_.find(rackit.aContainers, { name : container }));

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
					var _container = _.find(rackit.aContainers, { name : container });
					should.exist(_container);

					// Assert the container count
					_container.count.should.equal(2);

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
				should.not.exist(_.find(rackit.aContainers, { name : container }));

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
					var _container = _.find(rackit.aContainers, { name : container });
					should.exist(_container);

					// Assert the container count
					_container.count.should.equal(2);

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
			rackit = new Rackit(rackitOptions);
			rackit.init(function (err) {
				superNock.allDone();
				cb(err);
			});
		});

		it('should return a readable stream', function (cb) {
			var cloudpath = 'container/file';
			superNock.get(cloudpath, testFile.data);

			// Get the file
			var stream = rackit.get(cloudpath);

			var data = '';
			stream.on('data', function (chunk) {
				data += chunk;
			});

			stream.on('end', function () {
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
			rackit.get(cloudpath, filepath, function (err) {
				should.not.exist(err);
				// Test the data
				fs.readFile(filepath, 'utf8', function (err, data) {
					should.not.exist(err);
					data.should.equal(testFile.data);
					fs.unlink(filepath, cb);
				});
			});
		});
	});

	describe('#remove', function () {
		var rackit;

		beforeEach(function (cb) {
			superNock.typicalResponse();
			rackit = new Rackit(rackitOptions);
			rackit.init(function (err) {
				superNock.allDone();
				cb(err);
			});
		});

		it('should send a "delete" request to Cloud Files', function (cb) {
			var cloudpath = 'multiple0/obj2';
			superNock.remove(cloudpath, 204);

			// Get the file
			rackit.remove(cloudpath, function (err) {
				superNock.allDone();
				should.not.exist(err);
				cb();
			});
		});

		it('should decrement the internal container count by 1', function (cb) {
			var cloudpath = 'multiple0/obj2';
			superNock.remove(cloudpath, 204);

			// Get the file
			rackit.remove(cloudpath, function (err) {
				superNock.allDone();
				should.not.exist(err);

				var _container = _.find(rackit.aContainers, { name : 'multiple0' });
				_container.count.should.equal(2);
				cb();
			});
		});

		it('should return an error if file does not exist', function (cb) {
			var cloudpath = 'multiple0/objFake';
			superNock.remove(cloudpath, 404);

			// Get the file
			rackit.remove(cloudpath, function (err) {
				superNock.allDone();
				should.exist(err);
				err.should.be.an.instanceOf(Error);
				cb();
			});
		});

		it('should not decrement the internal container count if file does not exist', function (cb) {
			var cloudpath = 'multiple0/objFake';
			superNock.remove(cloudpath, 404);

			// Get the file
			rackit.remove(cloudpath, function (err) {
				superNock.allDone();

				var _container = _.find(rackit.aContainers, { name : 'multiple0' });
				_container.count.should.equal(3);
				cb();
			});
		});
	});

	describe('#getCloudpath', function () {
		var rackit;

		before(function (cb) {
			superNock.typicalResponse();
			rackit = new Rackit(rackitOptions);
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
			rackit = new Rackit(rackitOptions);
			rackit.init(function (err) {
				superNock.allDone();
				cb(err);
			});
		});


		// Gets all of the object cloudpaths belonging to the given containers. This function gets the objects
		// from the mock (the "actual" data store) for validation of what Rackit gives
		function getObjects(containers) {
			var i, j, container, object, objects = [];

			// Find the actual container objects to validate
			for ( i = 0; i < containers.length; i++ ) {
				container = containers[i];

				// If the container doesn't have any objects, skip it
				if ( !container.objects || !container.objects.length )
					continue;

				// Iterate each object in this container, adding the container to the object name
				for ( j = 0; j < container.objects.length; j++ ) {
					object = container.objects[j];
					objects.push({
						cloudpath : container.name + '/' + object.name,
						name : object.name,
						etag : object.hash,
						bytes : object.bytes,
						contentType : object.content_type,
						lastModified : new Date(object.last_modified)
					});
				}
			}
			return objects;
		}

		function getObjectCloudpaths(objects) {
			var i = objects.length;
			while ( i-- )
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
			rackit.list(function (err, list) {
				superNock.allDone();
				should.not.exist(err);
				should.exist(list);

				// Check the result length
				list.should.have.length(objects.length);

				// Check the result contents
				for ( var i = 0; i < objects.length; i++ ) {
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
			rackit.list({ extended : true }, function (err, list) {
				superNock.allDone();
				should.not.exist(err);
				should.exist(list);

				// Check the result length
				list.should.have.length(objects.length);

				// Check the result contents
				for ( var i = 0; i < objects.length; i++ ) {
					for ( var p in objects[i] ) {
						list[i].should.have.property(p);
						list[i][p].should.eql(objects[i][p]);
					}
				}

				cb();
			});
		});
	});

});
