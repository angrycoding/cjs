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

	var messageBusPath = uriResolve('slib/MessageBus.js', extensionPath);


	function fetched(uri, data) {

		REQUIRE_CACHE[uri].data = data.replace(/#require\s*\((.+)\)/g, function(match, requirePath) {
			
			requirePath = uriResolve(requirePath.slice(1, -1), uri);

			var baseName = requirePath.split('/').pop();
			if (baseName.match(/^[a-z]+$/i)) {
				baseName = baseName.toLowerCase();
				requirePath = `${extensionPath}cjs/modules/${baseName}/main.js`;
				console.info('NAMED_IMPORT', requirePath);
				// check if module present in registry
			}


			var extName = requirePath.split('.').pop();

			if (!requirePath.startsWith(extensionPath) ||
				!['html', 'css', 'tpl', 'js'].includes(extName)) {
				return `(function(){throw 'invalid require path ${JSON.stringify(requirePath)}'})()`;
			}

			if (extName === 'html') {
				return JSON.stringify(requirePath);
			}

			if (extName === 'css') {
				var linkEl = document.createElement('link');
				linkEl.setAttribute('rel', 'stylesheet');
				linkEl.setAttribute('href', requirePath);
				document.documentElement.appendChild(linkEl);
				return '';
			}

			if (extName === 'tpl') {
				doFetch(messageBusPath);
				return `(function(ret, context) {
					GET_PRELOADED(${JSON.stringify(messageBusPath)})
					.sendToBackground('@histoneRender', [${JSON.stringify(requirePath)}, context], ret);
				})`;
			}

			doFetch(requirePath);
			return `GET_PRELOADED(${JSON.stringify(requirePath)})`;
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





	function doExecute(uri) {
		var cacheEntry = REQUIRE_CACHE[uri];
		if (!cacheEntry.ready) {
			cacheEntry.ready = true;
			try { cacheEntry.data = new Function('GET_PRELOADED', cacheEntry.data)(doExecute); }
			catch (exception) { cacheEntry.data = undefined; console.error(uri, exception); }
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