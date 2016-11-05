#!/usr/bin/env node

const optimist = require('optimist');
const rc = require('rc');
const clivas = require('clivas');
const numeral = require('numeral');
const os = require('os');
const address = require('network-address');
const proc = require('child_process');
const macflix = require('./');
const keypress = require('keypress');
const openUrl = require('open');
const inquirer = require('inquirer');
const parsetorrent = require('parse-torrent');
const path = require('path');
const rimraf = require('rimraf');
const PirateBay = require('thepiratebay');
const opensubtitles = require("subtitler");
const utils = require('./utils');

process.title = 'macflix';

const argv = rc('macflix', {}, optimist
  .usage('Usage: $0 <movie/series> [options]')
  .alias('c', 'connections').describe('c', 'max connected peers').default('c', os.cpus().length > 1 ? 100 : 30)
  .alias('p', 'port').describe('p', 'change the http port').default('p', 8888)
  .alias('i', 'index').describe('i', 'changed streamed file (index)')
  .alias('l', 'list').describe('l', 'list available files with corresponding index').boolean('l')
  .alias('t', 'subtitles').describe('t', 'load subtitles file')
  .alias('q', 'quiet').describe('q', 'be quiet').boolean('v')
  .alias('v', 'vlc').describe('v', 'autoplay in vlc*').boolean('v')
  .alias('s', 'airplay').describe('s', 'autoplay via AirPlay').boolean('a')
  .alias('f', 'path').describe('f', 'change buffer file path')
  .alias('b', 'blocklist').describe('b', 'use the specified blocklist')
  .alias('n', 'no-quit').describe('n', 'do not quit macflix on vlc exit').boolean('n')
  .alias('a', 'all').describe('a', 'select all files in the torrent').boolean('a')
  .alias('h', 'hostname').describe('h', 'host name or IP to bind the server to')
  .alias('e', 'peer').describe('e', 'add peer by ip:port')
  .alias('x', 'peer-port').describe('x', 'set peer listening port')
  .alias('d', 'not-on-top').describe('d', 'do not float video on top').boolean('d')
  .describe('on-downloaded', 'script to call when file is 100% downloaded')
  .describe('on-listening', 'script to call when server goes live')
  .describe('version', 'prints current version').boolean('boolean')
  .argv);

if (argv.version) {
  console.error(require('./package').version);
  process.exit(0);
}

const searchTerm = argv._[0];
const onTop = !argv.d;
let doneSetup = false;
let subTitleFile = null;

if (!searchTerm) {
  optimist.showHelp();
  console.error('Options passed after -- will be passed to your player');
  console.error('');
  console.error('  "macflix <movie/series> --vlc -- --fullscreen" will pass --fullscreen to vlc');
  console.error('');
  console.error('* Autoplay can take several seconds to start since it needs to wait for the first piece');
  process.exit(1);
}

let VLC_ARGS = `-q${(onTop ? ' --video-on-top' : '')} --play-and-exit`;

const enc = (s) => {
  return /\s/.test(s) ? JSON.stringify(s) : s;
}

