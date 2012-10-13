# Rackit

Rackit is a module for managing large collections of files on Rackspace Cloud Files. Rackit automatically creates containers as needed, and will seamlessly reauthenticate if your API key expires. Rackit also supports the generation of temporary, time-limited file URLs.

Cloud Files has a recommended limit of 50,000 files per container. Rackit knows this, and will automatically create new containers as necessary.

With Rackit, you specify a container prefix, such as 'file'. Then, Rackit will create containers ['file0', 'file1', ...] as necessary.

For security, privacy, and ease, Rackit stores files on the cloud with random names, which it returns to you.

# Install

    $ npm install rackit

# Usage

    var rackit = require('rackit');
    
    // Initialize with your account information
    rackit.init({
        'user' : '<your Rackspace username>',
        'key' : '<your Rackspace API key>'
    }, function(err) {
        // Add a local file to the cloud
        rackit.add(__dirname + '/image.jpg', function(err, cloudpath) {
            // Get the CDN URI of the file
            console.log(rackit.getURI(cloudpath));

            // The cloudpath parameter uniquely identifies this file, and is used by other Rackit methods to manipulate it.
            // We should probably store the cloudpath somewhere.
        });
    });

Optionally, you may create your own Rackit instance. This is necessary if you are accessing multiple Cloud File accounts.

    var Rackit = require('rackit').Rackit;
    var myRackit = new Rackit({
        'user' : '<your Rackspace username>',
        'key' : '<your Rackspace API key>'
    });
    
    myRackit.init(function(err) {
        // Add a local file to the cloud
        myRackit.add(__dirname + '/image.jpg', function(err, cloudpath) {
            // Get the CDN URI of the file
            console.log(myRackit.getURI(cloudpath));
        });
    });
    
# Options

When initializing Rackit, here are the options and defaults:

    {
        user : '', // Your Rackspace username
		key : '', // Your Rackspace API key
		prefix : 'dev', // The prefix for your Cloud Files containers (may contain forward slash)
		region : 'US', // Determines the API entry point - other option of 'UK'
		tempURLKey : null, // A secret for generating temporary URLs
		useSNET : false,
		useCDN : true,
		useSSL : true, // Specifies whether to use SSL (https) for CDN links
		verbose : false, // If set to true, log messages will be generated
		logger : console.log // Function to receive log messages
    }

        
# Methods
### #add(localPath, [options,] callback)
- localPath - A path to the file to upload
- options - A hash of additional options
  - type - A MIME type (e.g. 'Image/JPEG'). If not specified, mime-magic is used.
  - filename - What to name the file on Cloud Files. Omit to have Rackit generate a UID.
  - meta - A hash of additional metadata to store along with the file (prefixed with 'X-Object-Meta-' automatically).
  - headers - A hash of additional headers to send.
- callback(err, cloudpath) - returns information about the location of the file. `cloudpath` is in the form 'container/file-name' and is used as input to other methods to uniquely identify a file. I recommend storing the `cloudpath` in your database, although you could also store a CDN url.

Uploads a file to the cloud. The uploaded file will be given a random 24-character file name.

### #get(cloudpath, localPath, callback)
- cloudpath - of the form 'container/file-name'
- localPath - where to put the downloaded file
- callback(err, request)

Downloads a file from the cloud.

### #remove(cloudpath, callback)

Permanently deletes a file from the cloud.

### #setMeta(cloudpath, meta, callback)

Upserts the metadata for the specified cloud file.

### #getMeta(cloudpath, callback)
- cloudpath - of the form 'container/file-name'
- callback(err, meta)

Retrieves the metadata for the specified cloud file. An error will be returned if the file does not exist.

### #getURI(cloudpath [, ttl])

Returns a URI for a given file. If the ttl parameter is omitted, then a CDN URI will be returned (if the container is CDN enabled). If ttl is specified, a temporary URI will be given which is valid for ttl seconds.

### #getCloudpath(uri)

Opposite of getURI. Returns a Cloudpath string given a file's CDN or temporary URI. The Cloudpath can then be used as input to other Rackit methods.

# TODO

* Add periodic updating of cached container info, in case things are modified externally
* Add ability to specify container size limit
* Finish writing test cases

# LICENSE
(The MIT License)

Copyright (C) 2012 Ross Johnson (ross@mazira.com)

Copyright (C) 2012 Mazira, LLC

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.