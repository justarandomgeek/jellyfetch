#!/usr/bin/env node

import { Jellyfin } from './jellyfin.js';
import { JFetch } from './jfetch.js';

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

async function getAuthedJellyfinApi(server:string, dest:string) {
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
  return new JFetch(jserver, dest);
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
  const filename = path.basename(filepath);
  await fsp.mkdir(path.dirname(filepath), {recursive: true});
  if (typeof data === 'string') {
    bars.log(`${filesize(data.length).padStart(10)} ${filename}\n`);
    return fsp.writeFile(filepath, data);
  } else {
    const ps = progress_stream();
    await pipelineAsync(await data, ps, fs.createWriteStream(filepath));
    const progress = ps.progress();
    bars.log(`${filesize(progress.transferred).padStart(10)} ${filename}\n`);
  }
  
}

async function writeFileProgress(filepath:string, data:string|Promise<NodeJS.ReadableStream>, size:number) {
  const dir = fsp.mkdir(path.dirname(filepath), {recursive: true});
  const filename = path.basename(filepath);
  const bar = bars.create(size, 0, {speed: "", filename: filename});
  const ps = progress_stream( 
    {length: size, time: 200 },
    progress=>bar && bar.update(progress.transferred, {speed: filesize(progress.speed)+"/s", filename: filename})
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
  shallow:boolean
}

export class FetchTask {
  constructor(
    readonly destpath:string,
    readonly datareq:string|(()=>Promise<NodeJS.ReadableStream>),
    readonly size?:number,
    private readonly meta?:FetchTask,
    private readonly aux?:FetchTask[]
  ) {}

  private skip?: boolean;

  public get totalsize():number {
    const meta = this.meta?.totalsize ?? 0;
    const aux = this.aux?.map(f=>f.totalsize??0).reduce((a, b)=>a+b, 0) ?? 0;
    return (this.skip?0:(this.size??0)) + meta + aux;
  }

  
  private *ExecuteInternal():Generator<Promise<void>> {
    if (!this.skip) {
      const data = typeof this.datareq === 'string' ? this.datareq : this.datareq();
      yield this.size ? 
        writeFileProgress(this.destpath, data, this.size) :
        writeFile(this.destpath, data);
    }

    if (this.meta) { yield* this.meta.ExecuteInternal(); };
    if (this.aux) { 
      for (const aux of this.aux) {
        yield* aux.ExecuteInternal();
      }
    }
  }

  public async Execute() {
    return Promise.all(this.ExecuteInternal());
  }

  public *List():Generator<{destpath:string; size?:number}> {
    if (this.meta) { yield* this.meta.List(); }

    if (!this.skip) { yield {destpath: this.destpath, size: this.size}; }

    if (this.aux) { 
      for (const aux of this.aux) {
        yield* aux.List(); 
      }
    }
  }

  public Skip(list:string[]) {
    if (list.includes(this.destpath)) {
      this.skip = true;
    }
    if (this.meta) { this.meta.Skip(list); }
    if (this.aux) {
      for (const aux of this.aux) {
        aux.Skip(list);
      }
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
  .option("-s, --shallow", "When fetching Series or Season items, fetch only the specified item, not children.")
  .action(async (server:string, id:string)=>{
    const {list, shallow, dest} = program.opts<ProgramOptions>();
    const jfetch = await getAuthedJellyfinApi(server, dest);

    const item = await jfetch.fetchItemInfo(id);
    const tasks = [];
    for await (const task of jfetch.fetchItem(item, shallow)) { tasks.push(task); }
    const pstats = [];
    for (const task of tasks) {
      for (const item of task.List()) {
        pstats.push(
          fsp.stat(item.destpath)
            .then(s=>({destpath: item.destpath, stat: s}))
            .catch(()=>undefined)
        );
      }
    }
    
    const stats = <{destpath:string; stat:fs.Stats}[]> (await Promise.all(pstats)).filter(s=>!!s);
    if (stats.length > 0) {
      const overwrite = (await inquirer.prompt({
        message: "Overwrite existing files?",
        name: "overwrite",
        type: 'checkbox',
        choices: stats.map(s=>({
          name: `${s.destpath} ${filesize(s.stat.size)} ${s.stat.mtime}`,
          value: s.destpath,
        })),
      })).overwrite;
      const skip = stats.map(s=>s.destpath).filter(s=>!overwrite.includes(s));
      tasks.map(t=>t.Skip(skip));
    }
    
    let totalsize = 0;
    let count = 0;
    for (const task of tasks) {
      totalsize += task.totalsize;
      count++;
      if (list) {
        for (const item of task.List()) {
          console.log(`${item.destpath} ${item.size?filesize(item.size):''}`);
        }
      }
    }
    console.log(filesize(totalsize));
    if (!(await inquirer.prompt({
      message: "Proceed?",
      name: "proceed",
      type: "confirm",
    })).proceed) {
      return;
    }
  
    const tbar = bars.create(count, 0, {}, {
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
      tbar.update(count - q.length());
      return task.Execute();
    }, 1);
    q.push(tasks);
    await q.drain();
    bars.stop();
  })
  .parseAsync();