#!/bin/bash

lang1="pt"
lang2="en"

getSubs () {
  subliminal download -l $1 ${name// /.}
}

# get magnet
pirate-get -s SeedersDsc -0 -M $1

magnet=$(find . -maxdepth 1 -name "*.magnet" | head -1)
name=$(echo $magnet | cut -d '/' -f 2 | cut -d '.' -f 1)

# get subtitles
getSubs ${lang1}

sub=$(find . -maxdepth 1 -name "*.srt" | head -1)


# try to search in english if portuguese not found
if [ -z "$sub" ]; then
  getSubs ${lang2}
  sub=$(find . -maxdepth 1 -name "*.srt" | head -1)
fi
echo "$sub"
# sub2=$(echo "$sub" | sed -re 's/[()]//g')
sub3=${sub:2}
# mv ${sub:2} ${sub3}

# get magnet again to peerflix stream
pirate-get -s SeedersDsc -0 -C "peerflix \"%s\" --vlc -- --sub-file=${sub3}" $1

# # remove created files
rm *.srt && rm *.magnet