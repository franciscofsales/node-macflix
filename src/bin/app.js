#!/usr/bin/env node

const yargs = require('yargs');
const rc = require('rc');
const clivas = require('clivas');
const numeral = require('numeral');
const os = require('os');
const address = require('network-address');
const proc = require('child_process');
const macflix = require('../../');
const keypress = require('keypress');
const openUrl = require('open');
const inquirer = require('inquirer');
const parsetorrent = require('parse-torrent');
const path = require('path');
const rimraf = require('rimraf');
const opensubtitles = require("subtitler");
const Promise = require('bluebird');
const utils = require('../utils');
const TorrentService = require('../torrentDir');


process.title = 'macflix';
const validSources = [
  'pirateBay',
  'yts',
  // 'eztv',
  'yify'
];

const argv = rc('macflix', {}, yargs
  .usage('Usage: $0 <movie/series/"browse"> [options]')
  .alias('c', 'connections').describe('c', 'max connected peers').default('c', os.cpus().length > 1 ? 100 : 30)
  .alias('p', 'port').describe('p', 'change the http port').default('p', 8888)
  .alias('i', 'index').describe('i', 'changed streamed file (index)')
  .alias('l', 'language').describe('l', 'language for subtitles (eng, por)').default('l', 'eng')
  .alias('q', 'quiet').describe('q', 'be quiet').boolean('q')
  .alias('v', 'airplay').describe('v', 'autoplay via AirPlay').boolean('v')
  .alias('f', 'path').describe('f', 'change buffer file path')
  .alias('b', 'blocklist').describe('b', 'use the specified blocklist')
  .alias('a', 'all').describe('a', 'select all files in the torrent').boolean('a')
  .alias('h', 'hostname').describe('h', 'host name or IP to bind the server to')
  .alias('e', 'peer').describe('e', 'add peer by ip:port')
  .alias('x', 'peer-port').describe('x', 'set peer listening port')
  .alias('s', 'source').describe('s', 'torrent source').default('s', 'pirateBay').choices('s', validSources)
  .alias('d', 'on-top').describe('d', 'video on top').boolean('d')
  .describe('on-downloaded', 'script to call when file is 100% downloaded')
  .describe('on-listening', 'script to call when server goes live')
  .describe('version', 'prints current version').boolean('boolean')
  .argv);

if (argv.version) {
  console.error(require('../package').version);
  process.exit(0);
}

const searchTerm = argv._[0];
const onTop = !argv.d;
const torrentSource = argv.s || 'pirateBay';
let downloadedSubtitles = [];


if(validSources.indexOf(torrentSource) < 0){
  console.error('Invalid source');
  console.error('');
  console.error('Valid Sources: ');
  console.error(validSources.join(', '));
  process.exit(1);
}

let doneSetup = false;
let subTitleFile = null;

if (!searchTerm) {
  yargs.showHelp();
  console.error('Options passed after -- will be passed to your player');
  console.error('');
  console.error('  "macflix <movie/series/"browse">" ');
  console.error('');
  console.error('* Autoplay can take several seconds to start since it needs to wait for the first piece');
  process.exit(1);
}

let VLC_ARGS = `-q${(onTop ? '' : ' --video-on-top')} --play-and-exit --sub-autodetect-fuzzy=1 --sub-autodetect-path=${__dirname} `;

const enc = (s) => {
  return /\s/.test(s) ? JSON.stringify(s) : s;
}

let subTitleLang = argv.l ? enc(argv.l) : 'eng';

if (argv._.length > 1) {
  var _args = argv._;
  _args.shift();
  var playerArgs = _args.join(' ');
  VLC_ARGS += ` ${playerArgs}`;
}

