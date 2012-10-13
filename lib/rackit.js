/*global require, process, console*/
var url = require('url');
var http = require('http');
var request = require('request');
var mime = require('mime');
var async = require('async');

var crypto = require('crypto');
var fs = require('fs');

var utils = require('./utils');

var Rackit = function (options) {
	this.options = Object.create(Rackit.defaultOptions);

	// Override the default options
	for (var prop in options) {
		if (options.hasOwnProperty(prop)) {
			this.options[prop] = options[prop];
		}
	}

	this.config = null;
	this.aContainers = null;
	this.hContainers = null;
	this.aCDNContainers = null;
	this.hCDNContainers = null;
};

Rackit.defaultOptions = {
	user : '',
	key : '',
	prefix : 'dev',
	region : 'US',
	baseURIs : {
		'UK': 'https://lon.auth.api.rackspacecloud.com/v1.0',
		'US': 'https://auth.api.rackspacecloud.com/v1.0'
	},
	tempURLKey : null,
	useSNET : false,
	useCDN : true,
	useSSL : true,
	verbose : false,
	logger : console.log
};

/**
 * Initializes the cloud connection and gets the local cache of containers
 */
Rackit.prototype.init = function (cb) {
	var o1 = this;

	if (!o1.options.user || !o1.options.key) {
		return cb(new Error('No credentials'));
	}

	async.series({
		// First authenticate with Cloud Files
		auth : function (cb) {
			o1._authenticate(cb);
		},
		two : function (cb) {
			async.parallel({
				// Generate the cache of container objects
				one : function (cb) {
					o1._getContainers(cb);
				},
				// Set Account Metadata Key for public access
				two : function (cb) {
					if (o1.options.tempURLKey) {
						o1._log('Setting temporary URL key for account...');
						o1._setTempURLKey(cb);
					} else {
						cb();
					}
				}
			}, cb);
		}
	}, cb);
};

Rackit.prototype._log = function () {
	arguments[0] = 'rackit: ' + arguments[0];
	if (this.options.verbose) {
		this.options.logger.apply(null, arguments);
	}
};

Rackit.prototype.hGoodStatuses = {
	200 : 'Ok',
	201 : 'Created',
	202 : 'Accepted',
	204 : 'No Content'
};

Rackit.prototype.hBadStatuses = {
	401 : 'Unauthorized',
	404 : 'Not Found',
	412 : 'Length Required',
	422 : 'Unprocessable Entity'
};

/**
 * Authenticates the user with Rackspace CloudFiles and stores the auth token.
 * Called once upon creation and periodically as token expires.
 * @param {function(Object)} cb - callback that returns an error
 */
Rackit.prototype._authenticate = function (cb) {
	var o1 = this;

	o1._log('authenticating...');

	// Build the request options
	var options = {
		headers : {
			'X-Auth-User' : o1.options.user,
			'X-Auth-Key' : o1.options.key
		}
	};

	if(o1.options.baseURI) {
		options.uri = o1.options.baseURI;
	} else {
		options.uri = o1.options.baseURIs[o1.options.region];
	}

	request(options, function (err, res, body) {
		o1.config = null;

		if (err) {
			return cb(err);
		}

		if (!o1.hGoodStatuses.hasOwnProperty(res.statusCode)) {
			return cb(new Error('Error code ' + res.statusCode));
		}

		o1._log('authenticated');

		// Store the config info
		o1.config = {
			storage : res.headers['x-storage-url'],
			CDN : res.headers['x-cdn-management-url'],
			authToken : res.headers['x-auth-token']
		};

		// Change URLs to s-net urls if it is enabled
		if (o1.options.useSNET) {
			o1._log('using s-net!');
			o1.config.storage = o1.config.storage.replace('https://', 'https://snet-');
		} else {
			o1._log('not using s-net!');
		}

		cb();
	});
};

/**
 * Sends a request message to the cloud server. Checks for errors, and bad
 * status codes indicating failure.
 * @param {Object} options - options for request()
 * @param {function(err, res, body)} cbResult - callback when the non-authentication request goes through
 * @param {function(err, res, body)} cbRequest - callback when a request has been created.. may be called 1 or 2 times if auth fails the first time
 */
