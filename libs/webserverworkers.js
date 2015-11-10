/**
 * Created by Gery on 28/08/15.
 */
var net = require('net');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var PassThrough = require('stream').PassThrough;
var Writable = require('stream').Writable;
var protocol = require('./protocol');
var Endpoint = protocol.Endpoint;
var http = require('http');

var deprecatedHeaders = [
    'connection',
    'host',
    'keep-alive',
    'proxy-connection',
    'te',
    'transfer-encoding',
    'upgrade'
];

function noop() {}
var defaultLogger = {
    fatal: noop,
    error: noop,
    warn : noop,
    info : noop,
    debug: noop,
    trace: noop,

    child: function() { return this; }
};


function InMessage(stream) {

    PassThrough.call(this);
    stream.pipe(this);
    this.socket = stream;
    this.stream = stream;

    this.log = stream._log.child({ component: 'http' });

    this.httpVersion = '2.0';
    this.httpVersionMajor = 2;
    this.httpVersionMinor = 0;

    this.headers = {};
    this.trailers = undefined;
    this.lastHeadersSeen = undefined;

    stream.once('headers', this.onHeaders.bind(this));
    stream.once('end', this.onEnd.bind(this));
}

InMessage.prototype = Object.create(PassThrough.prototype, { constructor: { value: InMessage } });

InMessage.prototype.onHeaders = function onHeaders(headers) {

    this.validateHeaders(headers);

    for (var name in headers) {
        if (name[0] !== ':') {
            this.headers[name] = headers[name];
        }
    }

    var self = this;
    this.stream.on('headers', function(headers) {
        self.lastHeadersSeen = headers;
    });
};

InMessage.prototype.onEnd = function onEnd() {
    this.trailers = this.lastHeadersSeen;
};

InMessage.prototype.checkHeader = function checkHeader(key, value) {
    if ((typeof value !== 'string') || (value.length === 0)) {
        this.log.error({ key: key, value: value }, 'Invalid or missing special header field');
        this.stream.reset('PROTOCOL_ERROR');
    }
    return value;
};

InMessage.prototype.validateHeaders = function validateHeaders(headers) {

    for (var i = 0; i < deprecatedHeaders.length; i++) {
        var key = deprecatedHeaders[i];
        if (key in headers) {
            this.log.error({ key: key, value: headers[key] }, 'Deprecated header found');
            this.stream.reset('PROTOCOL_ERROR');
            return;
        }
    }

    for (var headerName in headers) {

        if (headerName.length <= 1) {
            this.stream.reset('PROTOCOL_ERROR');
            return;
        }
        if(/[A-Z]/.test(headerName)) {
            this.stream.reset('PROTOCOL_ERROR');
            return;
        }
    }
};

function OutMessage() {
    Writable.call(this);
    this.headers = {};
    this.trailers = undefined;
    this.headersSent = false;

    this.on('finish', this.finish);
}

OutMessage.prototype = Object.create(Writable.prototype, { constructor: { value: OutMessage } });

OutMessage.prototype.write = function write(chunk, encoding, callback) {
    if (this.stream) {
        this.stream._write(chunk, encoding, callback);
    } else {
        this.once('socket', this.write.bind(this, chunk, encoding, callback));
    }
};

OutMessage.prototype.finish = function finish() {
    if (this.stream) {
        if (this.trailers) {
            if (this.request) {
                this.request.addTrailers(this.trailers);
            } else {
                this.stream.headers(this.trailers);
            }
        }
        this.stream.end();
    } else {
        this.once('socket', this.finish.bind(this));
    }
};

OutMessage.prototype.setHeader = function setHeader(name, value) {
    if (this.headersSent) {
        throw new Error('Can\'t set headers after they are sent.');
    } else {
        name = name.toLowerCase();
        if (deprecatedHeaders.indexOf(name) !== -1) {
            throw new Error('Cannot set deprecated header: ' + name);
        }
        this.headers[name] = value;
    }
};

OutMessage.prototype.removeHeader = function removeHeader(name) {
    if (this.headersSent) {
        throw new Error('Can\'t remove headers after they are sent.');
    } else {
        delete this.headers[name.toLowerCase()];
    }
};

OutMessage.prototype.getHeader = function getHeader(name) {
    return this.headers[name.toLowerCase()];
};

OutMessage.prototype.addTrailers = function addTrailers(trailers) {
    this.trailers = trailers;
};

OutMessage.prototype.checkHeader = InMessage.prototype.checkHeader;

exports.Server = Server;
exports.InRequest = InRequest;
exports.OutResponse = OutResponse;
exports.ServerResponse = OutResponse;

