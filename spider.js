var DOMParser = require('xmldom').DOMParser,
	request = require('request'),
	async = require('async'),
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
	this.parser = new DOMParser({
		locator:{},
		errorHandler:{
			warning: function(){},
			error: function(){},
			fatalError: function(){}
		}});
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
		if(p.indexOf('/') === 0) {
			return urllib.resolve(me.baseUrl, p);
		} else {
			return p;
		}
	});
	me.excludeUrls = me.excludeUrls.map(function(p){
		if(p.indexOf('/') === 0) {
			return urllib.resolve(me.baseUrl, p);
		} else {
			return p;
		}
	});
	if(me.startUrl.indexOf('/') === 0) {
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
		console.log("ok, all task was completed".green);
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
			me.save(url, 'text/plain', null);
			return callback(null);
		}
		ctype = resp.headers['content-type'];
		if(!ctype) {
			ctype = mimetype.lookup(url) || mimetype.lookup('.exe');
		}
		if(ctype.indexOf("text/css") === 0) {
			me.parseCss(url, body);
		} else if(ctype.indexOf("text/html") === 0) {
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
	var me = this, doc, links, styles, slice = [].slice, protocol;
	doc = me.parser.parseFromString(body, 'text/html');
	protocol = url.substring(0, url.indexOf(':') + 1);
	//<a/>
	links = slice.call(doc.getElementsByTagName('a'), 0);
	me.mergeLinks(links.map(function(a){
		return urllib.resolve(url, a.getAttribute('href') || '');
	}));
	//<img/>
	links = slice.call(doc.getElementsByTagName('img'), 0);
	me.mergeLinks(links.map(function(img){
		return urllib.resolve(url, img.getAttribute('src') || '');
	}));
	//<script/>
	links = slice.call(doc.getElementsByTagName('script'), 0);
	me.mergeLinks(links.map(function(script){
		return urllib.resolve(url, script.getAttribute('src') || '');
	}));
	//read <link/>
	links = slice.call(doc.getElementsByTagName('link'), 0);
	me.mergeLinks(links.map(function(lnk){
		return urllib.resolve(url, lnk.getAttribute('href') || '');
	}));
	//<style/>
	styles = slice.call(doc.getElementsByTagName('style'), 0);
	styles.forEach(function(s){ me.parseCss(url, s.innerHTML) });
	doc = null;
};

Spider.prototype.save = function(url){
	var args = [].slice.call(arguments, 0), parts = urllib.parse(url);
	args[0] = parts.pathname;
	this.db.run('insert into docs(url, type, content) values(?,?,?)', args, function(e){
		if(e) {
			if(e.message.indexOf('UNIQUE constraint failed') > -1) {
				console.log("oh, already saved this:".red, url);
			}
		}
	});
};

Spider.prototype.mergeLinks = function(links){
	var me = this, pool = {}, url, i, len, parts;
	for(i=0,len=links.length;i<len;i++) {
		url = links[i];
		if(url in pool) {
			continue;
		}
		parts = urllib.parse(url);
		if(parts.hash) { continue; }
		if(me.accept(url)) {
			pool[url] = '';
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
	if(url.indexOf(this.baseUrl) !== 0) { return false; }
	for(i=0,len=urls.length;i<len;i++) {
		if(url.indexOf(urls[i]) === 0) {
			return false;
		}
	}
	urls = this.acceptUrls;
	if(urls.length === 0) { return true; }
	for(i=0,len=urls.length;i<len;i++) {
		if(url.indexOf(urls[i]) === 0) {
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
					console.log("load urls from db over, total visited:", me._visited.length);
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
}

if(module === require.main) {
	main();
}