Rackit.prototype._cloudRequest = function (options, cbResult, cbRequest) {
	var o1 = this;

	options.headers = options.headers || {};
	options.headers['X-Auth-Token'] = o1.config.authToken;

	// Create the request object
	var req1 = request(options, function (err, res, body) {
		if (err) {
			return cbResult(err);
		}

		// Unauthorized
		if (res.statusCode === 401) {
			// Attempt to re-authorize
			o1._authenticate(function (err) {
				if (err) {
					return cbResult(err);
				}

				// Reauthorized, so run request again
				o1._cloudRequest(options, cbResult, cbRequest);
			});
			return;
		}

		// Problem
		if (!o1.hGoodStatuses.hasOwnProperty(res.statusCode)) {
			o1._log('request failed');
			return cbResult(new Error('Error code ' + res.statusCode));
		}

		// Everything went fine
		if (cbResult) {
			cbResult(null, res, body);
		}
	});
	// Return the requets object to the callback so that data may be piped
	if (cbRequest) {
		cbRequest(req1);
	}
};

/**
 * Set's the account metadata key used for generating temporary URLs
 */
Rackit.prototype._setTempURLKey = function (cb) {
	var o1 = this;

	// Build request options
	var options = {
		method : 'POST',
		uri : o1.config.storage,
		headers : {
			'X-Account-Meta-Temp-Url-Key' : o1.options.tempURLKey
		}
	};

	o1._cloudRequest(options, function (err, res, body) {
		cb(err);
	});
};

/**
 * Gets info about containers, including CDN containers
 * @param {function(err)} cb
 */
Rackit.prototype._getContainers = function (cb) {
	var o1 = this;
	o1._log('getting containers...');

	async.parallel({
		// Get regular container info
		one : function (cb) {
			// Build request options
			var options = {
				uri : o1.config.storage + '?format=json'
			};

			o1._cloudRequest(options, function (err, res, body) {
				if (err) {
					return cb(err);
				}
				o1.aContainers = JSON.parse(body);

				// Create the global hash of containers from the array
				o1.hContainers = {};

				var container;
				var i = o1.aContainers.length;
				while (i--) {
					container = o1.aContainers[i];
					o1.hContainers[container.name] = container;
				}

				o1._log('got containers', Object.keys(o1.hContainers));
				cb();
			});
		},
		// Get CDN container info
		two : function (cb) {
			// Build request options
			var options = {
				uri : o1.config.CDN + '?format=json'
			};

			o1._cloudRequest(options, function (err, res, body) {
				if (err) {
					return cb(err);
				}

				o1.aCDNContainers = JSON.parse(body);

				// Build a hash from the CDN container array.. this is used for lookups
				o1.hCDNContainers = {};
				var i = o1.aCDNContainers.length;
				var CDNContainer;
				while (i--) {
					CDNContainer = o1.aCDNContainers[i];
					o1.hCDNContainers[CDNContainer['name']] = CDNContainer;
				}

				o1._log('got CDN containers', Object.keys(o1.hCDNContainers));
				cb();
			});
		}
	}, cb);
};

/**
 * Adds a container with a particular name. Can optionally CDN enable the container.
 * @param {string} sName
 * @param {function(err)} cb
 */
Rackit.prototype._createContainer = function (sName, cb) {
	var o1 = this;
	o1._log('adding container \'' + sName + '\'...');

	async.waterfall([
		// Create the container
		function (cb) {
			var options = {
				method : 'PUT',
				uri : o1.config.storage + '/' + sName
			};

			o1._cloudRequest(options, cb);
		},

		// Add the container locally, but first check if it exists first (the Rackspace API is idempotent)
		function (res, body, cb) {
			var container;

			if (!o1.hContainers[sName]) {
				container = {
					name : sName,
					count : 0,
					bytes : 0
				};

				// Add the container to the array
				o1.aContainers.push(container);
				// Add the container to the hash
				o1.hContainers[sName] = container;
			}

			cb();
		},

		// CDN enable the container, if necessary
		function (cb) {
			if (!o1.options.useCDN) {
				cb(null, {}, '');
				return;
			}

			o1._log('CDN enabling the container');

			var options = {
				method : 'PUT',
				uri : o1.config.CDN + '/' + sName
			};

			o1._cloudRequest(options, function (err, res, body) {
				cb(err, res || {}, body || '');
			});
		},

		// Add the CDN container locally, but first check the container wasn't already CDN enabled
		function (res, body, cb) {
			var CDNContainer;
			// Add the container locally
			if (res.statusCode === 201 /* Created */) {
				// The new CDN container object for local storage
				CDNContainer = {
					'cdn_streaming_uri' : res.headers['x-cdn-streaming-uri'],
					'cdn_uri' : res.headers['x-cdn-uri'],
					'cdn_ssl_uri' : res.headers['x-cdn-ssl-uri'],
					'cdn_enabled' : true,
					'ttl' : 259200,
					'log_retention' : false,
					'name' : sName
				};

				// Add CDN container to the array
				o1.aCDNContainers.push(CDNContainer);
				// Add CDN container to the hash
				o1.hCDNContainers[sName] = CDNContainer;
			}
			cb();

		}], cb);

};

