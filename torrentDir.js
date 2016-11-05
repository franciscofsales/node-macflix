const clivas = require('clivas');
const parseTorrent = require('parse-torrent');
const PirateBay = require('thepiratebay');
const YtsClient = require('yts-client');
const ytsClient = new YtsClient();

const showCategories = (callback) => {
  PirateBay.getCategories()
    .then(results => callback(null, results))
    .catch(err => callback(err, null));
}

const showTop = (source, categoryId, callback) => {
  if(source == 'pirateBay'){
    PirateBay.topTorrents(categoryId)
      .then(results => callback(null, results))
      .catch(err => callback(err, null));
  }
}

const search = (source, searchTerm, callback) => {
  if(source == 'pirateBay'){
    const options = {
      category: 'all',
      filter: {
        verified: false    // default - false | Filter all VIP or trusted torrents
      },
      page: 0,            // default - 0 - 99
      orderBy: 'seeds', // default - name, date, size, seeds, leeches
      sortBy: 'desc'      // default - desc, asc
    };
    PirateBay.search(searchTerm, options)
      .then(results => callback(null, results))
      .catch(err => callback(err, null));
  }
  else if(source == 'yts'){
    const selector = {
      pageIndex: 0, // [1, 50]
      pageSize: 10 ,
      // quality: '1080p', // 720p, 1080p, 3D
      rating_min: 0, // [0, 9]
      term: searchTerm, // match with name, actorm director
      sort_by: 'seeders',
      order_by: 'desc', // desc, asc
    };
    ytsClient.find(selector, (error, items) => {
      if(error){
        return callback(error, null);
      }
      else{
        return callback(null, items);
      }
    });
  }
}

const printTorrents = (source, torrents, maxItems) => {
  let total = 0;
  let processedTorrents = [];
  if(source == 'pirateBay'){
    torrents.forEach((torrent) => {
      if(total > maxItems-1) {
        return true;
      }
      if(!torrent.magnetLink){
        return true;
      }
      processedTorrents.push(torrent);
      total++
    });
  }
  else if(source == 'yts'){
    torrents.forEach((torrent) => {
      if(total > maxItems-1) {
        return true;
      }
      if(!torrent.torrents){
        return true;
      }
      torrent.torrents.forEach((subTorrent) => {
        processedTorrents.push({
          name:`${torrent.name} ${subTorrent.quality}`,
          seeders: subTorrent.seeds,
          leechers: '-',
          size: subTorrent.size,
          magnetLink: subTorrent.url,
          imdb: torrent.rating
        });
        total++
      });

    });
  }
  let index = 0;
  processedTorrents.forEach((torrent) => {
    clivas.line(`{bold:${String.fromCharCode(97+index)}}:   {green:${torrent.name}}      {green:${torrent.seeders}}/{red:${torrent.leechers}}     imdb: {yellow:${torrent.imdb}}    {bold:${torrent.size}}`);
    index++;
  })
  return processedTorrents;

};

module.exports.showCategories = showCategories;
module.exports.search = search;
module.exports.showTop = showTop;
module.exports.printTorrents = printTorrents;
