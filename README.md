# Rackit

Rackit is a module for managing up to 3.2 bajillion** files on Rackspace Cloud Files. With Rackit, you don't have to worry about containers, CDN enabling containers, or re-authenticating when your key has expired.

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
        rackit.add(__dirname + '/image.jpg', function(err, cloudPath) {
            // Get the CDN URI of the file
            console.log(rackit.getURI(cloudPath));
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
        myRackit.add(__dirname + '/image.jpg', function(err, cloudPath) {
            // Get the CDN URI of the file
            console.log(myRackit.getURI(cloudPath));
        });
    });
    
# Options

When initializing Rackit, here are the options and defaults:

- user: '' - your Rackspace username
- key: '' - your Rackspace API key
- prefix: 'dev' - the prefix for your Cloud Files containers
- baseURI: 'https://auth.api.rackspacecloud.com/v1.0' - the API entry point, which may change depending on your country
- useSNET: false - whether or not to use SNET for super-fast Cloud Server to Cloud File networking
- useCDN: true - tells Rackit whether to CDN enable new containers it creates
- useSSL: true - tells Rackit whether to use the SSL version of CDN URIs
- verbose: false - if set to true, log messages will be generated
- logger: console.log - if verbose is true, this function will recieve the log messages

        
# Methods
### #add(localPath, [options,] callback)
- localPath - a path to the file to upload
- options - a hash of additional options
  - type - a MIME type (e.g. 'Image/JPEG'). If not specified, mime-magic is used.
  - meta - a hash of additional metadata to store along with the file
- callback(err, cloudContainer, cloudFileName) - returns information about the location of the file. You should concatenate the container and file name in the form 'container/file-name' for storage. This format is used as input to other methods.

Uploads a file to the cloud. The uploaded file will be given a random 24-character file name.

### #get(cloudPath, localPath, callback)
- cloudPath - of the form 'container/file-name'
- localPath - where to put the downloaded file
- callback(err)

Downloads a file from the cloud.

### #remove(cloudPath, callback)

Permanently deletes a file from the cloud.

### #setMeta(cloudPath, meta, callback)

Upserts the metadata for the specified cloud file.

### #getURI(cloudPath)

Returns the complete CDN URI for a given file. Will only work if the file's container is CDN enabled.

# TODO

* Finish writing test cases

** theoretical limit