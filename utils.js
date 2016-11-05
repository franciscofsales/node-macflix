const fs = require('fs');
const http = require('http');
const Promise = require('bluebird');
const request = require('request');
const zlib = require('zlib');

const parseBlocklist = (filename) => {
  let blocklistData = fs.readFileSync(filename, { encoding: 'utf8' })
  let blocklist = []
  blocklistData.split('\n').forEach( (line) => {
    let match = null
    if ((match = /^\s*[^#].*?\s*:\s*([a-f0-9.:]+?)\s*-\s*([a-f0-9.:]+?)\s*$/.exec(line))) {
      blocklist.push({
        start: match[1],
        end: match[2]
      });
    }
  });
  return blocklist;
}

const downloadFile = (url, destination, callback) => {
    let p = new Promise((resolve, reject) =>{
        let writeStream = fs.createWriteStream(destination);

        writeStream.on('finish', () => {
            resolve();
        });

        writeStream.on('error', (err) => {
            fs.unlink(destination, reject.bind(null, err));
        });

        let readStream = request.get(url);

        readStream.on('error', (err) => {
            fs.unlink(destination, reject.bind(null, err));
        });

        readStream.pipe(writeStream);
    });

    if(!callback)
        return p;

    p.then(() => {
        callback(null);
    })
    .catch((err) => {
        callback(err);
    });
};

const unzip = (filepath, destination, callback) => {
  let p = new Promise((resolve, reject) =>{
      let writeStream = fs.createWriteStream(destination);

      writeStream.on('finish', () => {
          resolve();
      });

      writeStream.on('error', (err) => {
          fs.unlink(destination, reject.bind(null, err));
      });

      let readStream = fs.createReadStream(filepath);

      readStream.on('error', (err) => {
          fs.unlink(destination, reject.bind(null, err));
      });

      readStream
        .pipe(zlib.Unzip())
        .pipe(writeStream);
  });

  if(!callback)
      return p;

  p.then(() => {
      callback(null);
  })
  .catch((err) => {
      callback(err);
  });

}

module.exports.parseBlocklist = parseBlocklist;
module.exports.downloadFile = downloadFile;
module.exports.unzip = unzip;
