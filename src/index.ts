#!/usr/bin/env node

import { Jellyfin } from './jellyfin.js';
import { program } from 'commander';
import * as fsp from 'fs/promises';
import { posix as path } from 'path';
import inquirer from "inquirer";
import { JFetch } from './jfetch.js';

interface ServerInfo {
  baseUrl:string
  accessToken?:string
};

async function getAuthedJellyfinApi(server:string, dest:string, list?:boolean, nfo?:boolean, shallow?:boolean) {
  let servers:ServerInfo[];
  try {
    servers = JSON.parse(await fsp.readFile("servers.json", "utf8"));
  } catch (error) {
    servers = [];
  } 

  let si = servers.find(s=>s.baseUrl===server);
  const jserver = await Jellyfin.getApiSession(
    server,
    si?.accessToken,
    ()=>inquirer.prompt<{username:string;password:string}>([
      {
        message: "Username:",
        name: "username",
        type: "input",
      },
      {
        message: "Password:",
        name: "password",
        type: "password",
      },
    ]));
  if (!si) {
    si = {
      baseUrl: server,
    };
    servers.push(si);
  }
  si.accessToken = jserver.AccessToken;
  await fsp.writeFile("servers.json", JSON.stringify(servers));
  return new JFetch(jserver, dest, list, nfo, shallow);
}

interface ProgramOptions {
  dest:string
  list:boolean
  nfo:boolean
  shallow:boolean
}

program
  .version('0.0.1')
  .description("download content from a jellyfin server")
  .argument("<server>", "Base url of the server")
  .argument("<id>", "ItemID to fetch.")
  .option("-d, --dest <destination>", "Destination folder", ".")
  .option("-l, --list", "List files that would be downloaded.")
  .option("-n, --nfo", "Only make directories and Series/Season .nfo files.")
  .option("-s, --shallow", "When fetching Series or Season items, fetch only the specified item, not children.")
  .action(async (server:string, id:string)=>{
    const {list, nfo, shallow, dest} = program.opts<ProgramOptions>();
    const jfetch = await getAuthedJellyfinApi(server, dest, list, nfo, shallow);

    return jfetch.fetchItem(id);
  })
  .parseAsync();