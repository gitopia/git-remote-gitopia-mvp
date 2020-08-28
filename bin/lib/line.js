import readline from "readline";

export default class LineHelper {
  // OK
  constructor() {
    this._buffer = [];
    this._done = false;
  }

  // OK
  async next() {
    return new Promise((resolve, reject) => {
      if (this._buffer.length > 0) {
        resolve(this._buffer.shift());
      } else {
        this._done = false;
        const read = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        read.on("line", (line) => {
          if (!this._done) {
            this._done = true;
            read.close();
            resolve(line);
          } else {
            this._buffer.push(line);
          }
        });
      }
    });
  }
}
