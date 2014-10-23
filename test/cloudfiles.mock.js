/*global require, describe, it, before, beforeEach, after*/ // global functions
/*global Error, Buffer*/ // global classes
/*global module*/ // global objects
/*global __dirname*/ // global vars

var
// Node modules
	_ = require('lodash'),
	url = require('url'),

// Npm modules
	nock = require('nock');


var authResponse = require('./auth-response.json');
var Rackit = require('../lib/main.js').Rackit;

var Mock = module.exports = function (rackitOptions, aContainers, aCDNContainers) {
	this.rackitOptions = Object.create(Rackit.defaultOptions);

	// Override the default options
	for ( var prop in rackitOptions ) {
		if ( rackitOptions.hasOwnProperty(prop) ) {
			this.rackitOptions[prop] = rackitOptions[prop];
		}
	}

	this.mockOptions = {
		storage : 'https://' + (rackitOptions.useSNET ? 'snet-' : '') + 'storage101.dfw1.clouddrive.com/v1/MossoCloudFS_aaaaaaaa-bbbb-cccc-dddd-eeeeeeee',
		cdn : 'https://cdn1.clouddrive.com/v1/MossoCloudFS_aaaaaaaa-bbbb-cccc-dddd-eeeeeeee',
		token : authResponse.access.token.id
	};

	this.aContainers = aContainers;
	this.aCDNContainers = aCDNContainers;
	this.scopes = [];
};

