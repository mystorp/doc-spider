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
	absUrlRe = /^\s*https?:\/\//i,
	fere = /\.(?:css|js|woff2|jpg|jpeg|gif|png)$/i;

colors = require('colors');

request = request.defaults({followRedirect: false});

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
		baseUrl: '',
		extraLinks: []
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
	me.domain = parts.hostname;
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
	me._pool[url] = 0;
	//如果某些资源是使用 JS 动态加载的，找到这些资源放在
	// extraLinks 里面
	if(me.extraLinks.length) {
		me.extraLinks.forEach(function(url){
			queue.push(url);
			me._pool[url] = 0;
		});
	}
	queue.drain = function(){
		console.log("ok, all task was completed".green);
		me.destroy();
	};
	me.queue = queue;
};

Spider.prototype.get = function(url, callback){
	var me = this, req, type, opt;
	//如果是做了标记的跨域链接，处理一下
	if(url.charAt(0) === 'x') {
		url = url.substring(1);
	}
	//detect mimetype, if it is binary, set response.encoding
	type = mimetype.lookup(url);
	if(type) {
		if(!textTypeRe.test(type)) {
			opt = {url: url, encoding: null};
		}
	}
	console.log('retrive link: ' + url);
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

//TODO:处理这种情况：如果CSS文件中引用的图片，字体等文件为绝对链接
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
	var me = this, $, dirty = false, protocol, props;
	$ = cheerio.load(body);
	//处理类似这种 "//cdn.taobao.com/xx.js"，自动补全协议
	protocol = url.substring(0, url.indexOf(':') + 1);
	//不同的 tag 对应的链接属性
	props = {a: 'href', link: 'href', img: 'src', script: 'src'};
	//获取所有链接并解析
	me.mergeLinks($('a,link,img,script').map(function(i, el){
		var $el = $(el), key = props[el.tagName], x = $el.attr(key), xs;
		//对于锚链接、空图片和脚本段，它们没有链接，忽略掉
		if(!x) { return url; }
		//忽略 <a href="javascript:xyz"></a>
		if(jsHref.test(x)) { return url; }
		//替换为当前协议
		if(x.indexOf('//') === 0) {
			x = protocol + x;
		}
		if(absUrlRe.test(x)) {
			xs = urllib.parse(x);
			//如果是同域下的资源，强制修改为相对链接
			if(xs.hostname === me.domain) {
				$el.attr(key, xs.path);//此处不用 pathname 是为了保留可能的参数，下同
				dirty = true;
			} else if(fere.test(xs.pathname)) {
				//对于跨域的资源，如：CSS，JS，图片，字体，修改为相对于当前域的路径
				//保存的时候自动存储为当前域路径
				$el.attr(key, xs.path);
				//此资源为跨域资源，告诉 #accept 这个资源需要抓取
				x = 'x' + x;
				dirty = true;
			} else {
				//忽略跨域链接
			}
		} else {
			//相对链接转换为绝对链接
			x = urllib.resolve(url, x);
		}
		return x;
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
	//如果不是当前域下的资源，必须
	if(url.indexOf(this.baseUrl) !== 0) {
		if(url.charAt(0) === 'x') {
			return true;
		} else {
			return false;
		}
	}
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