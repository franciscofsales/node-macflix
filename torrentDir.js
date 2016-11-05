const clivas = require('clivas');
const numeral = require('numeral');
const Table = require('easy-table');
const parseTorrent = require('parse-torrent');
const PirateBay = require('thepiratebay');
const YtsClient = require('yts-client');
const ytsClient = new YtsClient();
const eztv = require('eztv');
const YifyQuery = require('yify-query');

const searchShows = (source, searchTerm, callback) => {
  eztv.getShows({ query: searchTerm }, (error, results) => {
    console.log(error);
    console.log(results);
    callback(error, results);
  });
}

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
  else if(source == 'yts'){
    const selector = {
      pageIndex: 0, // [1, 50]
      pageSize: 12 ,
      rating_min: 5, // [0, 9]
      term: '', // match with name, actorm director
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
  else if(source == 'yify'){
    YifyQuery('', (error, result) => {
      return callback(error, result);
    });
  }
}

const bytes = (num) => numeral(num).format('0.0b');


const search = (source, searchTerm, callback) => {
  if(source == 'pirateBay'){
    const options = {
      category: 'video',
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
  else if(source == 'eztv'){
    searchShows(source, searchTerm, callback);
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
          name:`${torrent.name}`,
          seeders: subTorrent.seeds,
          leechers: '-',
          size: subTorrent.size,
          magnetLink: subTorrent.url,
          imdb: torrent.rating,
          res: subTorrent.quality,
          year: torrent.year
        });
        total++
      });

    });
  }
  else if(source == 'yify'){

    processedTorrents = [{
      name: torrents.title_long,
      size: torrents.size,
      seeders: torrents.seeds,
      leechers: torrents.peers,
      res: torrents.quality,
      magnetLink: torrents.magnet || torrents.url
    }];

  }
  let index = 0;
  let t = new Table;

  processedTorrents.forEach((torrent) => {
    t.cell('Sel', String.fromCharCode(97+index));
    t.cell('Name', torrent.name);
    if(torrent.year) t.cell('Year', torrent.year);
    if(torrent.seeders) t.cell('seeds', torrent.seeders);
    if(torrent.leechers) t.cell('leechs', torrent.leechers);
    if(torrent.imdb) t.cell('imdb', torrent.imdb);
    if(torrent.res) t.cell('quality', torrent.res);
    t.cell('Size', bytes(torrent.size));
    t.newRow();
    index++;
  })

  clivas.write(t.toString());
  return processedTorrents;

};

module.exports.showCategories = showCategories;
module.exports.search = search;
module.exports.showTop = showTop;
module.exports.printTorrents = printTorrents;
