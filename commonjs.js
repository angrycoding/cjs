(function() {

	var extensionPath = (function() {
		try { return `chrome-extension://${chrome.runtime.id}/` }
		catch (exception) {}
		return '';
	})();
	
	var DOUBLE_SLASH = /\/\//g,
		TRAILING_FRAGMENT = /([^\/]*)$/,
		REGEXP_ESCAPE = /([.?*+^$[\]\\(){}|-])/g,
		URL_PARSER_REGEXP = /^(([^:\/?#]+):)?(\/\/([^\/?#]*))?([^?\#]*)(\?([^#]*))?(#(.*))?/;

	function pushUnique(array, value) {
		if (array.includes(value)) return;
		array.push(value);
	}

	function removeDotSegments(path) {

		if (path === '/') return '/';

		var up = 0, out = [],
			segments = path.split('/'),
			leadingSlash = (path[0] === '/' ? '/' : ''),
			trailingSlash = (path.slice(-1) === '/' ? '/' : '');

		while (segments.length) switch (path = segments.shift()) {
			case '': case '.': break;
			case '..': if (out.length) out.pop(); else up++; break;
			default: out.push(path);
		}

		if (!leadingSlash) {
			while (up--) out.unshift('..');
			if (!out.length) out.push('.');
		}

		return (leadingSlash + out.join('/') + trailingSlash);
	}

	function uriParse(uri) {
		if (typeof uri !== 'string') return {};
		var result = uri.match(URL_PARSER_REGEXP);
		return {
			scheme: result[1] ? result[2] : null,
			authority: result[3] ? result[4] : null,
			path: result[5],
			query: result[6] ? result[7] : null,
			fragment: result[8] ? result[9] : null
		};
	}

	function uriResolve(relURI, baseURI) {

		var absURI = '', absScheme,
			absAuthority, absPath,
			absQuery, absFragment,
			relURI = uriParse(relURI),
			baseURI = uriParse(baseURI),
			relScheme = relURI.scheme,
			relAuthority = relURI.authority,
			relPath = relURI.path,
			relQuery = relURI.query,
			relFragment = relURI.fragment,
			baseScheme = baseURI.scheme,
			baseAuthority = baseURI.authority,
			basePath = baseURI.path,
			baseQuery = baseURI.query;

		if (typeof relScheme === 'string') {
			absScheme = relScheme;
			absAuthority = relAuthority;
			absPath = relPath;
			absQuery = relQuery;
			absFragment = relFragment;
		}

		else if (typeof relAuthority === 'string') {
			absScheme = baseScheme;
			absAuthority = relAuthority;
			absPath = relPath;
			absQuery = relQuery;
			absFragment = relFragment;
		}

		else if (relPath === '') {
			absScheme = baseScheme;
			absAuthority = baseAuthority;
			absPath = basePath;
			absQuery = (typeof relQuery === 'string' ? relQuery : baseQuery);
			absFragment = relFragment;
		}

		else if (relPath[0] === '/') {
			absScheme = baseScheme;
			absAuthority = baseAuthority;
			absPath = relPath;
			absQuery = relQuery;
			absFragment = relFragment;
		}

		else if (typeof baseAuthority === 'string' && basePath === '') {
			absScheme = baseScheme;
			absAuthority = baseAuthority;
			absPath = ('/' + relPath);
			absQuery = relQuery;
			absFragment = relFragment;
		}

		else {
			absScheme = baseScheme;
			absAuthority = baseAuthority;
			absPath = basePath.replace(TRAILING_FRAGMENT, '') + relPath;
			absQuery = relQuery;
			absFragment = relFragment;
		}

		if (typeof absScheme === 'string') absURI += (absScheme.toLowerCase() + ':');
		if (typeof absAuthority === 'string') absURI += ('//' + absAuthority);
		absURI += removeDotSegments(absPath.replace(DOUBLE_SLASH, '/'));
		if (absQuery) absURI += ('?' + absQuery);
		if (absFragment) absURI += ('#' + absFragment);

		return absURI;
	}

	var loadingCounter = 0;
	var REQUIRE_CACHE = {};

	function fetched(uri, data) {

		REQUIRE_CACHE[uri].data = data.replace(/#require\s*\((.+)\)/g, function(match, requirePath) {

			requirePath = requirePath.slice(1, -1).split('!');
			var extraData = requirePath.slice(1).join('!');
			requirePath = requirePath[0];


			if (requirePath.match(/^[a-z]+$/i)) {
				requirePath = `${extensionPath}cjs/modules/${requirePath}/main.js`;
			} else {
				requirePath = uriResolve(requirePath, uri);
			}
			

			// if (requirePath.includes('!')) {
				// requirePath = requirePath.split('!');
				// extraData = requirePath.slice(1).join('!');
				// requirePath = requirePath[0];
			// }

			if (!requirePath.endsWith('.js')) requirePath += '.js';

			// if (requirePath.split('.').pop() !== 'js') {
			// 	return `(function(){throw 'invalid require path ${JSON.stringify(requirePath)}'})()`;
			// }



			doFetch(requirePath);

			if (extraData) {
				return `GET_PRELOADED(${JSON.stringify(requirePath)}, ${JSON.stringify(uri)}, ${JSON.stringify(extraData)})`;
			}

			else {
				return `GET_PRELOADED(${JSON.stringify(requirePath)}, ${JSON.stringify(uri)})`;
			}

		});

		if (!--loadingCounter) bootDone();
	}

	function doFetch(uri, isTopLevel) {
		
		uri = uriResolve(uri, extensionPath);

		if (REQUIRE_CACHE.hasOwnProperty(uri)) return;

		loadingCounter++;
		
		REQUIRE_CACHE[uri] = {ready: false, toplevel: !!isTopLevel};

		console.info('[LOADING]', uri);

		fetch(uri)
		.then(response => response.text())
		.then(text => fetched(uri, text))
		.catch(() => fetched(uri, ''));
	}





	function doExecute(uri, callerURI, extraData) {

		var cacheEntry = REQUIRE_CACHE[uri];
		
		if (!cacheEntry.ready) {
			cacheEntry.ready = true;
			try { cacheEntry.data = new Function('GET_PRELOADED', cacheEntry.data)(doExecute); }
			catch (exception) { cacheEntry.data = undefined; console.error(uri, exception); }
		}

		if (extraData && typeof cacheEntry.data === 'function') {
			return cacheEntry.data(callerURI, extraData);
		}

		return cacheEntry.data;
	}

	function bootDone() {
		for (var uri in REQUIRE_CACHE) {
			if (!REQUIRE_CACHE.hasOwnProperty(uri)) continue;
			var item = REQUIRE_CACHE[uri];
			if (!item.toplevel) continue;
			doExecute(uri);
		}
	}

	window.onerror = function(message, uri) {
		if (message.includes('Uncaught SyntaxError: Invalid or unexpected token')) {
			doFetch(uri, true);
			return true;
		}
	};

})();