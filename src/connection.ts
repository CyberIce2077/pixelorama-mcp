import { createConnection, type Socket } from "node:net";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

// Line-delimited JSON connection to the Pixelorama extension.
// Connects on first use and reconnects if Pixelorama was restarted.
export class Connection {
  private socket?: Socket;
  private connecting?: Promise<Socket>;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}

  async request<T>(method: string, params: object = {}, timeoutMs = 15_000): Promise<T> {
    const socket = await this.connect();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      socket.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  close() {
    this.socket?.destroy();
  }

  private connect(): Promise<Socket> {
    if (this.socket) return Promise.resolve(this.socket);
    this.connecting ??= new Promise<Socket>((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port });
      socket.setEncoding("utf8");
      socket.once("connect", () => {
        this.socket = socket;
        this.connecting = undefined;
        resolve(socket);
      });
      socket.once("error", (err) => {
        if (this.socket) return;
        this.connecting = undefined;
        reject(
          new Error(
            `Cannot reach Pixelorama on ${this.host}:${this.port} (${err.message}). ` +
              "Is Pixelorama open with the Pixelorama MCP extension enabled?",
          ),
        );
      });
      socket.on("data", (chunk: string) => this.onData(chunk));
      socket.on("close", () => {
        if (this.socket !== socket) return;
        this.socket = undefined;
        this.buffer = "";
        this.rejectAll(new Error("Connection to Pixelorama closed"));
      });
    });
    return this.connecting;
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.onMessage(line);
    }
  }

  private onMessage(line: string) {
    let msg: { id?: number; result?: unknown; error?: string };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const pending = msg.id === undefined ? undefined : this.pending.get(msg.id);
    if (!pending) return;

    this.pending.delete(msg.id!);
    clearTimeout(pending.timer);
    if (msg.error) pending.reject(new Error(msg.error));
    else pending.resolve(msg.result);
  }

  private rejectAll(error: Error) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }
}
