var request = require('request'),
	async = require('async'),
	jsdom = require('jsdom'),
	urllib = require('url'),
	path = require('path'),
	util = require('util'),
	fs = require('fs'),
	colors;

colors = require('colors');

function Spider(options) {
	if(!(this instanceof Spider)) {
		throw new Error('Class can\'t be function call');
	}
	this.mergeOptions(options);
	this._visited = [];
	this.initDB();
}

Spider.prototype.mergeOptions = function(options) {
	var me = this, defaults = {
		name: 'docs',
		limit: 20,
		acceptUrls: [],
		excludeUrls: [],
		startUrl: '',
		baseUrl: ''
	};
	Object.keys(defaults).forEach(function(f){
		me[f] = options[f] || defaults[f];
	});
	if(!me.baseUrl) {
		throw new Error("baseUrl should be set");
	}
	me.acceptUrls = me.acceptUrls.map(function(p){
		if(p.startsWith('/')) {
			return urllib.resolve(me.baseUrl, p);
		} else {
			return p;
		}
	});
	me.excludeUrls = me.excludeUrls.map(function(p){
		if(p.startsWith('/')) {
			return urllib.resolve(me.baseUrl, p);
		} else {
			return p;
		}
	});
	if(me.startUrl.startsWith('/')) {
		me.startUrl = urllib.resolve(me.baseUrl, me.startUrl);
	}
};

Spider.prototype.start = function(url){
	var me = this, queue;
	url = url || me.startUrl;
	if(!url || me.queue) { return; }
	queue = async.queue(function(url, cb){
		me.get(url, function(){
			me._visited.push(url);
			cb(null);
		});
	}, me.limit);
	queue.push(url);
	queue.drain = function(){
		me.destroy();
	};
	me.queue = queue;
};

Spider.prototype.get = function(url, callback){
	var me = this, req;
	if(me._visited.indexOf(url) > -1) { return callback(); }
	console.log('retrive link: ' + url);
	request(url, function(e, resp, body){
		var ctype;
		if(e) {
			console.error('error on: %s, %s'.red, url, e.message);
			return callback(null);
		}
		ctype = resp.headers['content-type'];
		if(!ctype) {
			ctype = mimetype.lookup(url) || mimetype.lookup('.exe');
		}
		if(ctype.startsWith("text/css")) {
			me.parseCss(url, body);
		} else if(ctype.startsWith("text/html")) {
			me.parseHtml(url, body);
		}
		me.save(url, ctype, body);
		return callback();
	});
};

Spider.prototype.parseCss = function(url, body){
	var re = /@import\s+([\w\d\-_$]+\.css);?/gi, result, i, len, links = [], tmp;
	//read @import
	result = body.match(re);
	if(result) {
		for(i=0,len=result.length;i<len;i++) {
			tmp = re.exec(result[i]);
			tmp && links.push(urllib.resolve(url, tmp[1]));
		}
	}
	//read url(xx.png)
	re = /url\(['"]?([^)]+?)['"]?\)/gi;
	result = body.match(re);
	if(result) {
		for(i=0,len=result.length;i<len;i++) {
			tmp = re.exec(result[i]);
			tmp && links.push(urllib.resolve(url, tmp[1]));
		}
	}
	links.length && this.mergeLinks(url, links);
};

Spider.prototype.parseHtml = function(url, body) {
	var me = this, doc = jsdom.jsdom(body), links, styles, slice = [].slice;
	//<a/>
	links = slice.call(doc.querySelectorAll('a'), 0);
	me.mergeLinks(url, links.map(function(a){ return a.href||'' }));
	//<img/>
	links = slice.call(doc.querySelectorAll('img'), 0);
	me.mergeLinks(url, links.map(function(img){ return img.src||'' }));
	//<script/>
	links = slice.call(doc.querySelectorAll('script'), 0);
	me.mergeLinks(url, links.map(function(script){ return script.src||'' }));
	//read <link/>
	links = slice.call(doc.querySelectorAll('link'), 0);
	me.mergeLinks(url, links.map(function(lnk){ return lnk.href||'' }));
	//<style/>
	styles = slice.call(doc.querySelectorAll('style'), 0);
	styles.forEach(function(s){ me.parseCss(url, s.innerHTML) });
};

Spider.prototype.save = function(url){
	var args = [].slice.call(arguments, 0), parts = urllib.parse(url);
	args[0] = parts.pathname;
	this.db.run('insert into docs(url, type, content) values(?,?,?)', args, function(e){
		if(e) {
			console.log(e.message.red);
		}
	});
};

Spider.prototype.mergeLinks = function(base, links){
	var me = this, pool = {}, url, i, len, parts;
	for(i=0,len=links.length;i<len;i++) {
		url = links[i];
		parts = urllib.parse(url);
		if(parts.hash) { continue; }
		if(!url.startsWith('http')) {
			url = urllib.resolve(base, url);
		}
		if(me.accept(url)) {
			if(!(url in pool)) {
				pool[url] = '';
			}
		}
	}
	for(i=0,len=me._visited;i<len;i++) {
		url = me._visited[i];
		if(url in pool) {
			delete pool[url];
		}
	}

	Object.keys(pool).forEach(function(url){
		me.queue.push(url);
	});
};

Spider.prototype.accept = function(url){
	var urls = this.excludeUrls, i, len, x;
	if(typeof url !== "string") { return false; }
	if(!url.startsWith(this.baseUrl)) { return false; }
	for(i=0,len=urls.length;i<len;i++) {
		if(url.startsWith(urls[i])) {
			return false;
		}
	}
	urls = this.acceptUrls;
	if(urls.length === 0) { return true; }
	for(i=0,len=urls.length;i<len;i++) {
		if(url.startsWith(urls[i])) {
			return true;
		}
	}
	return false;
};

Spider.prototype.initDB = function(){
	var me = this, sqlite3 = require('sqlite3'), db, file = path.join(__dirname, me.name + '.db'), createTable;
	db = new sqlite3.Database(file);
	createTable = function(){
		var sql = fs.readFileSync(path.join(__dirname, 'docs.sql'), {encoding: 'ascii'});
		db.exec(sql);
	};
	db.get('select tbl_name from sqlite_master where type=? and tbl_name=?', ['table', 'docs'], function(e, row){
		if(e) {
			throw e;
		} else {
			if(!row) {
				createTable();
			} else {
				console.log('[ok] table `docs` exists!');
				db.all('select url from docs', function(e, rows){
					var tmp;
					if(rows && rows.length) {
						rows = rows.map(function(o){ return urllib.resolve(me.baseUrl, o.url); });
						tmp = me._visited;
						me._visited = rows;
						tmp.length && me._visited.push.apply(me._visited, tmp);
					}
				});
			}
		}
	});
	db.run('PRAGMA synchronous=OFF');
	me.db = db;
};

Spider.prototype.destroy = function(){
	this.db.close();
	if(this.onDestroy) {
		this.onDestroy();
	}
};

module.exports = Spider;

function main() {
	var argv = process.argv, rule = argv[2], config, spider;
	if(!rule) {
		cosnole.log("Usage: node %s rule_file", __filename);
		process.exit();
	}
	config = require(path.resolve(__dirname, rule.replace(/\\/g, '/')));
	spider = new Spider(config);
	spider.start();
	process.on('exit', function(){
		spider.destroy();
	});
}

if(module === require.main) {
	main();
}