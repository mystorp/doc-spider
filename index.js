var fs = require('fs'),
	http = require('http'),
	path = require('path'),
	urllib = require('url'),
	cookie = require('cookie'),
	sqlite3 = require('sqlite3'),
	mimetype = require('mimetype'),
	docs = {};

function initDatabases() {
	var files = fs.readdirSync(__dirname),
		dbre = /\.db$/i,
		params = {names: []},
		cache;
	files = files.filter(function(f){
		return dbre.test(f);
	});
	if(!files.length) {
		throw new Error('no database was found!');
	}
	files.forEach(function(f){
		var name = f.substring(0, f.length - 3);
		console.log('find db:', f);
		params.names.push(name);
		docs[name] = true;
	});
	params.names = params.names.join(',');
	cache = fs.readFileSync(path.join(__dirname, 'default.html'), {encoding: 'utf-8'});
	cache = cache.replace(/\{(.*?)\}/g, function(_, key){
		return params[key];
	});
	docs.defaultPage = cache;
}

function initServer() {
	var preferDB = process.argv[2];
	if(preferDB) {
		if(/\.db$/i.test(preferDB)) {
			preferDB = preferDB.substring(0, preferDB.length - 3);
		}
		if(preferDB in docs) {
			console.log('set prefered database to:', preferDB);
		}
	}
	var httpServer = http.createServer(function(req, resp){
		var parts = urllib.parse(req.url, true),
			cookies = cookie.parse(req.headers.cookie || ''),
			dbname = (parts.query ? parts.query.db : null) || cookies.db || preferDB,
			db = dbname ? docs[dbname] : null;

		if(db === true) {
			db = docs[dbname] = new sqlite3.Database(path.join(__dirname, dbname + '.db'));
		}
		resp.setHeader('content-type', 'text/html');

		if(db) {
			db.get('select * from docs where url=?', parts.pathname, function(e, o){
				if(e) {
					return resp.end('<p style="color: red">' + e.message + '</p>');
				}
				if(o) {
					if(o.type.indexOf('text/html') === 0) {
						resp.setHeader('Set-Cookie', cookie.serialize('db', dbname, {domain: parts.host, path: '/'}))
					}
					resp.setHeader('content-type', o.type);
					resp.end(o.content);
				} else {
					resp.statusCode = 404;
					resp.end('Not Found');
				}
			});
		} else {
			resp.end(docs.defaultPage);
		}
	});
	httpServer.listen(3000, '0.0.0.0');
	console.log('server started !');
	console.log('visit http://127.0.0.1:3000 browse documentations');
}

initDatabases();
initServer();