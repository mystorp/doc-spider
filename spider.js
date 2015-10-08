var request = require('request'),
	async = require('async'),
	jsdom = require('jsdom'),
	urllib = require('url'),
	path = require('path'),
	util = require('util'),
	fs = require('fs');

function Spider(options) {
	if(!(this instanceof Spider)) {
		throw new Error('Class can\'t be function call');
	}
	this.limit = options.limit || 10;
	this.acceptUrls = options.acceptUrls || [];
	this._visited = [];
	this.initDB();
}

Spider.prototype.start = function(url){
	var me = this, queue;
	if(me.queue) { return; }
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
			console.log('error on: %s, %s', url, e.message);
			return callback(null);
		}
		ctype = resp.headers['content-type'];
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
	re = /url\(([^)]+)\)/gi;
	result = body.match(re);
	if(result) {
		for(i=0,len=result.length;i<len;i++) {
			tmp = re.exec(result[i]);
			tmp && links.push(urllib.resolve(url, tmp[1]));
		}
	}
	links.length && me.mergeLinks(url, links);
};

Spider.prototype.parseHtml = function(url, body) {
	var me = this, doc = jsdom.jsdom(body), links, styles, slice = [].slice;
	//<a/>
	links = slice.call(doc.querySelectorAll('a'), 0);
	me.mergeLinks(url, links.map(function(a){ return a.href||'' }));
	//<img/>
	links = slice.call(doc.querySelectorAll('img'), 0);
	me.mergeLinks(url, links.map(function(img){ return img.src||'' }));
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
			console.log(e);
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
	var urls = this.acceptUrls, i, len, x;
	if(typeof url !== "string") { return false; }
	if(urls.length === 0) { return true; }
	for(i=0,len=urls.length;i<len;i++) {
		x = urls[i];
		if(typeof x === "string") {
			if(url.startsWith(x)) {
				return true;
			}
		} else if(util.isRegExp(x)) {
			if(x.test(url)) {
				return true;
			}
		}
		
	}
	return false;
};

Spider.prototype.initDB = function(){
	var sqlite3 = require('sqlite3'), db, file = path.join(__dirname, 'docs.db'), createTable;
	if(!fs.existsSync(file)) {
		createTable = function(){
			var sql = fs.readFileSync(path.join(__dirname, 'docs.sql'), {encoding: 'ascii'});
			db.exec(sql);
		};
	}
	db = new sqlite3.Database(file);
	createTable && createTable();
	db.run('PRAGMA synchronous=OFF');
	this.db = db;
};

Spider.prototype.destroy = function(){
	this.db.close();
	if(this.onDestroy) {
		this.onDestroy();
	}
};

module.exports = Spider;

function main() {
	var spider = new Spider({acceptUrls: ['https://developer.chrome.com/extensions', 'https://developer.chrome.com/apps']});
	spider.start('https://developer.chrome.com/apps/api_index');
}

if(module === require.main) {
	main();
}