/**
 * This function searches for the largest numbered container with the
 * specified prefix. If the container has >= 50,000 files, the next container is
 * created. There may be other containers, which will be ignored.
 * @param {function(Error, string)} cb - callback(Error, sContainer)
 */
Rackit.prototype._getContainer = function (cb) {
	var o1 = this;

	// Search through the containers we have for the highest numbered, prefixed container
	// TODO: Cache the highest numbered container
	var idx = o1.aContainers.length;
	var container;
	var highestContainerNum = -1;
	var containerNum;
	while (idx--) {
		container = o1.aContainers[idx];
		// Check that the container name matches
		if (container.name.lastIndexOf(o1.options.prefix, 0) === 0) {
			// The prefix matches, get the number
			containerNum = container.name.substring(o1.options.prefix.length);
			if (!isNaN(containerNum)) {
				highestContainerNum = Math.max(highestContainerNum, containerNum);
			}
		}
	}

	// Check that we found a prefixed container
	var name;
	if (highestContainerNum < 0) {
		name = o1.options.prefix + '0';
		return o1._createContainer(name, function (err) {
			cb(err, name);
		});
	}

	// We have found a prefixed container.. get it
	name = o1.options.prefix + highestContainerNum;
	container = o1.hContainers[name];

	// Check if the container is full
	if (container.count >= 50000) {
		name = o1.options.prefix + (highestContainerNum + 1);
		return o1._createContainer(name, function (err) {
			cb(err, name);
		});
	}

	// The container we found is fine.. return it.
	cb(null, name);
};

/**
 * Adds a file!
 * @param {string} localPath - The local file to add
 * @param {{type: string, filename: string, meta: Object, headers: Object.<string, string>}} options - Additonal options
 * @param {function(?Error, string=)} cb - Callback, returns error or the cloud path
 */
Rackit.prototype.add = function (localPath, options, cb) {
	var o1 = this;

	// Normalize options
	if (typeof options === 'function') {
		cb = options;
		options = null;
	}

	// Set default options
	options = options || {};
	options.meta = options.meta || {};

	o1._log('adding file', localPath);

	if (!localPath) {
		o1._log('no local file', localPath);
		return cb(new Error('No local file'));
	}

	async.parallel({
			// Get the file stats
			stats : async.apply(fs.stat, localPath),
			// Get the file type (passed in or find)
			type : function (cb) {
				if (options.type) {
					cb(null, options.type);
				} else {
					cb(null, mime.lookup(localPath));
				}
			},
			// Get the file container
			container : function (cb) {
				o1._getContainer(cb);
			}
		},
		// Final function of parallel.. create the request to add the file
		function (err, results) {
			if (err) {
				return cb(err);
			}

			// Generate file id
			var id = options.filename || utils.uid(24);

			var headers = {};
			headers['content-length'] = results.stats.size;
			headers['content-type'] = results.type;

			// Add any additonal headers
			var sKey;
			for (sKey in options.headers) {
				if (options.headers.hasOwnProperty(sKey)) {
					headers[sKey] = options.headers[sKey];
				}
			}

			// Add any metadata headers
			for (sKey in options.meta) {
				if (options.meta.hasOwnProperty(sKey)) {
					headers['x-object-meta-' + sKey] = options.meta[sKey];
				}
			}

			var cloudPath = results.container + '/' + id;
			var reqOptions = {
				method : 'PUT',
				uri : o1.config.storage + '/' + cloudPath,
				headers : headers
			};

			// Make the actual request
			o1._cloudRequest(reqOptions, function (err, res, body) {
				// Done with request..
				o1._log('done adding file to cloud');

				// Increment the container count
				if (!err) {
					o1.hContainers[results.container].count++;
				}

				cb(err, cloudPath);
			}, function (request) {
				// Open a file stream, and pipe it to the request.
				fs.createReadStream(localPath).pipe(request);
			});
		});
};

/**
 * Lists items (up to the first 10,000)
 * TODO: Make more useful
 * @param {function(Array)} cb(aObjects)
 */
