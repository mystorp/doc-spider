#!/bin/env python
# coding: utf-8
import sqlite3
from BaseHTTPServer import HTTPServer, BaseHTTPRequestHandler
import urlparse
import signal

conn = None

class DocRequestHandler(BaseHTTPRequestHandler):
	"""handle request by read resource from database"""
	def do_GET(self):
		global conn
		parts = urlparse.urlparse(self.path)
		row = conn.execute('select * from docs where url=?', (parts.path,)).fetchall()
		if len(row) > 0:
			row = row[0]
			self.send_response(200)
			self.send_header("Content-type", row[2])
			self.end_headers()
			if row[2].find('text/') == 0:
				self.wfile.write(row[3].encode('utf-8'))
			else:
				self.wfile.write(row[3])
		else:
			self.send_response(404)
			self.send_header("Content-type", "text/plain")
			self.end_headers()
			self.wfile.write('Resource Not Available');

class ArgumentException(Exception):
	pass

def start():
	server = HTTPServer(('0.0.0.0', 3000), DocRequestHandler)
	def onexit(*args):
		global conn
		print "get signal"
		conn.close()
		print "database closed"
		server.shutdown()
		print "server closed ..."
	signal.signal(signal.SIGINT, onexit)
	server.serve_forever()


if __name__ == "__main__":
	import sys
	from os.path import isfile
	dbfile = len(sys.argv) >= 2 and sys.argv[1] or '/* no args */'
	if not isfile(dbfile):
		raise ArgumentException('sqlite3 database file is need!')
	conn = sqlite3.connect(dbfile)
	start()