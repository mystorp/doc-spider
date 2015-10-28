var fs = require('fs'),
	http = require('http'),
	path = require('path'),
	urllib = require('url'),
	sqlite3 = require('sqlite3'),
	mimetype = require('mimetype'),
	dbfile = path.resolve(__dirname, process.argv[2]), db;

if(!fs.existsSync(dbfile)) {
	console.log('Database do not exists!');
	process.exit();
}

db = new sqlite3.Database(dbfile);

function initServer() {
	var httpServer = http.createServer(function(req, resp){
		var url = urllib.parse(req.url).pathname;
		db.get('select * from docs where url=?', url, function(e, o){
			if(e) {
				resp.setHeader('content-type', 'text/html');
				return resp.end('<p style="color: red">' + e.message + '</p>');
			}
			if(o) {
				resp.setHeader('content-type', o.type);
				resp.end(o.content);
			} else {
				resp.setHeader('content-type', 'text/html');
				resp.statusCode = 404;
				resp.end('Not Found');
			}
		});
	});
	httpServer.listen(3000, '0.0.0.0');
	console.log('server started !');
}

initServer();