Rackit.prototype.list = function (cb) {
	// Get from the 0 container
	var o1 = this;

	var sContainer = o1.options.prefix + '0';
	var options = {
		uri : o1.config.storage + '/' + sContainer + '?format=json'
	};

	o1._cloudRequest(options, function (err, res, body) {
		if (err) {
			return cb(err);
		}
		var aObjects = JSON.parse(body);
		var aObject;
		var i;
		for (i = 0; i < aObjects.length; i++) {
			aObject = aObjects[i];
			aObject.name = sContainer + '/' + aObject.name;
		}
		cb(null, aObjects);
	});
};

/**
 * Downloads a cloud file to a local file
 * @param {string} sCloudPath - The relative path to the cloud file <container>/<file>
 * @param {string} localPath - The local location to put the file
 * @param {function(Object)} cb(err)
 */
Rackit.prototype.get = function (sCloudPath, localPath, cb) {
	var o1 = this;
	o1._log('getting file', sCloudPath);

	var options = {
		method : 'GET',
		uri : o1.config.storage + '/' + sCloudPath
	};

	o1._cloudRequest(options, cb, function (request) {
		request.pipe(fs.createWriteStream(localPath));
	});
};

/**
 * Removes a file from the cloud store.
 * @param {string} sCloudPath - The relative path to the cloud file <container>/<file>
 * @param {function(err)} cb
 */
Rackit.prototype.remove = function (sCloudPath, cb) {
	var o1 = this;
	var options = {
		method : 'DELETE',
		uri : o1.config.storage + '/' + sCloudPath
	};

	o1._cloudRequest(options, cb);
};

/**
 * Sets/updates custom metadata for a cloud file
 * @param {string} sCloudPath - The relative path to the cloud file <container>/<file>
 * @param {Object} meta
 * @param {function(Error)} cb
 */
Rackit.prototype.setMeta = function (sCloudPath, meta, cb) {
	var o1 = this;
	var headers = {};

	// Add any metadata headers
	var sKey;
	for (sKey in meta) {
		if (meta.hasOwnProperty(sKey)) {
			headers['x-object-meta-' + sKey] = meta[sKey];
		}
	}

	var options = {
		method : 'POST',
		uri : o1.config.storage + '/' + sCloudPath,
		headers : headers
	};

	o1._cloudRequest(options, cb);
};

/*
 * Retrieves the metadata for a cloud file
 * @param {string} cloudpath - The relative path to the cloud file <container>/<file>
 * @param {function(Error, meta, details)} cb - Callback function. Receives
 * an error; a hash containing the object's custom metadata; and a hash of
 * the object's information, including timestamp, ETag and content type.
 * The error will be present if the specified file does not exist.
 */
Rackit.prototype.getMeta = function(cloudpath, cb) {
	var o1 = this;

	var options = {
		method : 'HEAD',
		uri : o1.config.storage + '/' + cloudpath
	};

	o1._cloudRequest(options, function(err, response, body) {
		var
			sKey,
			meta = {},
			details = {},
			headers = response && response.headers,
			prefix = 'x-object-meta-',
			prefixes = {'etag':'etag',
						'x-timestamp':'timestamp',
						'content-type':'content-type'};

		if (err) return cb(err);

		for (sKey in headers) {
			if (headers.hasOwnProperty(sKey)) {
				if(sKey.indexOf(prefix) === 0) {
					meta[sKey.substr(prefix.length)] = headers[sKey];
				}
				else if(prefixes[sKey]) {
					details[prefixes[sKey]] = headers[sKey];
				}
			}
		}

		cb(null, meta, details);
	});
};

/**
 * Returns a full CDN uri for a given cloud file.
 * @param {string} sCloudPath - The relative path to the cloud file <container>/<file>
 * @param {number} ttl - The number of seconds the link should remain active (optional)
 * @return {string} The complete CDN URI to the file, or null if container not found
 */
Rackit.prototype.getURI = function (sCloudPath, ttl) {
	var o1 = this;
	var uri = ttl ? o1._getTempURI(sCloudPath, ttl) : o1._getCDNURI(sCloudPath);
	return uri;
};

/**
 * Returns a full cdn uri for a given cloud file
 * @param {string} sCloudPath - The relative path to the cloud file <container>/<file>
 * @return {string} The complete CDN URI to the file, or null if container not found
 */
