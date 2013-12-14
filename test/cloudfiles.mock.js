/*global require, describe, it, before, beforeEach, after*/ // global functions
/*global Error, Buffer*/ // global classes
/*global module*/ // global objects
/*global __dirname*/ // global vars

var
// Node modules
	url = require('url'),

// Npm modules
	nock = require('nock');


var authResponse = require('./auth-response.json');
var Rackit = require('../lib/main.js').Rackit;

var mockOptions = {
	storage : 'https://storage101.dfw1.clouddrive.com/v1/MossoCloudFS_aaaaaaaa-bbbb-cccc-dddd-eeeeeeee',
	cdn : 'https://cdn1.clouddrive.com/v1/MossoCloudFS_aaaaaaaa-bbbb-cccc-dddd-eeeeeeee',
	token : authResponse.access.token.id
};

var Mock = module.exports = function (rackitOptions, aContainers, aCDNContainers) {
	this.rackitOptions = Object.create(Rackit.defaultOptions);

	// Override the default options
	for ( var prop in rackitOptions ) {
		if ( rackitOptions.hasOwnProperty(prop) ) {
			this.rackitOptions[prop] = rackitOptions[prop];
		}
	}

	this.aContainers = aContainers;
	this.aCDNContainers = aCDNContainers;
	this.scopes = [];
};

Mock.prototype = {
	typicalResponse : function () {
		this.auth(this.rackitOptions.user, this.rackitOptions.key).storage().CDN();
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
			scope = scope.reply(200, authResponse);
		}

		this.scopes.push(scope);
		return this;
	},
	tempURL : function (key) {
		var path = url.parse(mockOptions.storage).pathname;
		var scope = nock(mockOptions.storage)
			.post(path)
			.matchHeader('X-Account-Meta-Temp-Url-Key', key)
			.reply(204, 'No Content');

		this.scopes.push(scope);
		return this;
	},
	storage : function () {
		var path = url.parse(mockOptions.storage).pathname + '?format=json';
		var scope = nock(mockOptions.storage)
			.get(path)
			.matchHeader('X-Auth-Token', mockOptions.token)
			.reply(200, JSON.stringify(this.aContainers));

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
			.filteringPath(new RegExp(container + '/.*', 'g'), container + '/filename');

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
			.matchHeader('X-Auth-Token', mockOptions.token)
			.matchHeader('Content-Type', type)
			.matchHeader('ETag', undefined);

		if ( chunked ) {
			scope.matchHeader('Transfer-Encoding', 'chunked');
		} else {
			// If data was specified and non-chunked encoding, ensure the content-length is correct
			var lengthMatch = typeof data === 'undefined' ? /.*/ : '' + Buffer.byteLength(data);
			scope.matchHeader('Content-Length', lengthMatch);
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
	list : function (prefix, limit) {
		var containers = this.getPrefixedContainers(prefix);
		var i = containers.length;
		var container, basepath, path, count, j, objects;
		var scope = nock(mockOptions.storage);

		// There may be more than one container with this prefix, and the client will be requesting from all
		while ( i-- ) {
			container = containers[i];

			// Skip containers that don't have the given prefix
			if ( container.name.indexOf(prefix) !== 0 )
				continue;

			basepath = url.parse(mockOptions.storage).pathname + '/' + container.name;
			basepath += '?format=json&limit=' + limit;

			// If the container has no objects, respond with 204.
			if ( !container.objects || container.objects.length === 0 ) {
				scope.get(basepath).reply(204);
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