Mock.prototype = {
	typicalResponse : function () {
		this.auth(this.rackitOptions.user, this.rackitOptions.key);
		if ( this.rackitOptions.tempURLKey )
			this.tempURL(this.rackitOptions.tempURLKey);

		return this;
	},
	auth : function (username, apiKey) {
		// Setup nock to respond to a good auth request, twice
		var authURI = this.rackitOptions.authURIs[this.rackitOptions.authRegion];
		var path = url.parse(authURI).pathname + '/tokens';

		var scope = nock(authURI)
			.post(path, {
				"auth" : {
					"RAX-KSKEY:apiKeyCredentials" : {
						"username" : username,
						"apiKey" : apiKey
					}
				}
			});

		if (username != this.rackitOptions.user || apiKey != this.rackitOptions.key) {
			scope = scope.reply(401);
		} else {
			// set the "expires" property of authResponse
			var expires = new Date();
			expires.setHours(expires.getHours()+1);
			authResponse.access.token.expires = expires.toISOString();
			scope = scope.reply(200, authResponse);
		}

		this.scopes.push(scope);
		return this;
	},
	tempURL : function (key) {
		var path = url.parse(this.mockOptions.storage).pathname;
		var scope = nock(this.mockOptions.storage)
			.post(path)
			.matchHeader('X-Account-Meta-Temp-Url-Key', key)
			.reply(204, 'No Content');

		this.scopes.push(scope);
		return this;
	},
	containerHead : function (containers) {
		var i;
		for ( i = 0; i < containers.length; i++ ) {
			this.storageHead(containers[i]);
			// if the regular container exists, pkgcloud will then request CDN info
			if ( _.find(this.aContainers, { name : containers[i] }) )
				this.CDNHead(containers[i]);
		}

		return this;
	},
	storage : function () {
		var path = url.parse(this.mockOptions.storage).pathname + '?format=json';
		var scope = nock(this.mockOptions.storage)
			.get(path)
			.matchHeader('X-Auth-Token', this.mockOptions.token)
			.reply(200, JSON.stringify(this.aContainers));

		this.scopes.push(scope);
		return this;
	},
	storageHead : function (container) {
		var _container = _.find(this.aContainers, { name : container });
		var path = url.parse(this.mockOptions.storage).pathname + '/' + container;
		var scope = nock(this.mockOptions.storage)
			.head(path)
			.matchHeader('X-Auth-Token', this.mockOptions.token);

		if ( _container ) {
			scope = scope.reply(204, '', {
				'X-Container-Object-Count' : _container.count,
				'X-Container-Bytes-Used' : _container.bytes
			});
		} else {
			scope = scope.reply(404);
		}

		this.scopes.push(scope);
		return this;
	},
	// Gets an array of containers matching a prefix
	getPrefixedContainers : function (prefix) {
		var container, containers = [];
		var i = this.aContainers.length;
		var reg = new RegExp('^' + prefix + '\\d+$');

		while ( i-- ) {
			container = this.aContainers[i];

			// If the container doesn't have the prefix, skip it
			if ( !container.name.match(reg) )
				continue;

			containers.push(container);
		}

		return containers;
	},
	CDN : function () {
		var path = url.parse(this.mockOptions.cdn).pathname + '?format=json';
		var scope = nock(this.mockOptions.cdn)
			.get(path)
			.matchHeader('X-Auth-Token', this.mockOptions.token)
			.reply(200, JSON.stringify(this.aCDNContainers));

		this.scopes.push(scope);
		return this;
	},
	CDNHead : function (container) {
		var _container = _.find(this.aCDNContainers, { name : container });
		var path = url.parse(this.mockOptions.cdn).pathname + '/' + container;
		var scope = nock(this.mockOptions.cdn)
			.head(path)
			.matchHeader('X-Auth-Token', this.mockOptions.token);

		if ( _container ) {
			scope = scope.reply(204, '', {
				'X-Cdn-Enabled' : _container.cdn_enabled ? 'True' : 'False',
				'X-Ttl' : _container.ttl,
				'X-Log-Retention' : _container.log_retention,
				'X-Cdn-Uri' : _container.cdn_uri,
				'X-Cdn-Ssl-Uri' : _container.cdn_ssl_uri,
				'X-Cdn-Streaming-Uri' : _container.cdn_streaming_uri
			});
		} else {
			scope = scope.reply(404);
		}

		this.scopes.push(scope);
		return this;
	},
	addAndRemove : function (container, data, type, length) {
		var that = this;
		this.add(container, data, type, length, function(path) {
			var r = new RegExp(container + '/.*', 'g');
			var result = path.match(r)[0];
			that.remove(result);
		});
		return this;
	},
	putAndHead : function (container, data, type, length) {
		var that = this;
		this.add(container, data, type, length, function(path) {
			var r = new RegExp(container + '/.*', 'g');
			var result = path.match(r)[0];
			that.head(result);
		});
		return this;
	},
	add : function (container, data, type, length, cb) {
		var path = url.parse(this.mockOptions.storage).pathname + '/' + container + '/filename';
		var lastPath;
		var scope = nock(this.mockOptions.storage)
			.filteringPath(function(path) {
				lastPath = path;
				var r = new RegExp(container + '/.*', 'g');
				return path.replace(r, container + '/filename');
			});

		// If data was specified, match it exactly
		if ( typeof data !== 'undefined' ) {
			scope = scope.put(path, data);
		} else {
			// Data wasn't specified, so match anything
			scope = scope
				.filteringRequestBody(function () {
					return '*';
				})
				.put(path, '*');
		}

		scope = scope
			.matchHeader('X-Auth-Token', this.mockOptions.token)
			.matchHeader('Content-Type', type)
			.matchHeader('ETag', undefined);

		if ( !length ) {
			scope.matchHeader('Transfer-Encoding', 'chunked');
		} else {
			// If data was specified and non-chunked encoding, ensure the content-length is correct
			scope.matchHeader('Content-Length', length);
		}

		scope = scope.reply(201, function(uri, requestBody) {
			cb && cb(lastPath);
		});

		this.scopes.push(scope);
		return this;
	},
	head : function (cloudpath, response, headers) {
		var path = url.parse(this.mockOptions.storage).pathname + '/' + cloudpath + '?format=json';
		var scope = nock(this.mockOptions.storage)
			.head(path)
			.reply(response, '', headers);
		this.scopes.push(scope);
		return this;
	},
	post : function (cloudpath, response, headers) {
		var path = url.parse(this.mockOptions.storage).pathname + '/' + cloudpath;
		var scope = nock(this.mockOptions.storage)
			.post(path);

		for (var key in headers) {
			scope = scope.matchHeader(key, headers[key]);
		}

		scope = scope.reply(response);
		this.scopes.push(scope);
		return this;
	},
	get : function (cloudpath, data) {
		var path = url.parse(this.mockOptions.storage).pathname + '/' + cloudpath;
		var scope = nock(this.mockOptions.storage)
			.get(path)
			.reply(200, data);
		this.scopes.push(scope);
		return this;
	},
	remove : function (cloudpath, response) {
		var path = url.parse(this.mockOptions.storage).pathname + '/' + (cloudpath || 'cloudpath');
		var scope = nock(this.mockOptions.storage);

		if (!cloudpath)
			scope = scope.filteringPath(function(path) {
				path = path.replace(/\/\w*\/\w*$/g, '/cloudpath');
				return path;
			});

		scope = scope.delete(path).reply(response);
		this.scopes.push(scope);
		return this;
	},
	createContainer : function (container) {
		var path = url.parse(this.mockOptions.storage).pathname + '/' + container;
		var scope = nock(this.mockOptions.storage)
			.put(path)
			.matchHeader('X-Auth-Token', this.mockOptions.token)
			.reply(201);

		this.scopes.push(scope);
		return this;
	},
	enableCDN : function (container) {
		var path = url.parse(this.mockOptions.cdn).pathname + '/' + container;
		var scope = nock(this.mockOptions.cdn)
			.put(path)
			.matchHeader('X-Auth-Token', this.mockOptions.token)
			.reply(201);

		this.scopes.push(scope);

		// pkgcloud refreshes container info after CDN enabling
		path = url.parse(this.mockOptions.storage).pathname + '/' + container;
		scope = nock(this.mockOptions.storage)
			.head(path)
			.matchHeader('X-Auth-Token', this.mockOptions.token)
			.reply(204, '', {
				'X-Container-Bytes-Used' : 0,
				'X-Container-Object-Count' : 0
			});

		this.scopes.push(scope);

		// pkgcloud refreshes cdn container info after CDN enabling
		path = url.parse(this.mockOptions.cdn).pathname + '/' + container;
		scope = nock(this.mockOptions.cdn)
			.head(path)
			.matchHeader('X-Auth-Token', this.mockOptions.token)
			.reply(204, '', {
				'X-Cdn-Enabled' : 'True',
				'X-Log-Retention' : 'False'
			});

		this.scopes.push(scope);

		return this;
	},
	list : function (prefix, limit) {
		var containers = this.getPrefixedContainers(prefix);
		var i = containers.length;
		var container, basepath, path, count, j, objects;
		var scope = nock(this.mockOptions.storage);

		// There may be more than one container with this prefix, and the client will be requesting from all
		while ( i-- ) {
			container = containers[i];

			// Skip containers that don't have the given prefix
			if ( container.name.indexOf(prefix) !== 0 )
				continue;

			basepath = url.parse(this.mockOptions.storage).pathname + '/' + container.name;
			basepath += '?format=json&limit=' + limit;

			// If the container has no objects, respond with 204.
			if ( !container.objects || container.objects.length === 0 ) {
				scope.get(basepath).reply(200, []);
				continue;
			}

			// The client may have to make multiple requests to this container depending on the limit
			for ( count = 0; count <= container.objects.length; count += limit ) {
				path = basepath;

				// If count > 0, the client will be requesting with a marker item from last response
				if ( count > 0 ) {
					path = basepath + '&marker=' + container.objects[count - 1].name
				}

				// Generate an array of object data to reply with
				objects = [];
				for ( j = count; j < count + limit && j < container.objects.length; j++ ) {
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
