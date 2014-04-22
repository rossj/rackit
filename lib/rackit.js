/*global require, process, console*/
// node modules
var fs = require('fs');
var url = require('url');
var http = require('http');
var crypto = require('crypto');

// npm modules
var _ = require('lodash');
var mime = require('mime');
var async = require('async');
var pkgcloud = require('pkgcloud');
var File = require('../node_modules/pkgcloud/lib/pkgcloud/rackspace/storage/file.js').File;
var utils = require('./utils');

var Rackit = function (options) {
	// Check the region
	if (!options || !options.region) {
		throw new Error('You must specify a region.');
	}

	this.options = Object.create(Rackit.defaultOptions);

	// Override the default options
	for (var prop in options) {
		if (options.hasOwnProperty(prop)) {
			this.options[prop] = options[prop];
		}
	}

	this._client = pkgcloud.storage.createClient({
		provider : 'rackspace',
		username : this.options.user,
		apiKey : this.options.key,
		region : this.options.region
	});

	this.config = null;
	this.aContainers = null;
	this.aCDNContainers = null;
};

Rackit.defaultOptions = {
	user : '',
	key : '',
	prefix : 'dev',
	authRegion : 'US',
	region : '',
	authURIs : {
		'UK' : 'https://lon.identity.api.rackspacecloud.com/v2.0',
		'US' : 'https://identity.api.rackspacecloud.com/v2.0'
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
			o1._client.auth(function (err) {
				if (err && !(err instanceof Error)) {
					err = new Error(err.message || err);
				}

				if (!err) {
					o1.config = {
						storage : o1._client.getServiceUrl('object-store')
					};
				}
				cb(err);
			});
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
	}, function (err, results) {
		// Avoid passing the results parameter on
		return cb(err);
	});
};

