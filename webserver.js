/**
 * Created by Gery on 28/08/15.
 */
var http2 = require('./libs/webserverworkers.js');
var config = require('./options.js').config;
var statics = require('node-static');

var files = new statics.Server(config.directory);

var server = http2.createServer(config ,function (req, res) {
    if (req.httpVersion != '2.0') {
        console.log('HTTP/2 client required');
        server.close();
    } else {
        req.addListener('end', function () {
            files.serve(req, res , function(e){
                if (e && (e.status === 404)){
                    files.serveFile(config.errorPage, 404, {}, req, res);
                }
            });
        }).resume();
    }
});

server.listen(config.port);
console.log("Server is running on http://localhost:"+config.port+"/");




