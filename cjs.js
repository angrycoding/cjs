#!/usr/bin/env node

var FS = require('fs-extra');
var Async = require('async');
var Path = require('path');
var Request = require('request');
var commandLine = require('minimist')(process.argv.slice(2));
var workingDir = process.cwd();

var cjsMainDir = Path.resolve(workingDir, 'cjs');
var cjsModulesDir = Path.resolve(cjsMainDir, 'modules');


function writeFile(path, contents, ret) {
	FS.ensureFile(path, function(error) {
		if (error) return ret(error);
		FS.writeFile(path, contents, ret);
	});
}

FS.readFile(Path.resolve(workingDir, 'cjs.json'), 'UTF-8', function(error, cjsJSON) {

	if (error) {
		console.info(error.toString());
		process.exit(1);
	}

	cjsJSON = JSON.parse(cjsJSON);
	var dependencies = cjsJSON.dependencies;

	


	Async.eachSeries(dependencies, function(module, next) {

		module = module.toLowerCase();
		console.info('downloading', module);

		Request(`https://raw.githubusercontent.com/angrycoding/cjs/master/modules/${module}/main.js`, function(error, response, body) {

			if (error) {
				console.info(error);
				return next(error);
			}
			// console.log('error:', error); // Print the error if one occurred
			// console.log('statusCode:', response && response.statusCode); // Print the response status code if a response was received

			writeFile(Path.resolve(cjsModulesDir, `${module}/main.js`), body, function(error) {
				if (error) console.info(error);
				next(error);
			});

		});


	}, function(error) {
		FS.copy(Path.resolve(__dirname, 'commonjs.js'), Path.resolve(cjsMainDir, 'commonjs.js'), function() {
			console.info('done')
		});
	})



	
		
		// FS.copy(Path.resolve(__dirname, 'jquery.js'), Path.resolve(cjsModulesDir, 'jquery/main.js'), function() {

		// });


});