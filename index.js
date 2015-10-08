var fs = require('fs'),
	http = require('http'),
	urllib = require('url'),
	sqlite3 = require('sqlite3'),
	mimetype = require('mimetype'),
	db = new sqlite3.Database(__dirname + '/docs.db');

function initServer() {
	var httpServer = http.createServer(function(req, resp){
		var url = urllib.parse(req.url).pathname;
		db.get('select * from docs where url=?', url, function(e, o){
			var file;
			if(e) {
				resp.setHeader('content-type', 'text/html');
				return resp.end('<p style="color: red">' + e.message + '</p>');
			}
			if(o) {
				resp.setHeader('content-type', o.type);
				resp.end(o.content);
			} else {
				file = __dirname + url;
				if(url.startsWith('/static') && fs.existsSync(file)) {
					resp.setHeader('content-type', mimetype.lookup(file));
					fs.createReadStream(file).pipe(resp);
				} else {
					resp.setHeader('content-type', 'text/html');
					resp.statusCode = 404;
					resp.end('Not Found');
				}
			}
		});
	});
	httpServer.listen(3000, '0.0.0.0');
	console.log('server started !');
}

initServer();