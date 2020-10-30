#!/usr/bin/env node
import axios from "axios";
import Helper, { VERSION } from "./helper.js";

const main = async () => {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    // tslint:disable-next-line:no-console
    console.error("Usage: git-remote-gitopia <name> <url>");
    process.exit(1);
  }

  // Show warning when newer version is available
  try {
    const npmRegistryApi =
      "https://registry.npmjs.org/-/package/@gitopia/git-remote-gitopia/dist-tags";
    const { data } = await axios.get(npmRegistryApi);
    if (VERSION !== data.latest) {
      console.error(
        `Warning: New version ${data.latest} of git-remote-gitopia is available. Please upgrade.`
      );
    }
  } catch (error) {}

  const name = args[0] === args[1] ? "_" : args[0];
  const url = args[1];
  const helper = new Helper(name, url);

  helper
    .initialize()
    .then((_) => {
      return helper.run();
    })
    .catch((err) => {
      // tslint:disable-next-line:no-console
      console.error("Error. " + err.message);
      process.exit(1);
    });
};

main();
