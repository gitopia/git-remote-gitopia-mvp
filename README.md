# git-remote-gitopia

[![](https://img.shields.io/npm/v/@gitopia/git-remote-gitopia?color=)](https://www.npmjs.com/package/@gitopia/git-remote-gitopia)
[![Gitopia](https://img.shields.io/endpoint?style=&url=https://gitopia.org/mirror-badge.json)](https://gitopia.org/#/z_TqsbmVJOKzpuQH4YrYXv_Q0DrkwDwc0UqapRrE0Do/git-remote-gitopia)

git remote helper for [Gitopia](https://gitopia.org)  
You don’t require an Arweave wallet for cloning repositories hence it’s free.

## Installation

`npm install -g @gitopia/git-remote-gitopia`

## Steps to Build

- `npm install`
- `npm link`

## Usage

Set the following environment variable with the path of your Arweave wallet file.  
`export GITOPIA_WALLET_PATH=/path/to/wallet`

You don't need to run `git-remote-gitopia` directly, it will be called automatically by `git` when it encounters remote of the form `gitopia://`
