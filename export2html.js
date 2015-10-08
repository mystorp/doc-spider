var fs = require('fs'),
	path = require('path'),
	async = require('async'),
	jsdom = require('jsdom'),
	sqlite3 = require('sqlite3'),
	mkdirs = require('mkdirs'),
	db = new sqlite3.Database(path.join(__dirname, "docs.db")),
	tmpldata = fs.readFileSync(path.join(__dirname, 'tmpl.html'), {encoding: 'utf-8'}),
	targetDirectory = process.argv[2],
	dirstat = fs.lstatSync(targetDirectory),
	srcPrefix = path.join(__dirname, 'static');

if(!dirstat.isDirectory()) {
	throw new Error("Usage: node %s targetDirectory", __filename);
}

function count(str, sub) {
	var sum = 0, i = 0, len = str.length, pos = 0;
	while(i < len) {
		i = str.indexOf(sub, pos);
		if(i > -1) {
			sum++;
			pos = i + sub.length;
		} else {
			break;
		}
	}
	return sum;
}

db.each('select * from docs', function(e, o) {
	var file = targetDirectory + (o.url === '/' ? '/index' : o.url) + ".html", html;
	html = tmpldata.replace(/\/static\//g, new Array(count(o.url, '/')).join('../'));
	html = html.replace(/\{(\w+)\}/g, function(_, k){ return o[k] });
	jsdom.env(html, function(e, window){
		var doc, links;
		if(e) {
			throw e;
		}
		doc = window.document;
		links = doc.querySelectorAll('a');
		links = [].slice.call(links);
		links.forEach(function(a){
			var href = a.getAttribute('href'), i, parts;
			if(href && !href.startsWith('http') && !href.endsWith('.html')) {
				i = href.indexOf('#');
				if(i === 0) { return; }
				if(i > -1) {
					parts = href.split('#');
					parts[0] += '.html';
					a.setAttribute('href', parts.join('#'));
				} else {
					a.setAttribute('href', href + ".html");
				}
			}
		});
		mkdirs(path.dirname(file));
		console.log('write %s to %s', o.url, file);
		fs.writeFileSync(file, jsdom.serializeDocument(doc));
		window.close();
	});
});

function walk(dir) {
	var files = fs.readdirSync(dir);
	files.forEach(function(f){
		var src = path.join(dir, f), stat = fs.lstatSync(src), dest = path.join(targetDirectory, src.replace(srcPrefix, ''));
		if(stat.isFile()) {
			fs.createReadStream(src).pipe(fs.createWriteStream(dest));
			//console.log('copy %s to %s', src, dest);
		} else if(stat.isDirectory()) {
			fs.existsSync(dest) || fs.mkdirSync(dest);
			//console.log('mkdir ' + dest);
			walk(src)
		}
	})
}

walk(srcPrefix);