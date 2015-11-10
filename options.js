/**
 * Created by Gery on 28/08/15.
 */

var config = require('./conf.json');

if (!config.port || config.errorPage == ''){
    config.port = 80;
} else {
    config.port = parseInt(config.port);
}

if (!config.directory || config.errorPage == ''){
    config.directory = './public';
}

if (!config.errorPage || config.errorPage == ''){
    config.errorPage = './404.html'
}

if (!config.process){
    config.process = 1;
} else {
    config.process = parseInt(config.process);
}

if (config.headers != ''){
    var myHeaders = {};
    for( i = 0; i < config.headers.length ; i++){
        myHeaders[config.headers[i].field] = config.headers[i].content;
    }
    config.headers = myHeaders;
}
exports.config = config;