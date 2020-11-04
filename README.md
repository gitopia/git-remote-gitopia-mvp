# git-remote-gitopia

[![](https://img.shields.io/npm/v/@gitopia/git-remote-gitopia?color=)](https://www.npmjs.com/package/@gitopia/git-remote-gitopia)  
git remote helper for [Gitopia](https://gitopia.org)  
PST Fee of 0.01 AR is applicable on git push.

## Steps to Build

- `npm install`
- `npm link`

## Usage

Set the following environment variable with the path of your Arweave wallet file.  
`export GITOPIA_WALLET_PATH=/path/to/wallet`

You don't need to run `git-remote-gitopia` directly, it will be called automatically by `git` when it encounters remote of the form `gitopia://`
