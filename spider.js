var mimetype = require('mimetype'),
	cheerio = require('cheerio'),
	request = require('request'),
	async = require('async'),
	urllib = require('url'),
	path = require('path'),
	util = require('util'),
	fs = require('fs'),
	colors,
	jsHref = /^\s*javascript:/i,
	textTypeRe = /^text/i,
	absUrlRe = /^\s*https?:\/\//i;

colors = require('colors');

function Spider(options) {
	if(!(this instanceof Spider)) {
		throw new Error('Class can\'t be function call');
	}
	this.mergeOptions(options);
	this._pool = {/*
		url1: 0,// waiting
		url2: 1 // visited
	*/};
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
	}, parts, pathname;
	Object.keys(defaults).forEach(function(f){
		me[f] = options[f] || defaults[f];
	});
	if(!me.baseUrl) {
		throw new Error("baseUrl should be set");
	}
	//rewrite base url
	parts = urllib.parse(me.baseUrl);
	me.baseUrl = parts.protocol + '//' + parts.hostname;
	//rewrite pathname
	pathname = function(x){
		var parts = urllib.parse(x);
		return parts.pathname;
	};
	me.startUrl = me.baseUrl + pathname(me.startUrl);
	me.acceptUrls = me.acceptUrls.map(pathname).map(function(p){
		return me.baseUrl + p;
	});
	me.excludeUrls = me.excludeUrls.map(pathname).map(function(p){
		return me.baseUrl + p;
	});
};

Spider.prototype.start = function(url){
	var me = this, queue;
	url = url || me.startUrl;
	if(!url || me.queue) { return; }
	queue = async.queue(function(url, cb){
		me.get(url, function(e){
			e || (me._pool[url] = 1);
			setImmediate(cb);
		});
	}, me.limit);
	queue.push(url);
	this._pool[url] = 0;
	queue.drain = function(){
		console.log("ok, all task was completed".green);
		me.destroy();
	};
	me.queue = queue;
};

Spider.prototype.get = function(url, callback){
	var me = this, req, type, opt;
	console.log('retrive link: ' + url);
	//detect mimetype, if it is binary, set response.encoding
	type = mimetype.lookup(url);
	if(type) {
		if(!textTypeRe.test(type)) {
			opt = {url: url, encoding: null};
		}
	}
	request(opt || url, function(e, resp, body){
		var ctype;
		//when error, get the url again
		if(e) {
			console.error('error on: %s, %s'.red, url, e.message);
			if(e.message.indexOf('socket hang up') > -1) {
				me.queue.push(url);
			}
			return callback(true);
		}
		//ignore none 200 response
		if(resp.statusCode !== 200) { return callback() }
		//get content-type, default to binary
		ctype = resp.headers['content-type'];
		if(!ctype) {
			ctype = mimetype.lookup(url) || mimetype.lookup('.exe');
		}
		//parse css, html, get more links
		if(ctype.indexOf("text/css") === 0) {
			me.parseCss(url, body);
		} else if(ctype.indexOf("text/html") === 0) {
			body = me.parseHtml(url, body);
		}
		me.save(url, ctype, body);
		return callback();
	});
};

Spider.prototype.parseCss = function(url, body){
	var re = /@import\s+([\w\d\-_$]+\.css);?/gi, result, i, len, links = [], parts;
	//read @import
	result = body.match(re);
	if(result) {
		for(i=0,len=result.length;i<len;i++) {
			parts = re.exec(result[i]);
			parts && links.push(urllib.resolve(url, parts[1]));
		}
	}
	//read url(xx.png)
	re = /url\(['"]?([^)]+?)['"]?\)/gi;
	result = body.match(re);
	if(result) {
		for(i=0,len=result.length;i<len;i++) {
			parts = re.exec(result[i]);
			//TODO: replace absolute path ?
			parts && links.push(urllib.resolve(url, parts[1]));
		}
	}
	links.length && this.mergeLinks(links);
};

Spider.prototype.parseHtml = function(url, body) {
	var me = this, $, dirty = false;
	$ = cheerio.load(body);
	
	me.mergeLinks($('a[href],link').map(function(i, el){
		var $el = $(el), x = $el.attr('href'), nx;
		if(x) {
			if(!jsHref.test(x)) {
				if(absUrlRe.test(x)) {
					$el.attr('href', x.replace(me.baseUrl, ''));
					dirty = true;
				} else {
					//relative path to absolute path
					x = urllib.resolve(url, x);
				}
			}
		}
		return x || url;
	}));
	me.mergeLinks($('img, script[src]').map(function(i, el){
		var $el = $(el), x = $el.attr('src');
		if(absUrlRe.test(x)) {
			$el.attr('src', x.replace(me.baseUrl, ''));
			dirty = true;
		} else {
			//relative path to absolute path
			x = urllib.resolve(url, x);
		}
		return url;
	}));
	
	$('style').each(function(i, el){
		var text = $(el).text();
		text && me.parseCss(url, text);
	});

	if(dirty) {
		return $.html();
	} else {
		return body;
	}
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
	var me = this, pool = this._pool, q = me.queue, url, i, len, parts;
	if(!links.length) { return }
	for(i=0,len=links.length;i<len;i++) {
		url = links[i];
		parts = urllib.parse(url);
		//ignore urls with hash
		if(parts.hash) { continue; }
		//check exists
		if(url in pool) {
			continue;
		}
		if(me.accept(url)) {
			pool[url] = 0;
			q.push(url);
		}
	}
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
			}
		}
	});
	//make sqlite3 write faster
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