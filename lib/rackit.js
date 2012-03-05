/*global require, process, console*/
var http = require('http');
var request = require('request');
var mime = require('mime-magic');
var async = require('async');
var fs = require('fs');
var utils = require('./utils');

var Rackit = function(options) {
	this.options = {
		user : '',
		key : '',
		prefix : 'dev',
		baseURI : 'https://auth.api.rackspacecloud.com/v1.0',
		useSNET : false,
		useCDN : true,
		useSSL : true,
		verbose : false,
		logger : console.log
	};

	// Override the default options
	for(var prop in options) {
		if(options.hasOwnProperty(prop)) {
			this.options[prop] = options[prop];
		}
	}

	this.config = null;
	this.aContainers = null;
	this.hContainers = null;
	this.aCDNContainers = null;
	this.hCDNContainers = null;
};
/**
 * Initializes the cloud connection and gets the local cache of containers
 */
Rackit.prototype.init = function(cb) {
	var o1 = this;

	if(!o1.options.user || !o1.options.key) {
		return cb(new Error('No credentials'));
	}

	async.series({
		one : function(cb) {
			o1._authenticate(cb);
		},
		two : function(cb) {
			o1._getContainers(cb);
		}
	}, cb);
};

Rackit.prototype._log = function() {
	arguments[0] = 'rackit: ' + arguments[0];
	if(this.options.verbose) {
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
Rackit.prototype._authenticate = function(cb) {
	var o1 = this;

	o1._log('authenticating...');

	// Build the request options
	var options = {
		uri : o1.options.baseURI,
		headers : {
			'X-Auth-User' : o1.options.user,
			'X-Auth-Key' : o1.options.key
		}
	};

	request(options, function(err, res, body) {
		o1.config = null;

		if(err) {
			return cb(err);
		}

		if(!o1.hGoodStatuses.hasOwnProperty(res.statusCode)) {
			return cb(new Error('Error code ' + res.statusCode));
		}

		// Store the config info
		o1.config = {
			storage : res.headers['x-storage-url'],
			CDN : res.headers['x-cdn-management-url'],
			authToken : res.headers['x-auth-token']
		};

		// Change URLs to s-net urls if it is enabled
		if(o1.options.useSNET) {
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
Rackit.prototype._cloudRequest = function(options, cbResult, cbRequest) {
	var o1 = this;

	options.headers = options.headers || {};
	options.headers['X-Auth-Token'] = o1.config.authToken;

	o1._log('making request...');

	// Create the request object
	var req1 = request(options, function(err, res, body) {
		o1._log('request done...');

		if(err) {
			return cbResult(err);
		}

		// Unauthorized
		if(res.statusCode === 401) {
			// Attempt to re-authorize
			o1._authenticate(function(err) {
				if(err) {
					return cbResult(err);
				}

				// Reauthorized, so run request again
				o1._cloudRequest(options, cbResult, cbRequest);
			});
			return;
		}

		// Problem
		if(!o1.hGoodStatuses.hasOwnProperty(res.statusCode)) {
			o1._log('request failed');
			return cbResult(new Error('Error code ' + res.statusCode));
		}

		// Everything went fine
		if(cbResult) {
			cbResult(null, res, body);
		}
	});
	// Return the requets object to the callback so that data may be piped
	if(cbRequest) {
		cbRequest(req1);
	}
};
/**
 * Gets info about containers, including CDN containers
 * @param {function(err)} cb
 */
Rackit.prototype._getContainers = function(cb) {
	var o1 = this;
	o1._log('getting containers...');

	async.parallel({
		// Get regular container info
		one : function(cb) {
			// Build request options
			var options = {
				uri : o1.config.storage + '?format=json'
			};

			o1._cloudRequest(options, function(err, res, body) {
				if(err) {
					return cb(err);
				}
				o1.aContainers = JSON.parse(body);

				// Create the global hash of containers from the array
				o1.hContainers = {};

				var container;
				var i = o1.aContainers.length;
				while(i--) {
					container = o1.aContainers[i];
					o1.hContainers[container.name] = container;
				}

				o1._log('got containers', Object.keys(o1.hContainers));
				cb();
			});
		},
		// Get CDN container info
		two : function(cb) {
			// Build request options
			var options = {
				uri : o1.config.CDN + '?format=json'
			};

			o1._cloudRequest(options, function(err, res, body) {
				if(err) {
					return cb(err);
				}
				o1.aCDNContainers = JSON.parse(body);

				// Build a hash from the CDN container array.. this is used for lookups
				o1.hCDNContainers = {};
				var i = o1.aCDNContainers.length;
				var CDNContainer;
				while(i--) {
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
Rackit.prototype._createContainer = function(sName, cb) {
	var o1 = this;
	o1._log('adding container \'' + sName + '\'...');

	async.waterfall([
	// Create the container
	function(cb) {
		var options = {
			method : 'PUT',
			uri : o1.config.storage + '/' + sName
		};

		o1._cloudRequest(options, cb);
	},

	// Add the container locally, but first check if it exists first (the Rackspace API is idempotent)
	function(res, body, cb) {
		var container;

		if(!o1.hContainers[sName]) {
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
	function(cb) {
		if(!o1.options.useCDN) {
			return cb();
		}

		o1._log('CDN enabling the container');
		
		var options = {
			method : 'PUT',
			uri : o1.config.CDN + '/' + sName
		};

		o1._cloudRequest(options, cb);
	},

	// Add the CDN container locally, but first check the container wasn't already CDN enabled
	function(res, body, cb) {
		var CDNContainer;
		// Add the container locally
		if(res.statusCode === 201 /* Created */) {
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
Rackit.prototype._getContainer = function(cb) {
	var o1 = this;

	// Search through the containers we have for the highest numbered, prefixed container
	// TODO: Cache the highest numbered container
	var idx = o1.aContainers.length;
	var container;
	var highestContainerNum = -1;
	var containerNum;
	while(idx--) {
		container = o1.aContainers[idx];
		// Check that the container name matches
		if(container.name.lastIndexOf(o1.options.prefix, 0) === 0) {
			// The prefix matches, get the number
			containerNum = container.name.substring(o1.options.prefix.length);
			if(!isNaN(containerNum)) {
				highestContainerNum = Math.max(highestContainerNum, containerNum);
			}
		}
	}

	// Check that we found a prefixed container
	var name;
	if(highestContainerNum < 0) {
		name = o1.options.prefix + '0';
		return o1._createContainer(name, function(err) {
			cb(err, name);
		});
	}

	// We have found a prefixed container.. get it
	name = o1.options.prefix + highestContainerNum;
	container = o1.hContainers[name];

	// Check if the container is full
	if(container.count >= 50000) {
		name = o1.options.prefix + (highestContainerNum + 1);
		return o1._createContainer(name, function(err) {
			cb(err, name);
		});
	}

	// The container we found is fine.. return it.
	cb(null, name);
};
/**
 * Adds a file!
 * @param {string} sFile - The local file to add
 * @param {{Object.<type: string, meta: Object>|function(Error, string)}} options - Additonal options
 * @param {function(Error, string)} cb - Callback, returns error or the cloud path
 */
Rackit.prototype.add = function(sFile, options, cb) {
	var o1 = this;
	
	// Normalize options
	if (typeof options === 'function') {
		cb = options;
		options = null;
	}
	
	// Set default options
	options = options || {};
	options.meta = options.meta || {};	

	o1._log('adding file', sFile);

	if(!sFile) {
		o1._log('no local file', sFile);
		return cb(new Error('No local file'));
	}

	async.parallel({
		// Get the file stats
		stats : async.apply(fs.stat, sFile),
		// Get the file type (passed in or find)
		type : function(cb) {
			if(options.type) {
				cb(null, options.type);
			} else {
				mime.fileWrapper(sFile, cb);
			}
		},
		// Get the file container
		container : function(cb) {
			o1._getContainer(cb);
		}
	},
	// Final function of parallel.. create the request to add the file
	function(err, results) {
		if(err) {
			return cb(err);
		}

		// Generate file id
		var id = utils.uid(24);

		var headers = {};
		headers['content-length'] = results.stats.size;
		headers['content-type'] = results.type;

		// Add any metadata headers
		var sKey;
		for(sKey in options.meta) {
			if(options.meta.hasOwnProperty(sKey)) {
				headers['x-object-meta-' + sKey] = options.meta[sKey];
			}
		}

		var reqOptions = {
			method : 'PUT',
			uri : o1.config.storage + '/' + results.container + '/' + id,
			headers : headers
		};

		// Make the actual request
		o1._cloudRequest(reqOptions, function(err, res, body) {
			// Done with request..
			o1._log('done adding file to cloud');
			cb(err, results.container, id);
		}, function(request) {
			// Open a file stream, and pipe it to the request.
			fs.createReadStream(sFile).pipe(request);
		});
	});
};
/**
 * Lists items (up to the first 10,000)
 * TODO: Make more useful
 * @param {function(Array)} cb(aObjects)
 */
Rackit.prototype.list = function(cb) {
	// Get from the 0 container
	var o1 = this;

	var sContainer = o1.options.prefix + '0';
	var options = {
		uri : o1.config.storage + '/' + sContainer + '?format=json'
	};

	o1._cloudRequest(options, function(err, res, body) {
		if(err) {
			return cb(err);
		}
		var aObjects = JSON.parse(body);
		var aObject;
		var i;
		for( i = 0; i < aObjects.length; i++) {
			aObject = aObjects[i];
			aObject.name = sContainer + '/' + aObject.name;
		}
		cb(null, aObjects);
	});
};
/**
 * Downloads a cloud file to a local file
 * @param {string} sCloudPath - The relative path to the cloud file <container>/<file>
 * @param {string} sFile - The local location to put the file
 * @param {function(Object)} cb(err)
 */
Rackit.prototype.get = function(sCloudPath, sFile, cb) {
	var o1 = this;
	o1._log('getting file', sCloudPath);

	var options = {
		method : 'GET',
		uri : o1.config.storage + '/' + sCloudPath
	};

	o1._cloudRequest(options, cb, function(request) {
		request.pipe(fs.createWriteStream(sFile));
	});
};
/**
 * Removes a file from the cloud store.
 * @param {string} sCloudPath - The relative path to the cloud file <container>/<file>
 * @param {function(err)} cb
 */
Rackit.prototype.remove = function(sCloudPath, cb) {
	var o1 = this;
	var options = {
		method : 'DELETE',
		uri : o1.config.storage + '/' + sCloudPath
	};

	o1._cloudRequest(options, cb);
};
/**
 * Sets/updates metadata for a cloud file
 * @param {string} sCloudPath - The relative path to the cloud file <container>/<file>
 * @param {Object} meta
 * @param {function()} cb
 */
Rackit.prototype.setMeta = function(sCloudPath, meta, cb) {
	var o1 = this;
	var headers = {};

	// Add any metadata headers
	var sKey;
	for(sKey in meta) {
		if(meta.hasOwnProperty(sKey)) {
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
/**
 * Returns a full CDN uri for a given cloud file.
 * @param {string} sCloudPath - The relative path to the cloud file <container>/<file>
 * @return {string} The complete CDN URI to the file, or null if container not found
 */
Rackit.prototype.getURI = function(sCloudPath) {
	var aPieces = sCloudPath.split('/');
	var sContainer = aPieces[0];
	var sFile = aPieces[1];

	var CDNContainer = this.hCDNContainers[sContainer];
	if(!CDNContainer) {
		return null;
	}

	var property = this.options.useSSL ? 'cdn_ssl_uri' : 'cdn_uri';
	return CDNContainer[property] + '/' + sFile;
};

exports.Rackit = Rackit;
