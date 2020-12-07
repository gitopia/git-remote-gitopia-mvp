import axios from "axios";
import { parseArgitRemoteURI } from "./arweave.js";
import { newProgressBar } from "./util.js";

const graphQlEndpoint = "https://arweave.net/graphql";

const getTagValue = (tagName, tags) => {
  for (const tag of tags) {
    if (tag.name === tagName) {
      return tag.value;
    }
  }
};

export const getOidByRef = async (arweave, remoteURI, ref) => {
  const { repoOwnerAddress, repoName } = parseArgitRemoteURI(remoteURI);
  const { data } = await axios({
    url: graphQlEndpoint,
    method: "post",
    data: {
      query: `
      query {
        transactions(
          owners: ["${repoOwnerAddress}"]
          tags: [
            { name: "Type", values: ["update-ref"] }
            { name: "Repo", values: ["${repoName}"] }
            { name: "Version", values: ["0.0.2"] }
            { name: "Ref", values: ["${ref}"] }
            { name: "App-Name", values: ["Gitopia"] }
          ]
          first: 1
        ) {
          edges {
            node {
              id
            }
          }
        }
      }`,
    },
  });

  const edges = data.data.transactions.edges;
  if (edges.length === 0) {
    return {
      oid: null,
      numCommits: 0,
    };
  }

  const id = edges[0].node.id;
  const response = await arweave.transactions.getData(id, {
    decode: true,
    string: true,
  });

  return JSON.parse(response);
};

export const getAllRefs = async (arweave, remoteURI) => {
  let refs = new Set();
  let refOidObj = {};
  const { repoOwnerAddress, repoName } = parseArgitRemoteURI(remoteURI);
  const { data } = await axios({
    url: graphQlEndpoint,
    method: "post",
    data: {
      query: `
      query {
        transactions(
          first: 2147483647
          owners: ["${repoOwnerAddress}"]
          tags: [
            { name: "Type", values: ["update-ref"] }
            { name: "Repo", values: ["${repoName}"] }
            { name: "Version", values: ["0.0.2"] }
            { name: "App-Name", values: ["Gitopia"] }
          ]
        ) {
          edges {
            node {
              tags {
                name
                value
              }
            }
          }
        }
      }`,
    },
  });

  const edges = data.data.transactions.edges;

  for (const edge of edges) {
    for (const tag of edge.node.tags) {
      if (tag.name === "Ref") {
        refs.add(tag.value);
        break;
      }
    }
  }

  for (const ref of refs) {
    const { oid } = await getOidByRef(arweave, remoteURI, ref);
    refOidObj[ref] = oid;
  }

  return refOidObj;
};

export const getTransactionIdByObjectId = async (remoteURI, oid) => {
  const { repoOwnerAddress, repoName } = parseArgitRemoteURI(remoteURI);
  const { data } = await axios({
    url: graphQlEndpoint,
    method: "post",
    data: {
      query: `
      query {
        transactions(
          owners: ["${repoOwnerAddress}"]
          tags: [
            { name: "Oid", values: ["${oid}"] }
            { name: "Version", values: ["0.0.2"] }
            { name: "Repo", values: ["${repoName}"] }
            { name: "Type", values: ["git-object"] }
            { name: "App-Name", values: ["Gitopia"] }
          ]
          first: 1
        ) {
          edges {
            node {
              id
            }
          }
        }
      }`,
    },
  });

  const edges = data.data.transactions.edges;
  return edges[0].node.id;
};

export const fetchGitObjects = async (arweave, arData, remoteURI) => {
  const objects = [];
  const { repoOwnerAddress, repoName } = parseArgitRemoteURI(remoteURI);
  const { data } = await axios({
    url: graphQlEndpoint,
    method: "post",
    data: {
      query: `
      query {
        transactions(
          first: 2147483647
          owners: ["${repoOwnerAddress}"]
          tags: [
            { name: "Type", values: ["git-objects-bundle"] }
            { name: "Version", values: ["0.0.2"] }
            { name: "Repo", values: ["${repoName}"] }
            { name: "App-Name", values: ["Gitopia"] }
          ]
        ) {
          edges {
            node {
              id
            }
          }
        }
      }`,
    },
  });

  const edges = data.data.transactions.edges;

  const bar1 = newProgressBar();

  console.error(
    "Downloading git objects bundle from Gitopia [this may take a while]"
  );
  bar1.start(edges.length, 0);

  await Promise.all(
    edges.map(async (edge) => {
      const txid = edge.node.id;
      const txData = await arweave.transactions.getData(txid, {
        decode: true,
        string: true,
      });
      const items = await arData.unbundleData(txData);
      await Promise.all(
        items.map(async (item) => {
          const data = await arData.decodeData(item, { string: false });
          for (let i = 0; i < item.tags.length; i++) {
            const tag = await arData.decodeTag(item.tags[i]);
            if (tag.name === "Oid") {
              const oid = tag.value;
              objects.push({ oid, data });
              break;
            }
          }
        })
      );
      bar1.increment();
    })
  );

  bar1.stop();
  console.error("Downloaded git objects bundle from Gitopia successfully");

  return objects;
};
