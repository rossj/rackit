/*global require, process, console*/
var url = require('url');
var http = require('http');
var request = require('request');
var mime = require('mime');
var async = require('async');

var crypto = require('crypto');
var fs = require('fs');

var utils = require('./utils');

// An empty function for callbacks
function nothing() {}

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
	logger : console.log,
	listLimit : 10000
};

/**
 * Initializes the cloud connection and gets the local cache of containers
 */
Rackit.prototype.init = function (cb) {
	var o1 = this;

	if (!o1.options.user || !o1.options.key) {
		return cb(new Error('No credentials'));
	}

	// Authenticate with Cloud Files and get an initial container cache
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

	// Set up an interval to refresh the auth token that expires every 23 hours (it expires every 24).
	// Using this method, an API request should never return 401, facilitating easier streaming.
	var oneHour = 60 * 60 * 1000;
	setInterval(function() {
		o1._authenticate(function(err) {
			if (err) {
				o1._log('Reauthentication failed');
			}
		});
	}, 23 * oneHour);
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
 * @param {function(err, res, body)} cb - callback when the non-authentication request goes through
 * @return Request - a Request object to be used with streaming
 */
Rackit.prototype._cloudRequest = function (options, cb) {
	var o1 = this;
	cb = cb || function() {};

	options.headers = options.headers || {};
	options.headers['X-Auth-Token'] = o1.config.authToken;

	// Create and return the request object
	return request(options, function (err, res, body) {
		if (err) {
			return cb(err);
		}

		// Problem
		if (!o1.hGoodStatuses.hasOwnProperty(res.statusCode)) {
			o1._log('request failed');
			return cb(new Error('Error code ' + res.statusCode));
		}

		// Everything went fine
		cb(null, res, body);
	});
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

		}],
	cb);
};

/**
 * This method searches through the container cache for those that match the prefix
 * @return an array containing container names that match the prefix, in sorted order
 * @private
 */
Rackit.prototype._getPrefixedContainers = function() {
	var o1 = this;

	var reg = new RegExp('^' + o1.options.prefix + '\\d+$');
	var asContainers = [];
	var idx = o1.aContainers.length;

	while (idx--) {
		var sContainer = o1.aContainers[idx].name;

		// Check that the container name matches
		if (sContainer.match(reg))
			asContainers.push(sContainer);
	}

	// Sort the container array by numerical index
	var reg = /\d+$/;
	asContainers.sort(function(a, b) {
		a = parseInt(a.match(reg)[0]);
		b = parseInt(b.match(reg)[0]);
		return a-b;
	});

	return asContainers;
};

/**
 * This function searches for the largest numbered container with the
 * specified prefix. If the container has >= 50,000 files, the next container is
 * created. There may be other containers, which will be ignored.
 * @param {function(Error, string)} cb - callback(Error, sContainer)
 */
Rackit.prototype._getContainer = function (cb) {
	var o1 = this;

	var asContainers = o1._getPrefixedContainers();

	// Check that we found a prefixed container
	var name;
	if (!asContainers.length) {
		// If no existing containers, create one!
		name = o1.options.prefix + '0';
		return o1._createContainer(name, function (err) {
			cb(err, name);
		});
	}

	// We have containers. Get the most recent one.
	name = asContainers.pop();

	// Check if the container is full
	if (o1.hContainers[name].count >= 50000) {
		// The container is full, create the next one
		name = o1.options.prefix + (parseInt(name.match(/\d+$/)[0]) + 1);
		return o1._createContainer(name, function (err) {
			cb(err, name);
		});
	}

	// The container we found is fine.. return it.
	cb(null, name);
};

/**
 * Adds a file!
 * @param {string|ReadableStream} source - Either a string (local path) or ReadableStream representing the file to add
 * @param {{type: string, filename: string, meta: Object, headers: Object.<string, string>}} options - Additonal options
 * @param {function(?Error, string=)} cb - Callback, returns error or the cloud path
 */
