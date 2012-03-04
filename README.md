# Rackit

Rackit is a module for managing up to 3.2 bajillion** files on Rackspace Cloud Files. With Rackit, you don't have to worry about containers, CDN enabling containers, or re-authenticating when your key has expired.

Cloud Files has a recommended limit of 50,000 files per container. Rackit knows this, and will automatically create new containers as necessary.

With Rackit, you specify a container prefix, such as 'file'. Then, Rackit will create containers ['file0', 'file1', ...] as necessary.

# Install (coming soon)

    $ npm install rackit

# Usage

    var rackit = require('rackit');
    
    // Initialize with your account information
    rackit.init({
        'user' : '<your Rackspace username>',
        'key' : '<your Rackspace API key>'
    }, function(err) {
        // Add a local file to the cloud
        rackit.add('./image.jpg', function(err, sCloudPath) {
            // Get the CDN URI of the file
            console.log(rackit.getURI(sCloudPath));
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
        myRackit.add('./image.jpg', function(err, sCloudPath) {
            // Get the CDN URI of the file
            console.log(myRackit.getURI(sCloudPath));
        });
    });
    
# Options

When initializing Rackit, here are the options and defaults:

* user: '' - Your Rackspace username.
* key: '' - Your Rackspace API key.
* prefix: 'dev' - The prefix for your Cloud Files containers.
* useCDN: true - Tells Rackit whether to CDN enable new containers it creates.
* baseURI: 'https://auth.api.rackspacecloud.com/v1.0' - The API entry point. May change depending on your country.
* useSNET: false - Whether or not to use SNET for super-fast Cloud Server to Cloud File networking.
* verbose: false - If set to true, log messages will be generated.
* logger: console.log - If verbose is true, this function will recieve the log messages.

** theoretical limit