function Server(options){
    this.log = (options.log || defaultLogger).child({ component: 'http' });
    this.settings = options.settings;
    this.options = options;
    var start = this.start.bind(this);

    this.server = net.createServer(start);
    this.server.on('close', this.emit.bind(this, 'close'));
}

Server.prototype = Object.create(EventEmitter.prototype, { constructor: { value: Server } });

Server.prototype.start = function start(socket){

    var endpoint = new Endpoint(this.log, 'SERVER', this.settings);


    this.log.info({ e: endpoint,
        client: socket.remoteAddress + ':' + socket.remotePort,
        SNI: socket.servername
    });

    endpoint.pipe(socket).pipe(endpoint);

    var myserver = this;
    var myOptions = this.options;
    endpoint.on('stream', function _onStream(stream) {
        var response = new OutResponse(stream , myOptions);
        var request = new InRequest(stream);

        request.once('ready', myserver.emit.bind(myserver, 'request', request, response));
    });


    socket.on('error', this.emit.bind(this, 'clientError'));

    this.emit('connection', socket, endpoint);
};

Server.prototype.listen = function listen(port, hostname) {
    this.log.info({ on: ((typeof hostname === 'string') ? (hostname + ':' + port) : port) });
    this.server.listen.apply(this.server, arguments);

};

Server.prototype.close = function close(callback) {
    this.log.info('Closing server');
    this.server.close(callback);
};

function createServer(options, requestListener) {
    if (typeof options === 'function') {
        requestListener = options;
        options = {};
    }

    var server = new Server(options);

    if (requestListener) {
        server.on('request', requestListener);
    }

    return server;
}

exports.createServer = createServer;


function InRequest(stream){
    InMessage.call(this, stream);
}

InRequest.prototype = Object.create(InMessage.prototype, { constructor: { value: InRequest } });


InRequest.prototype.onHeaders = function onHeaders(headers){

    this.method = this.checkHeader(':method'   , headers[':method']);
    this.scheme = this.checkHeader(':scheme'   , headers[':scheme']);
    this.host   = this.checkHeader(':authority', headers[':authority']);
    this.url    = this.checkHeader(':path'     , headers[':path']);

    this.headers.host = this.host;
    InMessage.prototype.onHeaders.call(this, headers);

    this.log.info({ method: this.method, scheme: this.scheme, host: this.host,
        path: this.url, headers: this.headers },'Incoming request');

    this.emit('ready');
};

function OutResponse(stream , options){
    OutMessage.call(this);
    this.log = stream._log.child({ component: 'http' });

    this.stream = stream;
    this.statusCode = 200;
    this.sendDate = true;
    this.headers = options.headers;

    this.stream.once('headers', this.onRequestHeaders.bind(this));
}

OutResponse.prototype = Object.create(OutMessage.prototype, { constructor: { value: OutResponse } });

OutResponse.prototype.writeHead = function writeHead(statusCode, headers) {

    if (this.headersSent) {
        return;
    }

    for (var name in headers) {
        this.setHeader(name, headers[name]);
    }
    headers = this.headers;

    if (this.sendDate && !('date' in this.headers)) {
        headers.date = (new Date()).toUTCString();
    }

    this.log.info({ status: statusCode, headers: this.headers }, 'Sending server response');

    headers[':status'] = this.statusCode = statusCode;

    this.stream.headers(headers);
    this.headersSent = true;
};


OutResponse.prototype.implicitHeaders = function implicitHeaders() {
    if (!this.headersSent) {
        this.writeHead(this.statusCode);
    }
};

OutResponse.prototype.write = function write() {
    this.implicitHeaders();
    return OutMessage.prototype.write.apply(this, arguments);
};

OutResponse.prototype.end = function end() {
    this.implicitHeaders();
    return OutMessage.prototype.end.apply(this, arguments);
};

OutResponse.prototype.onRequestHeaders = function onRequestHeaders(headers) {
    this.requestHeaders = headers;
};

OutResponse.prototype.push = function push(options) {
    if (typeof options === 'string') {
        options = url.parse(options);
    }

    var promise = util._extend({
        ':method': (options.method || 'GET').toUpperCase(),
        ':scheme': (options.protocol && options.protocol.slice(0, -1)) || this.requestHeaders[':scheme'],
        ':authority': options.hostname || options.host || this.requestHeaders[':authority'],
        ':path': options.path
    }, options.headers);

    this.log.info({ method: promise[':method'], scheme: promise[':scheme'],
        authority: promise[':authority'], path: promise[':path'],
        headers: options.headers },'Promising push stream');


    var pushStream = this.stream.promise(promise);

    return new OutResponse(pushStream , options);
};

OutResponse.prototype.on = function on(event, listener) {

    OutMessage.prototype.on.call(this, event, listener);
};

exports.InResponse = InRequest;