if (argv.t) {
  VLC_ARGS += ` --sub-file=${enc(argv.t)}`;
}
else if (subTitleFile){
  VLC_ARGS += ` --sub-file=${enc(subTitleFile)}`;
}

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


  if (argv.list) {
    let interactive = process.stdout.isTTY && process.stdin.isTTY && !!process.stdin.setRawMode;

    const onready = () => {
      if (interactive) {
        inquirer.prompt([{
          type: 'list',
          name: 'file',
          message: 'Choose one file',
          choices: engine.files.map( (file, i) => {
            return {
              name: file.name + ' : ' + bytes(file.length),
              value: i
            } })
        }],
        (answers) => {
          argv.index = answers.file;
          delete argv.list;
          ontorrent(torrent);
        });
      }
      else {
        engine.files.forEach((file, i, files) => {
          clivas.line(`{3+bold:${i}} : {magenta:${file.name}} : {blue:${bytes(file.length)}}`);
        });
        process.exit(0);
      }
    }
    if (engine.torrent) {
      onready();
    }
    else {
      engine.on('ready', onready);
    }
    return;
  }

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
        rimraf(`${__dirname}/subtitle.srt`, (err) => {});
        rimraf(`${engine.path}`, (err) => {
          clivas.line('{yellow:note} {green:macflix removed the temporary files!}');
          process.exit();
        });
      }
    }

    process.on('SIGINT', remove);
    process.on('SIGTERM', remove);

    let registry, key;

    if (argv.vlc) {
      player = 'vlc';
      const root = '/Applications/VLC.app/Contents/MacOS/VLC';
      const home = (process.env.HOME || '') + root;
      let vlc = proc.exec(`vlc ${VLC_ARGS} ${localHref} || ${root} ${VLC_ARGS} ${localHref} || ${home} ${VLC_ARGS} ${localHref}`, (error, stdout, stderror) => {
        if (error) {
          remove();
        }
      });

      vlc.on('exit', () => {
        if (!argv.n && argv.quit !== false) {
          remove();
        }
      });
    }

    if (argv.airplay) {
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

    let interactive = !player && process.stdin.isTTY && !!process.stdin.setRawMode;

    if (interactive) {
      keypress(process.stdin);
      process.stdin.on('keypress', (ch, key) => {
        if (!key) return;
        if (key.name === 'c' && key.ctrl === true) {
          return process.kill(process.pid, 'SIGINT');
        }
        if (key.name === 'l' && key.ctrl === true) {
          var command = 'open';
          return proc.exec(`${command} ${engine.path}`);
        }
        if (key.name !== 'space') {
          return;
        }

        if (player) {
          return;
        }

        if (paused === false) {
          if (!argv.all) {
            engine.server.index.deselect();
          }
          else {
            engine.files.forEach((file) => {
              file.deselect();
            });
          }
          paused = true;
          pausedAt = Date.now();
          draw();
          return;
        }

        if (!argv.all) {
          engine.server.index.select();
        }
        else {
          engine.files.forEach( (file) => {
            file.select();
          });
        }

        paused = false;
        timePaused += Date.now() - pausedAt;
        draw();
      })
      process.stdin.setRawMode(true);
    }

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

      if (interactive) {
        var openLoc = ' or CTRL+L to open download location}';
        if (paused) {
          clivas.line(`{yellow:PAUSED} {green:Press SPACE to continue download${openLoc}`);
        }
        else {
          clivas.line(`{50+green:Press SPACE to pause download${openLoc}`);
        }
      }

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

clivas.clear();
clivas.line(`{green:Welcome to} {bold:macflix}`);
clivas.line(`{green:searching for} {bold:${searchTerm}}...`);

PirateBay.search(searchTerm, {
  category: 'all',
  filter: {
    verified: false    // default - false | Filter all VIP or trusted torrents
  },
  page: 0,            // default - 0 - 99
  orderBy: 'seeds', // default - name, date, size, seeds, leeches
  sortBy: 'desc'      // default - desc, asc
})
  .then(
    (torrents) => {
      clivas.clear();
      clivas.line(`{green:Select source:}`);
      let index = 0;
      let total = 0;
      torrents.forEach((torrent) => {
        if(total > 9) {
          return true;
        }
        if(!torrent.magnetLink){
          index++;
          return true;
        }

        clivas.line(`{bold:${String.fromCharCode(97+index)}}: {green:${torrent.name}}   {green:${torrent.seeders}}/{red:${torrent.leechers}}  {bold:${torrent.size}}`);
        index++;
        total++
      })
      const startTorrent = (magnetLink) => {
        parsetorrent.remote(magnetLink, (err, parsedtorrent) => {
          if (err) {
            console.error(err.message);
            process.exit(1);
          }
          ontorrent(parsedtorrent);
        });
      }
      const onSubtitleReady = (magnetL, subFile) => {
        utils.downloadFile(subFile, __dirname+'/subtitle.srt.gz', (err) =>{
          if(err) {
            console.log(err);
            rimraf(__dirname+'/subtitle.srt.gz', ()=>{});
            startTorrent(magnetL);
          }
          else{

            utils.unzip(__dirname+'/subtitle.srt.gz', __dirname+'/subtitle.srt', (err) => {
              rimraf( __dirname+'/subtitle.srt.gz', () =>{});
              if(err){
                rimraf( __dirname+'/subtitle.srt', () =>{});
                console.log(err);
                startTorrent(magnetL);
              }
              else{
                VLC_ARGS += ` --sub-file=${enc(__dirname+'/subtitle.srt')}`;
                startTorrent(magnetL);
              }

            });

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

        if(key.name.charCodeAt(0) > 96 && key.name.charCodeAt(0) < 106+index){
          doneSetup = true;

          opensubtitles.api.login()
          .then((token) => {
            opensubtitles.api.searchForTitle(token, 'por', torrents[key.name.charCodeAt(0)-97].name)
            .then((subtitles) => {
               onSubtitleReady(torrents[key.name.charCodeAt(0)-97].magnetLink, subtitles[0].SubDownloadLink);
               opensubtitles.api.logout(token);
               return;
            });
          });

        }

      });
      process.stdin.setRawMode(true);
    }
  )
  .catch((error) =>{
    console.log(error);
  });
