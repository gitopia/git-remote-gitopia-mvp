import debug from "debug";
import fs from "fs-extra";
import npath from "path";
import pkg from "isomorphic-git";
const { readObject } = pkg;

import { fetchGitObjects } from "./graphql.js";

const cache = {};

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

    const objects = await fetchGitObjects(this.helper.ArData, this.helper.url);

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
    const { object } = await readObject({
      fs,
      gitdir: this.helper.path,
      oid,
      cache,
      format: "deflated",
    });

    return object;
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