Rackit.prototype.add = function (source, options, cb) {
	var o1 = this;

	// Normalize options
	if (typeof options === 'function') {
		cb = options;
		options = null;
	}

	// Sanity check the source
	if (!source) {
		o1._log('no file source specified');
		return cb(new Error('No file source'));
	}

	var fromFile = typeof source === 'string';

	// If the source is a stream, ensure it is readable
	if (!fromFile && source.readable !== true) {
		o1._log('not a valid stream');
		return cb(new Error('Not a valid stream'));
	}

	// Set default options
	options = options || {};
	options.meta = options.meta || {};

	if (fromFile) {
		o1._log('adding file', source);
	} else {
		o1._log('adding file', 'from stream');
		// Pause the source stream so we can catch the data in the callback below
		// Note: pause is advisory, so it's possible the stream will emit data before we resume it.
		// This should only occur for http request streams (not file streams), and can be fixed
		// by wrapping the stream in a buffered stream. Streams will internally buffer in node v0.9
		source.pause();
	}


	async.parallel({
			// If the source is a file, make sure it exists
			stats : function (cb) {
				if (fromFile)
					fs.stat(source, cb);
				else
					cb();
			},
			// Get the file type (passed in or find)
			type : function (cb) {
				if (options.type) {
					// The type was explicity defined
					cb(null, options.type);
				} else if (fromFile) {
					// The source is a file so we can find its type
					cb(null, mime.lookup(source));
				} else {
					// The source is a stream, so it might already be a reqeust with a content-type header.
					// In this case, the content-type will be forwarded automatically
					if (source.headers && source.headers['content-type']) {
						cb();
					} else {
						cb(new Error('Unable to determine content-type. You must specify the type for file streams.'));
					}
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

			if (fromFile) {
				headers['content-length'] = results.stats.size;
			} else {
				headers['transfer-encoding'] = 'chunked';
			}

			if (results.type)
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
			var req = o1._cloudRequest(reqOptions, function (err, res, body) {
				// Done with request..
				o1._log('done adding file to cloud');

				// Increment the container count
				if (!err) {
					o1.hContainers[results.container].count++;
				}

				cb(err, cloudPath);
			});

			// Open a file stream, and pipe it to the request.
			if (fromFile)
				source = fs.createReadStream(source);

			source.resume();
			source.pipe(req);
		});
};

/**
 * Lists all items for the configured container prefix. Returns an array containing 0 or more cloudpaths.
 * NOTE: The order is sorted primarily on container, and secondarily on object name.
 * @param {function(Array)} cb(err, aCloudpaths)
 */
Rackit.prototype.list = function (cb) {
	// Get from the 0 container
	var o1 = this;
	var aCloudpaths = [];

	var asContainers = o1._getPrefixedContainers();

	// List the objects for each container in parallel
	async.forEach(
		asContainers,
		function (sContainer, cb) {
			o1._listContainer(sContainer, function (err, aObjects) {
				if (err) {
					return cb(err);
				}

				// Append the container name to each result
				var i = aObjects.length;
				while (i--) {
					aObjects[i] = sContainer + '/' + aObjects[i];
				}
				aCloudpaths = aCloudpaths.concat(aObjects);
				cb();
			});
		},
		// Final function of forEach
		function (err) {
			cb(err, err ? undefined : aCloudpaths);
		}
	);
};

// Returns an array of all the objects in a container
Rackit.prototype._listContainer = function(sContainer, cb) {
	var o1 = this;
	var objects = [];

	// A callback to receive some of the containers objects
	function receiveSomeResults(err, someObjects) {
		if (err) {
			return cb(err);
		}

		// Add the results to the master array
		objects = objects.concat(someObjects);

		// If the latest results contained the list limit, request more
		if (someObjects.length >= o1.options.listLimit) {
			o1._listContainerPart(sContainer, someObjects.pop(), receiveSomeResults);
			return;
		}

		// Return the object array
		cb(null, objects);
	}

	// Set of the listing for this container
	o1._listContainerPart(sContainer, null, receiveSomeResults);
};

// Returns some of the objects in a container
Rackit.prototype._listContainerPart = function (sContainer, marker, cb) {
	// Get from the 0 container
	var o1 = this;

	var uri = o1.config.storage + '/' + sContainer + '?format=json&limit=' + o1.options.listLimit;

	// Add a maker if specified
	if (marker)
		uri += '&marker=' + marker;

	var options = {
		uri : uri
	};

	o1._cloudRequest(options, function (err, res, body) {
		if (err) {
			return cb(err);
		}

		// Check the response for no-content
		if (res.statusCode === 204 || !body) {
			return cb(null, []);
		}

		// Just get the cloudpaths of the returned objects
		var aObjects = JSON.parse(body);
		var i;
		for (i = 0; i < aObjects.length; i++) {
			aObjects[i] = aObjects[i].name;
		}
		cb(null, aObjects);
	});
};

/**
 * Downloads a cloud file to a local file
 * @param {string} sCloudPath - The relative path to the cloud file <container>/<file>
 * @param {string|function} localPath - The local location to put the file
 * @param {function} cb(err)
 * @return the request stream
 */
Rackit.prototype.get = function (sCloudPath, localPath, cb) {
	var o1 = this;
	o1._log('getting file', sCloudPath);

	// Normalize parameters
	if (typeof localPath === 'function') {
		cb = localPath;
		localPath = null;
	}

	var options = {
		method : 'GET',
		uri : o1.config.storage + '/' + sCloudPath
	};

	var req = o1._cloudRequest(options, cb);

	// Pipe the request response to the output file, if specified
	if (localPath && typeof localPath === 'string') {
		req.pipe(fs.createWriteStream(localPath));
	}

	return req;
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