Rackit.prototype._log = function () {
	arguments[0] = 'rackit: ' + arguments[0];
	if (this.options.verbose) {
		this.options.logger.apply(null, arguments);
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
		headers : {
			'X-Account-Meta-Temp-Url-Key' : o1.options.tempURLKey
		}
	};

	o1._client.request(options, function (err, body) {
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

	async.parallel([
		// Get regular container info
		function (cb) {
			o1._client.getContainers(function (err, containers) {
				if (err)
					return cb(err);

				o1.aContainers = containers;
				o1._log('got containers', _.pluck(o1.aContainers, 'name'));
				cb();
			});
		},
		// Get CDN container info
		function (cb) {
			o1._client.getCdnContainers(function (err, containers) {
				if (err)
					return cb(err);

				o1.aCDNContainers = containers;

				o1._log('got CDN containers', _.pluck(o1.aCDNContainers, 'name'));
				cb();
			});
		}
	], cb);
};

/**
 * Adds a new prefixed container. Can optionally CDN enable the container.
 * @param {function(err)} cb
 */
Rackit.prototype._createContainer = function (cb) {
	var o1 = this;
	var aContainers = o1._getPrefixedContainers(o1.aContainers);
	var container;

	var numExisting = aContainers.length;
	var topContainer = numExisting && aContainers[numExisting - 1];

	var sName;
	if (!topContainer)
		sName = o1.options.prefix + '0';
	else {
		sName = o1.options.prefix + (parseInt(topContainer.name.match(/\d+$/)[0]) + 1);
	}

	o1._log('adding container \'' + sName + '\'...');

	async.series([
		// Create the container
		function (cb) {
			o1._client.createContainer(sName, function (err, _container) {
				if (err)
					return cb(err);

				// check that a parallel operation didn't just add the same container
				container = _.find(o1.aContainers, { name : sName });

				if (!container) {
					o1.aContainers.push(_container);
					container = _container;
				}

				cb();
			});
		},
		// CDN enable the container, if necessary
		function (cb) {
			if (!o1.options.useCDN)
				return cb();

			o1._log('CDN enabling the container');

			container.enableCdn(function (err, _container) {
				if (err)
					return cb(err);

				// check that a parallel operation didn't just CDN enable the same container
				var CDNContainer = _.find(o1.aCDNContainers, { name : sName });

				if (!CDNContainer) {
					o1.aCDNContainers.push(_container);
				}

				cb();
			});
		}],
		function (err) {
			cb(err, container);
		});
};

/**
 * This method searches through the container cache for those that match the prefix
 * @param {Array} an array of container objects from Rackspace
 * @return an array of container objects that match the prefix, in sorted order
 * @private
 */
Rackit.prototype._getPrefixedContainers = function (containers) {
	var o1 = this;
	var reg1 = new RegExp('^' + o1.options.prefix + '\\d+$');
	var reg2 = /\d+$/;

	return _(containers)
		.where(function (container) {
			return container.name.match(reg1);
		})
		.sortBy(function (container) {
			return +container.name.match(reg2)[0];
		})
		.value();
};

/**
 * This function searches for the largest numbered container with the
 * specified prefix. If the container has >= 50,000 files, the next container is
 * created. There may be other containers, which will be ignored.
 * @param {function(Error, string)} cb - callback(Error, sContainer)
 */
Rackit.prototype._getContainer = function (cb) {
	var o1 = this;
	var aContainers = o1._getPrefixedContainers(o1.aContainers);

	// Check that we found a prefixed container
	if (!aContainers.length) {
		// If no existing containers, create one!
		o1._createContainer(cb);
		return;
	}

	// We have containers. Get the most recent one.
	var container = _.last(aContainers);

	// Check if the container is full
	if (container.count >= 100000000) {
		// The container is full, create the next one
		o1._createContainer(cb);
		return;
	}

	// The container we found is fine.. return it.
	cb(null, container);
};

/**
 * Adds a file!
 * @param {string|ReadableStream} source - Either a string (local path) or ReadableStream representing the file to add
 * @param {{type: string, filename: string, meta: Object, headers: Object.<string, string>}|function(?Error, string=)} options - Additonal options
 * @param {function(?Error, string=)} cb - Callback, returns error or the cloud path
 */
Rackit.prototype.add = function (source, options, cb) {
	var o1 = this;

	// Ensure things have been initialized
	if (!o1.aContainers)
		throw new Error('Attempting to use container information without initializing Rackit. Please call rackit.init() first.');

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

	// Determine the type
	var type = options.type;

	if (!type) {
		if (fromFile)
			type = mime.lookup(source);
		else {
			// The source is a stream, so it might already be a reqeust with a content-type header.
			// In this case, the content-type will be forwarded automatically
			type = source.headers && source.headers['content-type'];
			if (!type) {
				return cb(new Error('Unable to determine content-type. You must specify the type for file streams.'));
			}
		}
	}

	async.parallel({
			// If the source is a file, make sure it exists
			stats : function (cb) {
				if (fromFile)
					fs.stat(source, cb);
				else
					cb();
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

			//
			// Generate the headers to be send to Rackspace
			//
			var headers = {};

			if (type)
				headers['content-type'] = type;

			// set the content-length of transfer-encoding as appropriate
			if (!fromFile) {
				if (source.headers && source.headers['content-length'])
					headers['content-length'] = source.headers['content-length'];
				else
					headers['transfer-encoding'] = 'chunked';
			}

			// Add any additonal headers
			var sKey;
			for (sKey in options.headers) {
				if (options.headers.hasOwnProperty(sKey)) {
					headers[sKey] = options.headers[sKey];
				}
			}

			//
			// Generate the cloud request options
			//
			var _options = {
				container : results.container.name,
				remote : id,
				headers : headers,
				metadata : options.meta
			};
			if (fromFile)
				_options.local = source;
			else {
				_options.stream = source;
				source.resume();
				if (source.headers) {
					// We want to remove any headers from the source stream so they don't clobber our own headers.
					delete source.headers;
				}
			}


			o1._client.upload(_options, function (err, result) {
				if (err)
					return cb(err);

				results.container.count++;
				cb(err, results.container.name + '/' + id);
			});
		});
};

/**
 * Lists all items for the configured container prefix. Returns an array containing 0 or more cloudpaths.
 * NOTE: The order is sorted primarily on container, and secondarily on object name.
 * @param {Object} options an optional hash specifing some additional options. Currently 'extended' is supported.
 * @param {function(Array)} cb(err, aCloudpaths)
 */
Rackit.prototype.list = function (options, cb) {
	// Get from the 0 container
	var o1 = this;
	var aObjects = [];

	// Ensure things have been initialized
	if (!o1.aContainers)
		throw new Error('Attempting to use container information without initializing Rackit. Please call rackit.init() first.');

	// Normalize the parameters
	if (typeof options === 'function') {
		cb = options;
		options = {};
	}

	// List the objects for each container in parallel
	var aContainers = o1._getPrefixedContainers(o1.aContainers);
	async.forEach(
		aContainers,
		function (container, cb) {
			o1._listContainer(container, function (err, aSomeObjects) {
				if (err)
					return cb(err);

				aObjects = aObjects.concat(aSomeObjects);
				cb();
			});
		},
		// Final function of forEach
		function (err) {
			var i;

			// If the extended option is off, just return cloudpaths
			if (!options.extended) {
				i = aObjects.length;
				while (i--) {
					aObjects[i] = aObjects[i].cloudpath;
				}
			}

			cb(err, err ? undefined : aObjects);
		}
	);
};

// Returns an array of all the objects in a container
Rackit.prototype._listContainer = function (container, cb) {
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
			o1._listContainerPart(container, someObjects.pop().name, receiveSomeResults);
			return;
		}

		// Return the object array
		cb(null, objects);
	}

	// Set of the listing for this container
	o1._listContainerPart(container, null, receiveSomeResults);
};

// Returns some of the objects in a container
Rackit.prototype._listContainerPart = function (container, marker, cb) {
	var o1 = this;
	var options = { limit : o1.options.listLimit };

	if (marker)
		options.marker = marker;

	o1._client.getFiles(container, options, function (err, files) {
		if (err)
			return cb(err);

		var i = files.length;
		while (i--)
			files[i].cloudpath = container.name + '/' + files[i].name;

		cb(null, files);
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

	cb = cb || function () {
	};

	var aPieces = sCloudPath.match(/^\/{0,1}([^/]+)\/(.+)$/);
	var sContainer = aPieces[1];
	var sName = aPieces[2];

	var options = {
		container : sContainer,
		remote : sName
	};

	var stream = o1._client.download(options, function (err, data) {
		if (err)
			return cb(err);

		if (!localPath) {
			cb();
		}
	});

	if (localPath) {
		var w = fs.createWriteStream(localPath);
		stream.pipe(w);
		w.on('finish', function () {
			cb();
		});
	}

	return stream;
};

/**
 * Removes a file from the cloud store.
 * @param {string} sCloudPath - The relative path to the cloud file <container>/<file>
 * @param {function(err)} cb
 */
Rackit.prototype.remove = function (sCloudPath, cb) {
	var o1 = this;

	var aPieces = sCloudPath.match(/^\/{0,1}([^/]+)\/(.+)$/);
	var sContainer = aPieces[1];
	var sName = aPieces[2];

	o1._client.removeFile(sContainer, sName, function (err) {
		if (err)
			return cb(err);

		// decrement the internal container size
		var container = _.find(o1.aContainers, { name : sContainer });
		container.count--;

		cb();
	});
};

/**
 * Sets/updates custom metadata for a cloud file
 * @param {string} sCloudPath - The relative path to the cloud file <container>/<file>
 * @param {Object} meta
 * @param {function(Error)} cb
 */
Rackit.prototype.setMeta = function (sCloudPath, meta, cb) {
	var o1 = this;

	var aPieces = sCloudPath.match(/^\/{0,1}([^/]+)\/(.+)$/);
	var sContainer = aPieces[1];
	var sName = aPieces[2];

	// updateFileMetadata() requires a File instance, so make a dummy one
	var file = new File(o1._client, { name : sName });
	file.metadata = meta;

	o1._client.updateFileMetadata(sContainer, file, function (err) {
		if (err)
			return cb(err);

		cb();
	});
};

/*
 * Retrieves the metadata for a cloud file
 * @param {string} cloudpath - The relative path to the cloud file <container>/<file>
 * @param {function(Error, meta, details)} cb - Callback function. Receives
 * an error; a hash containing the object's custom metadata; and a hash of
 * the object's information, including timestamp, ETag and content type.
 * The error will be present if the specified file does not exist.
 */
Rackit.prototype.getMeta = function (sCloudPath, cb) {
	var o1 = this;

	var aPieces = sCloudPath.match(/^\/{0,1}([^/]+)\/(.+)$/);
	var sContainer = aPieces[1];
	var sName = aPieces[2];

	o1._client.getFile(sContainer, sName, function (err, file) {
		if (err)
			return cb(err);

		cb(null, file.metadata);
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

	var CDNContainer = _.find(o1.aCDNContainers, { name : sContainer });
	if (!CDNContainer) {
		o1._log('The container ' + sContainer + ' is not CDN enabled. Unable to get CDN URI');
		return null;
	}

	var uri = CDNContainer[o1.options.useSSL ? 'cdnSslUri' : 'cdnUri'] + '/' + localPath;
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
	var uriProperty = parts.protocol === 'https:' ? 'cdnSslUri' : 'cdnUri';

	// Get the base part of the given uri. This should equal the containers cdn_ssl_uri or cdn_uri
	var base = parts.protocol + '//' + parts.host;

	// Find the CDN container that has a matching base URI
	var search = {};
	search[uriProperty] = base;
	var container = _.find(o1.aCDNContainers, search);

	// If we couldn't find a container, output a message
	if (!container) {
		o1._log('The container with URI ' + base + ' could not be found. Unable to get Cloudpath');
		return null;
	}

	// Get the cloudpath
	var cloudpath = container.name + parts.pathname;
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
