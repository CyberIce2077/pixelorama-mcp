# pixelorama-mcp

Lets AI agents like Claude Code draw pixel art in [Pixelorama](https://github.com/Orama-Interactive/Pixelorama) through [MCP](https://modelcontextprotocol.io).

It has two parts: a Pixelorama extension that runs inside the editor, and an MCP server that the agent talks to. The agent works on whatever is open in Pixelorama, you watch it happen on the canvas, and every change can be undone with Ctrl+Z like any other edit.

## Drawing format

Agents draw with a character grid and a palette, which is far easier for a language model than coordinates:

```json
{
  "palette": { "o": "#7a4a12", "y": "#f2c230", "h": "#fff2a8" },
  "rows": [
    "..oooo..",
    ".ohyyyo.",
    "oyyyyyyo",
    ".oyyyyo.",
    "..oooo.."
  ],
  "x": 4,
  "y": 4
}
```

Characters missing from the palette (like `.`) leave pixels alone. `read_pixels` returns existing art in the same format, so an agent can read a sprite, change it and write it back.

## Tools

| Tool | What it does |
|---|---|
| `get_project` | Size, frames, layers and the current cel |
| `new_project` | New canvas in a new tab |
| `open_file` | Open a `.pxo` or an image |
| `draw_pixels` | Draw a character grid |
| `fill_rect` | Fill a rectangle, or the whole cel |
| `clear_cel` | Erase a cel |
| `read_pixels` | Read pixels back as a character grid |
| `get_image` | Image of a frame, scaled up so the agent can see it |
| `add_layer`, `add_frame` | Add a layer or frame and select it |
| `select_cel` | Change the current frame/layer |
| `save_project` | Save as `.pxo` |
| `export_png` | Export a frame, or all frames as a sprite sheet |

Frames are counted from 0, left to right. Layers are counted from 0 at the bottom.

## Setup

Requires Pixelorama 1.2 (extension API 9) and Node.js 22 or newer.

```sh
git clone https://github.com/CyberIce2077/pixelorama-mcp.git ~/projects/pixelorama-mcp
cd ~/projects/pixelorama-mcp
npm install
npm run install-extension
```

`npm install` builds the server and packs the extension into `dist/PixeloramaMCP.zip`. `install-extension` copies it into Pixelorama's extensions folder. You can also install the zip from Pixelorama's Preferences > Extensions.

Restart Pixelorama, enable **Pixelorama MCP** in Preferences > Extensions, then add the server to Claude Code:

```sh
claude mcp add pixelorama -- node ~/projects/pixelorama-mcp/dist/index.js
```

## How it works

```
agent  <--stdio-->  pixelorama-mcp server  <--TCP 127.0.0.1:7651-->  Pixelorama extension
```

The extension listens on localhost only and speaks one JSON object per line. Any connection that sends something else, such as a web page trying to reach the port over HTTP, is dropped before a command runs.

The port is 7651. To change it, set `PIXELORAMA_MCP_PORT` for the server and `PORT` in `extension/src/Extensions/PixeloramaMCP/Main.gd`.

## Limitations

- Only pixel layers can be drawn on. Group, tilemap, 3D and audio layers are reported but not editable.
- Commands act on the project in the active tab.
- No brushes, selections or tools yet; drawing is pixels and rectangles.

## License

MIT
