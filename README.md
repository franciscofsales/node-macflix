# Macflix

Torrent streaming client for node.js with torrent searching

```
npm install -g macflix
```


## Usage

Macflix will use your search query or browse command to find the content you want on its sources.

To browse for content:

```
macflix browse [options]
```

To search for your intended content:
```
macflix <search term> [options]
```

Use `"` around your search term so it can contain spaces or special characters

macflix will print the options available.



## Main Options

Main set of options. To see the complete set of options type `macflix` on your terminal.
| Option  | Description |
|---|---|
|**`-l`**|Subtitle language (`eng`, `por`, ...). _Default `English`_|
|**`-s`**|Source for content search (`pirateBay`, `yts`, `yify`). _Default `pirateBay`._|
|**`-v`**|Stream to Aiplay instead of VLC.|



## Notes

Inspired by the following work:

[peerflix](https://github.com/mafintosh/peerflix)

[torrent-stream](https://github.com/mafintosh/torrent-stream)

## License

[MIT](https://raw.githubusercontent.com/franciscofsales/node-macflix/master/LICENSE)