const ontorrent = (torrent) => {
  if (argv['peer-port']) {
    argv.peerPort = Number(argv['peer-port']);
  }

  const engine = macflix(torrent, argv);
  let hotswaps = 0;
  let verified = 0;
  let invalid = 0;
  let downloadedPercentage = 0;

  engine.on('verify', () => {
    verified++;
    downloadedPercentage = Math.floor(verified / engine.torrent.pieces.length * 100);
  });

  engine.on('invalid-piece', () => {
    invalid++;
  });

  const bytes = (num) => numeral(num).format('0.0b');

  engine.on('hotswap', () => {
    hotswaps++;
  });

  var started = Date.now();
  var wires = engine.swarm.wires;
  var swarm = engine.swarm;

  const active = function (wire) {
    return !wire.peerChoking;
  };

  let peers = [].concat(argv.peer || []);
  peers.forEach( (peer) => {
    engine.connect(peer);
  });

  if (argv['on-downloaded']) {
    let downloaded = false;
    engine.on('uninterested', () => {
      if (!downloaded) {
        proc.exec(argv['on-downloaded']);
      }
      downloaded = true;
    });
  }

  engine.server.on('listening', () => {
    let host = argv.hostname || address();
    let href = `http://${host}:${engine.server.address().port}/`;
    let localHref = `http://localhost:${engine.server.address().port}/`;
    let filename = engine.server.index.name.split('/').pop().replace(/\{|\}/g, '');
    let filelength = engine.server.index.length;
    let player = null;
    let paused = false;
    let timePaused = 0;
    let pausedAt = null;

    if (argv.all) {
      filename = engine.torrent.name;
      filelength = engine.torrent.length;
      href += '.m3u';
      localHref += '.m3u';
    }

    argv.remove = (typeof argv.remove === 'undefined') ? true : argv.remove;

    const remove = () => {
      clivas.line('');
      clivas.line('{yellow:info} {green:macflix is exiting...}');
      if (argv.remove) {
        clivas.line('{yellow:note} {green:macflix is going to remove temporary files..}');
        rimraf(`${__dirname}/*.srt`, (err) => {});
        rimraf(`${utils.removeLastDirectoryPart(engine.path)}/*`, (err) => {
          if(err){
            clivas.line('{yellow:error} {green:macflix failed to remove the temporary files!}');
          }
          else {
            clivas.line('{yellow:note} {green:macflix removed the temporary files!}');
          }
          process.exit();
        });
      }
    }

    process.on('SIGINT', remove);
    process.on('SIGTERM', remove);

    let registry, key;

    if (!argv.airplay) {
      player = 'vlc';
      const root = '/Applications/VLC.app/Contents/MacOS/VLC';
      const home = (process.env.HOME || '') + root;

      let vlc = proc.exec(`vlc ${VLC_ARGS} ${localHref} || ${root} ${VLC_ARGS} ${localHref} || ${home} ${VLC_ARGS} ${localHref}`, (error, stdout, stderror) => {
        if (error) {
          remove();
        }
      });

      vlc.on('exit', () => {
        remove();
      });
    }
    else{
      let list = require('airplayer')();
      list.once('update', (player) => {
        list.destroy();
        player.play(href);
      });
    }

    if (argv['on-listening']) {
      proc.exec(argv['on-listening'] + ' ' + href);
    }

    if (argv.quiet) {
      return console.log('server is listening on ' + href);
    }

    process.stdout.write(new Buffer('G1tIG1sySg==', 'base64')); // clear for drawing

    const draw = () => {
      const unchoked = engine.swarm.wires.filter(active);
      let timeCurrentPause = 0;
      if (paused === true) {
        timeCurrentPause = Date.now() - pausedAt;
      }
      let runtime = Math.floor((Date.now() - started - timePaused - timeCurrentPause) / 1000);
      let linesremaining = clivas.height;
      let peerslisted = 0;

      clivas.clear();
      if (argv.airplay) {
        clivas.line('{green:streaming to} {bold:apple-tv} {green:using airplay}');
      }
      else {
        clivas.line(`{green:On} {bold:${(player || 'vlc')}} {green::} {bold:${href}} {green:as the network address}`);
      }

      clivas.line('');
      clivas.line(`{yellow:->} {green:streaming} {bold:${filename} (${bytes(filelength)})} {green:-} {bold:${bytes(swarm.downloadSpeed())}/s} {green:from} {bold:${unchoked.length}/${wires.length}} {green:peers}`);
      clivas.line(`{yellow:->} {green:path} {cyan:${engine.path}}`);
      clivas.line(`{yellow:->} {green:downloaded} {bold:${bytes(swarm.downloaded)}} (${downloadedPercentage}%) {green:and uploaded }{bold:${bytes(swarm.uploaded)}} {green:in }{bold:${runtime}s} {green:with} {bold:${hotswaps}} {green:hotswaps}`);
      clivas.line(`{yellow:->} {green:verified} {bold:${verified}} {green:pieces and received} {bold:${invalid}} {green:invalid pieces}`);
      clivas.line(`{yellow:->} {green:peer queue size is} {bold:${swarm.queued}}`);
      clivas.line('{80:}');

      clivas.line('');
      linesremaining -= 9;

      wires.every((wire) => {
        let tags = [];
        if (wire.peerChoking) {
          tags.push('choked');
        }
        clivas.line(`{25+magenta:${wire.peerAddress}} {10:${bytes(wire.downloaded)}} {10 + cyan:${bytes(wire.downloadSpeed())}/s} {15 + grey:${tags.join(', ')}}`);
        peerslisted++;
        return linesremaining - peerslisted > 4;
      });

      linesremaining -= peerslisted;

      if (wires.length > peerslisted) {
        clivas.line('{80:}');
        clivas.line(`... and ${(wires.length - peerslisted)} more`);
      }

      clivas.line('{80:}');
      clivas.flush();
    }

    setInterval(draw, 1000);
    draw();
  })

  engine.server.once('error', () => {
    engine.server.listen(0, argv.hostname);
  });

  const onmagnet = () => {
    clivas.clear();
    clivas.line(`{green:fetching torrent metadata from} {bold:${engine.swarm.wires.length}} {green:peers}`);
  };

  if (typeof torrent === 'string' && torrent.indexOf('magnet:') === 0 && !argv.quiet) {
    onmagnet();
    engine.swarm.on('wire', onmagnet);
  }

  engine.on('ready', () => {
    engine.swarm.removeListener('wire', onmagnet);
    if (!argv.all) {
      return;
    }
    engine.files.forEach((file) => {
      file.select();
    });
  });

}


