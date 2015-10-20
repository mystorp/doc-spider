#doc-spider

#介绍
这个小项目的初衷是下载 chrome 插件的开发文档，不过为了代码的通用性，抽象出了 `Spider` 类，具体可参见 `spider.js` 。
项目使用 `sqlite3` 作为数据存储层，因为考虑到用文件存储的话，势必会在磁盘上建立大量的文件，不方便管理，当然更主要的是，作为一名强迫症重度患者，看着那么多HTML也是无法忍受的。从技术上来说，原本没有`.html`结尾的URL，要转换成`.html`文件也是一个没那么有用的费力活，当然，为了某些情况的需要，也添加了 `.export2html.js` 作为补充。

#如何下载开发文档
要下载某个开发文档，需要首先编写一个 `rule.json` 文件，这个文件定义了一系列在爬取条件，如：
```json
{
	"name": "openstack_docs",
	"baseUrl": "http://docs.openstack.org",
	"acceptUrls": [],
	"excludeUrls": ["/ja/", "/de/", "/fr/", "/pt_BR/", "/zh_CN/", "/ko_KR/"],
	"startUrl": "/",
	"limit": 15
}
```
* `name` 这是个必须字段。将要生成的数据库的文件名，形如这样：&lt;name&gt;.db
* `baseUrl` 这是个必须字段。baseUrl 定义需要爬取的资源的公共前缀
* `acceptUrls` 这是个可选字段。指定需要爬取的资源的 path 前缀
* `excludeUrls` 这是个可选字段。指定不需要爬取的资源的 path 前缀
* `startUrl` 这是个可选字段。指定开始从哪个 URL 开始爬取资源
* `limit` 这是个可选择字段。指定默认同时请求的数量
`rule.json` 准备好之后，就可以开始爬取了：
```js
node spider.js rule.json
```

#如何查看开发文档
文档下载完毕，就可以访问了，运行下面的命令：
```js
node index.js &lt;name&gt;.db
```
这里的 &lt;name&gt;.db 是下载开发文档时自动生成的数据库名
跑起来之后，就打开浏览器访问：`http://127.0.0.1:3000`就可以了

#需要完善的地方
* `export2html.js` 是早期编写的用于导出所有资源文件的工具，已经不适合现在的代码了，有需要的时候可以更新此文件。
* 目前生成的数据库名就在项目当前目录下面，感觉不是太好，后面考虑换个位置