#!/usr/bin/env node
import { isAbsolute, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Connection } from "./connection.js";

const port = Number(process.env.PIXELORAMA_MCP_PORT ?? 7651);
const pixelorama = new Connection("127.0.0.1", port);
const server = new McpServer({ name: "pixelorama-mcp", version: "0.1.0" });

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const absolute = (path: string) => (isAbsolute(path) ? path : resolve(path));

const frame = z.number().int().min(0).optional().describe("Frame index, from 0. Defaults to the current frame");
const layer = z.number().int().min(0).optional().describe("Layer index, 0 is the bottom layer. Defaults to the current layer");
const color = z.string().describe('Color as #rgb, #rrggbb, #rrggbbaa, a name like "red", or "transparent"');

server.registerTool(
  "get_project",
  {
    description: "Describe the project open in Pixelorama: size, frames, layers and the current cel.",
  },
  async () => json(await pixelorama.request("get_project")),
);

server.registerTool(
  "new_project",
  {
    description: "Create a new, empty project in a new tab and switch to it.",
    inputSchema: {
      width: z.number().int().min(1).max(4096),
      height: z.number().int().min(1).max(4096),
      name: z.string().optional(),
    },
  },
  async (args) => json(await pixelorama.request("new_project", args)),
);

server.registerTool(
  "open_file",
  {
    description: "Open a .pxo project or an image (png, jpg, webp, bmp, tga) in a new tab.",
    inputSchema: { path: z.string().describe("Path to the file") },
  },
  async ({ path }) => json(await pixelorama.request("open_file", { path: absolute(path) })),
);

server.registerTool(
  "draw_pixels",
  {
    description:
      "Draw pixels from a character grid. Each string in rows is one row of pixels; each character is looked up " +
      "in palette. Characters that are not in the palette (such as '.') leave the pixel unchanged, so map a " +
      'character to "transparent" to erase. Example: palette {"o": "#e8a33d", "d": "#7a4a12"}, rows [".oo.", "oddo", ".oo."]. ' +
      "The whole call is one undo step in Pixelorama.",
    inputSchema: {
      rows: z.array(z.string()).min(1),
      palette: z.record(z.string().length(1), z.string()).describe("Single character -> color"),
      x: z.number().int().default(0).describe("Left edge of the grid on the canvas"),
      y: z.number().int().default(0).describe("Top edge of the grid on the canvas"),
      frame,
      layer,
    },
  },
  async (args) => json(await pixelorama.request("draw_pixels", args)),
);

server.registerTool(
  "fill_rect",
  {
    description: "Fill a rectangle with one color. Leave out the position and size to fill the whole canvas.",
    inputSchema: {
      color,
      x: z.number().int().optional(),
      y: z.number().int().optional(),
      width: z.number().int().min(1).optional(),
      height: z.number().int().min(1).optional(),
      frame,
      layer,
    },
  },
  async (args) => json(await pixelorama.request("fill_rect", args)),
);

server.registerTool(
  "clear_cel",
  {
    description: "Erase every pixel of one cel (a layer in a frame).",
    inputSchema: { frame, layer },
  },
  async (args) => json(await pixelorama.request("fill_rect", { ...args, color: "transparent" })),
);

server.registerTool(
  "read_pixels",
  {
    description:
      "Read pixels of one cel as a character grid with a palette, in the same format draw_pixels takes. " +
      "'.' is transparent. At most 16384 pixels per call.",
    inputSchema: {
      x: z.number().int().min(0).optional(),
      y: z.number().int().min(0).optional(),
      width: z.number().int().min(1).optional(),
      height: z.number().int().min(1).optional(),
      frame,
      layer,
    },
  },
  async (args) => json(await pixelorama.request("read_pixels", args)),
);

server.registerTool(
  "get_image",
  {
    description: "Show a frame with all visible layers blended, scaled up with nearest-neighbour so pixels stay sharp.",
    inputSchema: {
      frame,
      scale: z.number().int().min(1).max(64).optional().describe("Zoom factor. Defaults to about 512 px on the long side"),
    },
  },
  async (args) => {
    const image = await pixelorama.request<{ png: string }>("get_image", args);
    return { content: [{ type: "image" as const, data: image.png, mimeType: "image/png" }] };
  },
);

server.registerTool(
  "add_layer",
  {
    description: "Add a pixel layer. By default it goes on top of all layers.",
    inputSchema: {
      name: z.string().optional(),
      above: z.number().int().min(0).optional().describe("Index of the layer to put the new one above"),
    },
  },
  async (args) => json(await pixelorama.request("add_layer", args)),
);

server.registerTool(
  "add_frame",
  {
    description: "Add an empty frame. By default it goes after the last frame.",
    inputSchema: {
      after: z.number().int().min(0).optional().describe("Index of the frame to insert after"),
    },
  },
  async (args) => json(await pixelorama.request("add_frame", args)),
);

server.registerTool(
  "select_cel",
  {
    description: "Make a frame/layer the current one in Pixelorama.",
    inputSchema: { frame, layer },
  },
  async (args) => json(await pixelorama.request("select_cel", args)),
);

server.registerTool(
  "save_project",
  {
    description: "Save the current project as a .pxo file. Without a path it saves to where it was last saved.",
    inputSchema: { path: z.string().optional().describe("Where to save, ending in .pxo") },
  },
  async ({ path }) => json(await pixelorama.request("save_project", path ? { path: absolute(path) } : {})),
);

server.registerTool(
  "export_png",
  {
    description:
      "Export the current frame, or all frames as a horizontal sprite sheet, to a PNG file. " +
      "Layers are blended the same way Pixelorama shows them.",
    inputSchema: {
      path: z.string().describe("Where to write the file, ending in .png"),
      frame,
      all_frames: z.boolean().default(false),
      scale: z.number().int().min(1).max(64).default(1),
    },
  },
  async ({ path, ...rest }) => json(await pixelorama.request("export_png", { ...rest, path: absolute(path) })),
);

const shutdown = () => {
  pixelorama.close();
  process.exit(0);
};
process.stdin.on("end", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await server.connect(new StdioServerTransport());