const startTorrent = (magnetLink) => {
  clivas.line(`{green: starting download ...}`);
  parsetorrent.remote(magnetLink, (err, parsedtorrent) => {
    if (err) {
      console.error(err.message);
      process.exit(1);
    }
    ontorrent(parsedtorrent);
  });
}

const onSubtitleReady = (subFile) => {
  let prom = new Promise((resolve, reject) =>{
    if(subFile){
      const subFileId = subFile.IDSubtitleFile;
      clivas.line(`{green: dowloading subtitle ...}`);
      utils.downloadFile(subFile.SubDownloadLink, `${__dirname}/subtitle_${subFileId}.srt.gz`, (err) =>{
        if(err) {
          console.log(err);
          rimraf(`${__dirname}/subtitle_${subFileId}.srt.gz`, ()=>{});
          resolve(null);
        }
        else{
          clivas.line(`{green: unzipping ...}`);
          utils.unzip(`${__dirname}/subtitle_${subFileId}.srt.gz`, `${__dirname}/subtitle_${subFileId}.srt`, (err) => {
            rimraf(`${__dirname}/subtitle_${subFileId}.srt.gz`, () =>{});
            if(err){
              rimraf( `${__dirname}/subtitle_${subFileId}.srt`, () =>{});
              console.log(err);
              resolve(null);
            }
            else{
              if(downloadedSubtitles.length == 0 ) {
                  VLC_ARGS += ` --sub-file=${enc(`${__dirname}/subtitle_${subFileId}.srt`)}`;
              }
              downloadedSubtitles.push(`${__dirname}/subtitle_${subFileId}.srt`);
              resolve(null);
            }

          });

        }
      });
    }
    else {
      resolve(null);
    }
  });
  return prom;
}

