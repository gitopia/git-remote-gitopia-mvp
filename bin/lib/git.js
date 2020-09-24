import debug from "debug";
import fs from "fs-extra";
import npath from "path";
import shell from "shelljs";
// tslint:disable-next-line:no-submodule-imports
import gitP from "simple-git/promise.js";
import pkg from "smart-buffer";
const { SmartBuffer } = pkg;
import zlib from "zlib";

const git = gitP();

export default class GitHelper {
  // OK
  constructor(helper) {
    this.helper = helper;
    this.debug = debug("dgit");
  }

  /***** core methods *****/

  // OK
  async collect(oid, mapping) {
    this.debug("collecting", oid);

    if (mapping[oid]) return mapping;

    const node = await this.load(oid);

    if (node.gitType === "commit") {
      // node is a commit
      const _mapping = await this.collect(
        this.helper.ipld.cidToSha(node.tree["/"]),
        mapping
      );
      return { ...mapping, ..._mapping, ...{ [cid]: node } };
    } else if (Buffer.isBuffer(node)) {
      // node is a blob
      return { ...mapping, ...{ [cid]: node } };
    } else {
      // node is a tree
      // tslint:disable-next-line:forin
      for (const entry in node) {
        const _mapping = await this.collect(
          this.helper.ipld.cidToSha(node[entry].hash["/"]),
          mapping
        );
        mapping = { ...mapping, ..._mapping };
      }

      return { ...mapping, ...{ [cid]: node } };
    }
  }

  // OK
  async download(oid) {
    this.debug("downloading", oid);

    if (await this.exists(oid)) return;

    // const cid = this.helper.ipld.shaToCid(oid);
    // const node = await this.helper.ipld.get(cid);

    // if (node.gitType === "commit") {
    //   // node is a commit
    //   await this.download(this.helper.ipld.cidToSha(node.tree["/"]));

    //   for (const parent of node.parents) {
    //     await this.download(this.helper.ipld.cidToSha(parent["/"]));
    //   }

    //   await this.dump(oid, node);
    // } else if (Buffer.isBuffer(node)) {
    //   // node is a blob
    //   await this.dump(oid, node);
    // } else {
    //   // node is a tree
    //   // tslint:disable-next-line:forin
    //   for (const entry in node) {
    //     await this.download(
    //       await this.helper.ipld.cidToSha(node[entry].hash["/"])
    //     );
    //   }

    //   await this.dump(oid, node);
    // }
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

    return this.helper.ipld.deserialize(raw.toBuffer());
  }

  // OK
  async dump(oid, node) {
    const path = await this.path(oid);
    const buffer = await this.helper.ipld.serialize(node);
    await fs.ensureFile(path);
    fs.writeFileSync(path, zlib.deflateSync(buffer));
  }

  /***** utility methods *****/

  // OK
  async path(oid) {
    const subdirectory = oid.substring(0, 2);
    const filename = oid.substring(2);

    return npath.join(this.helper.path, "objects", subdirectory, filename);
  }
}
