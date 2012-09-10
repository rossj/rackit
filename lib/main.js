var Rackit = require('./rackit.js');

exports.Rackit = Rackit;
exports.create = function(options) {
	return new Rackit(options);
};

function fixThis(method, o) {
	return function() {
		return  method.apply(o, arguments);
	};
}
exports.init = function(options, cb) {
	var rackit = new Rackit(options);
	exports.add = fixThis(rackit.add, rackit);
	exports.get = fixThis(rackit.get, rackit);
	exports.remove = fixThis(rackit.remove, rackit);
	exports.setMeta = fixThis(rackit.setMeta, rackit);
	exports.getMeta = fixThis(rackit.getMeta, rackit);
	exports.getURI = fixThis(rackit.getURI, rackit);
	
	rackit.init(cb);
};