import debug from "debug";
import fs from "fs-extra";
import npath from "path";
import shell from "shelljs";
// tslint:disable-next-line:no-submodule-imports
import gitP from "simple-git/promise.js";
import pkg from "smart-buffer";
const { SmartBuffer } = pkg;
import zlib from "zlib";

import { fetchGitObjects } from "./graphql.js";

const git = gitP();

export default class GitHelper {
  // OK
  constructor(helper) {
    this.helper = helper;
    this.debug = debug("gitopia");
  }

  /***** core methods *****/

  // OK
  async collect(oid) {
    this.debug("collecting", oid);
  }

  // OK
  async download(oid) {
    this.debug("downloading", oid);

    const dumps = [];

    if (await this.exists(oid)) return;

    const objects = await fetchGitObjects(
      this.helper._arweave,
      this.helper.ArData,
      this.helper.url
    );

    for (const object of objects) {
      dumps.push(this.dump(object.oid, object.data));
    }

    await Promise.all(dumps);
  }

  /***** fs-related methods *****/

  // OK
  async exists(oid) {
    // modify this function to rely on git cat-file -e $sha^{commit}
    // see https://stackoverflow.com/questions/18515488/how-to-check-if-the-commit-exists-in-a-git-repository-by-its-sha-1
    return fs.pathExists(await this.path(oid));
  }

  // OK
  async load(oid) {
    const type = shell
      .exec(`git cat-file -t ${oid}`, { silent: true })
      .stdout.trim();
    const size = shell
      .exec(`git cat-file -s ${oid}`, { silent: true })
      .stdout.trim();
    const data = await git.binaryCatFile([type, oid]);

    const raw = new SmartBuffer();
    raw.writeString(`${type} `);
    raw.writeString(size);
    raw.writeUInt8(0);
    raw.writeBuffer(data);

    return zlib.deflateSync(raw.toBuffer());
  }

  // OK
  async dump(oid, object) {
    const path = await this.path(oid);
    await fs.ensureFile(path);
    fs.writeFileSync(path, object);
  }

  /***** utility methods *****/

  // OK
  async path(oid) {
    const subdirectory = oid.substring(0, 2);
    const filename = oid.substring(2);

    return npath.join(this.helper.path, "objects", subdirectory, filename);
  }
}
