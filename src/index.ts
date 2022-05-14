#!/usr/bin/env node

import { Jellyfin } from './jellyfin.js';
import { FetchTask, JFetch } from './jfetch.js';

import { program } from 'commander';
import inquirer from "inquirer";

import filesize from 'filesize';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { posix as path } from 'path';

import { pipeline } from 'stream';
import { promisify } from 'util';
const pipelineAsync = promisify(pipeline);
import progress_stream from "progress-stream";
import cliprog, { MultiBar } from "cli-progress";
import * as async from 'async';

interface ServerInfo {
  baseUrl:string
  accessToken?:string
};

async function getAuthedJellyfinApi(server:string, dest:string, shallow?:boolean) {
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
  return new JFetch(jserver, dest, shallow);
}



const bars = new MultiBar({
  format: '[{bar}] | {percentage}% | {value} / {total} | {filename}  {speed}',
  formatValue: function(v, options, type) {
    switch (type) {
      case 'value':
      case 'total':
        return filesize(v).padStart(10);
      default:
        return cliprog.Format.ValueFormat(v, options, type);
    }
  },
  autopadding: true,
});


async function writeFile(filepath:string, data:string|Promise<NodeJS.ReadableStream>) {
  await fsp.mkdir(path.dirname(filepath), {recursive: true});
  const d = await data;
  return fsp.writeFile(filepath, d);
}

async function writeFileProgress(filepath:string, data:string|Promise<NodeJS.ReadableStream>, size:number) {
  const dir = fsp.mkdir(path.dirname(filepath), {recursive: true});
  const filename = path.basename(filepath);
  const bar = bars.create(size, 0, {speed: "", filename: filename});
  const ps = progress_stream( 
    {length: size, time: 200 },
    progress=>bar.update(progress.transferred, {speed: filesize(progress.speed)+"/s", filename: filename})
  );
  await dir;
  await pipelineAsync(await data, ps, fs.createWriteStream(filepath));
  const progress = ps.progress();
  bar.stop();
  bars.remove(bar);
  bars.log(`${filesize(progress.transferred).padStart(10)} ${filename}\n`);
}

interface ProgramOptions {
  dest:string
  list:boolean
  nfo:boolean
  shallow:boolean
}

function DoFetchTaskInternal(task:FetchTask) {
  const data = typeof task.datareq === 'string' ? task.datareq : task.datareq();
  const fetching = [task.size ? 
    writeFileProgress(task.destpath, data, task.size) :
    writeFile(task.destpath, data)];

  task.meta && fetching.push(...DoFetchTaskInternal(task.meta));
  task.aux && fetching.push(...task.aux.flatMap(DoFetchTaskInternal));
  return fetching;
}

async function DoFetchTask(task:FetchTask) {
  return Promise.all(DoFetchTaskInternal(task));
}

function* ListFetchTask(task:FetchTask):Generator<{destpath:string; size?:number}> {
  if (task.meta) { yield* ListFetchTask(task.meta); }

  yield {destpath: task.destpath, size: task.size};

  if (task.aux) { 
    for (const aux of task.aux) {
      yield* ListFetchTask(aux); 
    }
  }
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
    const jfetch = await getAuthedJellyfinApi(server, dest, shallow);

    const item = await jfetch.fetchItemInfo(id);
    const tasks = await jfetch.fetchItem(item);
    console.log(`${tasks.length} items ${filesize(tasks.map(t=>t.totalsize).reduce((a, b)=>a+b))}`);
    if (list) {
      const pstats = [];
      for (const task of tasks) {
        for (const item of ListFetchTask(task)) {
          console.log(`${item.destpath} ${item.size?filesize(item.size):''}`);
          pstats.push(fsp.stat(item.destpath));
        }
      }

      const stats = (await Promise.allSettled(pstats))
        .filter(s=>s.status==='fulfilled')
        .map(s=>(s as PromiseFulfilledResult<fs.Stats>).value)
        .map(s=>s.size)
        ;
      

      
      
      if (!(await inquirer.prompt([{
        message: "Proceed?",
        name: "proceed",
        type: "confirm",
      }])).proceed) {
        return;
      }
    }
    const tbar = bars.create(tasks.length, 0, {}, {
      format: '[{bar}] | {percentage}% | {value}    / {total}    |',
      formatValue: function(v, options, type) {
        switch (type) {
          case 'value':
          case 'total':
            return v.toString().padStart(7);
          default:
            return cliprog.Format.ValueFormat(v, options, type);
        }
      },
      autopadding: true,
    });
    const q = async.queue<FetchTask>(async(task)=>{
      tbar.update(tasks.length - q.length());
      return DoFetchTask(task);
    }, 1);
    q.push(tasks);
    await q.drain();

  })
  .parseAsync();