const downloadSubtitles = (torrent) => {
  let prom = new Promise((resolve, reject) =>{

    clivas.line(`{green: Searching}{bold: subtitles}...`);

    opensubtitles.api.login()
    .then((token) => {
      opensubtitles.api.searchForTitle(token, subTitleLang, torrent.name)
      .then((subtitles) => {
         if(subtitles.length > 0) {
            clivas.line(`{bold: Found} {green: ${subtitles.length} subtitles}`);
            resolve(subtitles);
         }
         else{
            clivas.line(`{red: No subtitles Found}`);
            resolve(null);
         }
         opensubtitles.api.logout(token);
      })
      .catch((err)=>{
        clivas.line('{red: ERROR}{bold: could not search on OpenSubtitles. Please try again..}');
      });
    })
    .catch((err)=>{
      clivas.line('{red: ERROR}{bold: could not authenticate with OpenSubtitles. Please try again..}');
    });
  });
  return prom;
}


clivas.clear();
clivas.line(`{green:Welcome to} {bold:macflix}`);

if(searchTerm == 'browse'){
  TorrentService.showTop(torrentSource, 200, (err, torrents) => {
    if(err){
      console.log(err);
      process.exit(0);
      return true;
    }
    selectSource(torrents, 25);
  });
}
else{

  clivas.line(`{green:searching for} {bold:${searchTerm}}...`);

  TorrentService.search(torrentSource, searchTerm, (err, torrents) => {
    if(err || torrents.length == 0){
      console.log("Could not Find results. Please try again");
      process.exit(0);
      return true;
    }
    selectSource(torrents, 25);
  });

}

const selectSource = (torrents, maxItems) => {
  clivas.clear();
  clivas.line(`{green:Select source:}`);
  const processedTorrents = TorrentService.printTorrents(torrentSource, torrents, maxItems);

  if(processedTorrents.length == 1) {
    let subtitlesDownProm = [];
    downloadSubtitles(processedTorrents[0]).then((subtitles) => {
      if(subtitles){
        subtitles.forEach((subtitle) => {
          subtitlesDownProm.push(onSubtitleReady(subtitle));
        });
        Promise.all(subtitlesDownProm).then(() => {
          startTorrent(processedTorrents[0].magnetLink);
        });
      }
      else {
        startTorrent(processedTorrents[0].magnetLink);
      }
    });

  }

  keypress(process.stdin);
  process.stdin.on('keypress', (ch, key) => {
    if (!key) return;
    if (key.name === 'c' && key.ctrl) {
      return process.kill(process.pid, 'SIGINT');
    }

    if(doneSetup){
      return;
    }

    if(key.name.charCodeAt(0) > 96 && key.name.charCodeAt(0) < 96+processedTorrents.length){
      doneSetup = true;
      clivas.clear();

      let subtitlesDownProm = [];
      downloadSubtitles(processedTorrents[key.name.charCodeAt(0)-97]).then((subtitles) => {
        if(subtitles){
          subtitles.forEach((subtitle) => {
            subtitlesDownProm.push(onSubtitleReady(subtitle));
          });
          Promise.all(subtitlesDownProm).then(() => {
            startTorrent(processedTorrents[key.name.charCodeAt(0)-97].magnetLink);
          });
        }
        else {
          startTorrent(processedTorrents[key.name.charCodeAt(0)-97].magnetLink);
        }
      });

    }

  });
  process.stdin.setRawMode(true);
}