Rackit.prototype._getCDNURI = function (sCloudPath) {
	var o1 = this;
	var aPieces = sCloudPath.match(/^\/{0,1}([^/]+)\/(.+)$/);
	var sContainer = aPieces[1];
	var localPath = aPieces[2];

	var CDNContainer = o1.hCDNContainers[sContainer];
	if (!CDNContainer) {
		o1._log('The container ' + sContainer + ' is not CDN enabled. Unable to get CDN URI');
		return null;
	}

	var uri = CDNContainer[o1.options.useSSL ? 'cdn_ssl_uri' : 'cdn_uri'] + '/' + localPath;
	return uri;
};

/**
 * Returns a full temporary uri for a given cloud file.
 * @param {string} sCloudPath - The relative path to the cloud file <container>/<file>
 * @param {number} ttl - The number of seconds the link should remain active
 * @return {string} The complete CDN URI to the file, or null if container not found
 */
Rackit.prototype._getTempURI = function (sCloudPath, ttl) {
	var o1 = this;

	// Ensure a temp url key has been set
	if (!o1.options.tempURLKey) {
		o1._log('You must specify a temp URL key to generate temp URIs');
		return null;
	}

	// If ttl is given, generate a temp URI
	var method = 'GET';
	var expires = Math.floor(Date.now() / 1000) + ttl;

	// Remove snet- from the url (if its there), since this will generally be a public url
	var storage = o1.config.storage.replace('https://snet-', 'https://');
	var storageParts = url.parse(storage);
	var path = storageParts.pathname + '/' + sCloudPath;

	var body = method + '\n' + expires + '\n' + path;

	o1._log(body);
	o1._log(o1.options.tempURLKey);
	var hash = crypto.createHmac('sha1', o1.options.tempURLKey).update(body).digest('hex');
	var uri = storageParts.protocol + '//' + storageParts.host + path + '?temp_url_sig=' + hash + '&temp_url_expires=' + expires;
	return uri;
};

/**
 * This method takes a CDN or temp URI for a file and returns the Cloudpath string. The Cloudpath format is used by the
 * rest of the Rackit methods to identify a file.
 * @param {string} uri - A CDN or temporary URI representing a particular file
 * @return {string} The Cloudpath representing the file
 */
Rackit.prototype.getCloudpath = function (uri) {
	var o1 = this;

	// Check if the provided URI is a temp URI
	var storage = o1.config.storage.replace('https://snet-', 'https://');
	var cloudpath = uri.substring(0, storage.length) === storage ? o1._cloudpathFromTempURI(uri) : o1._cloudpathFromCDNURI(uri);

	return cloudpath;
};

/**
 * This method takes a CDN URI for a file and returns the Cloudpath string. The Cloudpath format is used by the
 * rest of the Rackit methods to identify a file.
 * @param {string} uri - A CDN URI representing a particular file
 * @return {string} The Cloudpath representing the file
 */
Rackit.prototype._cloudpathFromCDNURI = function (uri) {
	var o1 = this;
	var parts = url.parse(uri);
	// Determine which container property to search for.. ssl uri or regular uri
	var uriProperty = parts.protocol === 'https:' ? 'cdn_ssl_uri' : 'cdn_uri';

	// Get the base part of the given uri. This should equal the containers cdn_ssl_uri or cdn_uri
	var base = parts.protocol + '//' + parts.host;

	// Iterate through all of the CDN containers, looking for one that has a matching base URI
	var found = false;
	var container;
	for (container in o1.hCDNContainers) {
		if (o1.hCDNContainers.hasOwnProperty(container)) {
			if (base === o1.hCDNContainers[container][uriProperty]) {
				found = true;
				break;
			}
		}
	}

	// If we couldn't find a container, output a message
	if (!found) {
		o1._log('The container with URI ' + base + ' could not be found. Unable to get Cloudpath');
		return null;
	}

	// Get the cloudpath
	var cloudpath = container + parts.pathname;
	return cloudpath;
};

/**
 * This method takes a temp URI for a file and returns the Cloudpath string. The Cloudpath format is used by the
 * rest of the Rackit methods to identify a file.
 * @param {string} uri - A temporary URI representing a particular file
 * @return {string} The Cloudpath representing the file
 */
Rackit.prototype._cloudpathFromTempURI = function (uri) {
	var parts = url.parse(uri).pathname.match(/^\/?(?:v1\/[^\/]+\/)?([^/]+)\/(.+)$/);
	var file = parts[2];
	var container = parts[1];
	return container + '/' + file;
};

module.exports = Rackit;
