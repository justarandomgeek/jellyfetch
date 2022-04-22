#!/usr/bin/env node

import { Item, MediaSource, MediaStream, Jellyfin } from './jellyfin.js';
import { program } from 'commander';
import filesize from 'filesize';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { posix as path } from 'path';
import inquirer from "inquirer";
import * as xmlbuilder2 from 'xmlbuilder2';

import { pipeline } from 'stream';
import { promisify } from 'util';
const pipelineAsync = promisify(pipeline);

import progress_stream from "progress-stream";
import cliprog, { SingleBar } from "cli-progress";

interface ServerInfo {
  baseUrl:string
  accessToken?:string
};

async function getAuthedJellyfinApi(server:string) {
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
  return jserver;
}

async function writeFile(filepath:string, data:string|NodeJS.ReadableStream) {
  await fsp.mkdir(path.dirname(filepath), {recursive: true});
  return fsp.writeFile(filepath, data);
}

const bar = new SingleBar({
  format: '[{bar}] {percentage}% || {value}/{total} || {speed}',
  formatValue: function(v, options, type) {
    switch (type) {
      case 'value':
      case 'total':
        return filesize(v);
      default:
        return cliprog.Format.ValueFormat(v, options, type);
    }
  },
});

async function writeFileProgress(filepath:string, file:NodeJS.ReadableStream, size:number) {
  bar.start(size, 0, {speed: ""});
  await fsp.mkdir(path.dirname(filepath), {recursive: true});
  await pipelineAsync(
    file,
    progress_stream( 
      {
        length: size,
        time: 200,
      },
      (progress)=>{
        bar.update(progress.transferred, {speed: filesize(progress.speed)+"/s"});
      }
    ),
    fs.createWriteStream(filepath),
  );
  bar.stop();
}


function rootNfoElemName(itemType:string) {
  switch (itemType) {
    case "Movie":
      return "movie";
    case "Series":
      return "tvshow";
    case "Season":
      return "season";
    case "Episode":
      return "episodedetails";
  
    default:
      throw `Cannot make Nfo for ${itemType}`;
  }
}
function makeNfo(item:Item) {
  const doc = xmlbuilder2.create({version: '1.0', encoding: 'utf-8'});
  const root = doc.ele(rootNfoElemName(item.Type!));
  root.ele("plot").txt(item.Overview ?? "");
  root.ele("title").txt(item.Name ?? "");
  item.OriginalTitle && root.ele("originaltitle").txt(item.OriginalTitle);
  item.ProductionYear && root.ele("year").txt(item.ProductionYear.toString());
  item.ProviderIds?.Tvdb && root.ele("tvdbid").txt(item.ProviderIds?.Tvdb);
  item.ProviderIds?.Imdb && root.ele(item.Type==="Series"?"imdb_id":"imdbid").txt(item.ProviderIds?.Imdb);
  item.ProviderIds?.TvRage && root.ele("tvrageid").txt(item.ProviderIds?.TvRage);
  item.ProviderIds?.Tmdb && root.ele("tmdbid").txt(item.ProviderIds?.Tmdb);
  
  switch (item.Type) {
    case "Series":
      root.ele("season").txt("-1");
      root.ele("episode").txt("-1");
      break;
    case "Season":
      root.ele("seasonnumber").txt(item.IndexNumber!.toString());
      break;
    case "Episode":
      root.ele("season").txt(item.ParentIndexNumber!.toString());
      root.ele("episode").txt(item.IndexNumber!.toString());
      break;
    case "Movie":
      break;
    default:
      break;
  }
  return doc.end({prettyPrint: true});
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
    const jserver = await getAuthedJellyfinApi(server);
    const roots = await jserver.getPhysicalPaths();
    function adjustPath(path:string) {
      for (const root of roots) {
        if (path.startsWith(root)) {
          return path.replace(root, dest);
        }
      }
      throw `Path "${path}" not in any root!`;
    }

    async function fetchItem(item:Item) {
      switch (item.Type) {
        case "Series":
          return fetchSeries(item);
        case "Season":
          return fetchSeason(item);
        case "Episode":
          return fetchEpisode(item);
        case "Movie":
          return fetchMovie(item);
        case "BoxSet":
          return fetchBoxSet(item);
        default:
          console.log(`Downloading ${item.Type} Items not yet supported`);
          break;
      }
    }

    async function fetchBoxSet(item:Item) {
      const children = await jserver.getItemChildren(item.Id);
      for (const child of children.Items) {
        await fetchItem(child);
      }
    }

    async function fetchMedia(item:Item, media:MediaSource) {
      const vidpath = adjustPath(media.Path!);
      const p = path.parse(vidpath);
      const episodenfo = path.join(p.dir, `${p.name}.nfo`);

      console.log(`${item.Type!} Video Metadata ${episodenfo}`);
      if (!list) {
        await writeFile(episodenfo, makeNfo(item));
      }
      
      console.log(`Video File: ${vidpath} ${media.Size?filesize(media.Size):""}`);
      if (!list && !nfo) {
        const file = await jserver.getFile(media.Id);
        await writeFileProgress(vidpath, file, media.Size);
      }
      
      for (const stream of media.MediaStreams!) {
        if (stream.IsExternal) {
          const streampath = adjustPath(stream.Path!);
          console.log(`External ${stream.Type} Stream ${stream.Index}: ${streampath}`);
          switch (stream.Type) {
            case "Subtitle":
              switch (stream.Codec) {
                case "srt":
                  if (!list && !nfo) {
                    const subs = await jserver.getSubtitle(item.Id, media.Id, stream.Index, "srt");
                    await writeFile(vidpath, subs);
                  }
                  break;
                default:
                  console.log(`Downloading ${stream.Codec} Subtitle streams not yet supported`);
                  break;
              }
              break;
            default:
              console.log(`Downloading ${stream.Type} streams not yet supported`);
              break;
          }
        }
      }
    }

    async function fetchMovie(movie:Item) {
      for (const media of movie.MediaSources!) {
        await fetchMedia(movie, media);
      }
      movie.SpecialFeatureCount && console.log(`SpecialFeatureCount ${movie.SpecialFeatureCount}`);
      movie.LocalTrailerCount && console.log(`LocalTrailerCount ${movie.LocalTrailerCount}`);
    }

    async function fetchEpisode(episode:Item) {
      for (const media of episode.MediaSources!) {
        await fetchMedia(episode, media);
      }
    }

    async function fetchSeason(season:Item) {
      // don't bother with season.nfo if we dont' have at least a season number or external id...
      // or if it just doesn't have a directory
      if (season.Path && (season.IndexNumber || (season.ProviderIds && Object.keys(season.ProviderIds).length > 0))) {
        const seasonnfo = path.join(adjustPath(season.Path!), "season.nfo");
        console.log(`Season Metadata ${seasonnfo}`);
        if (!list) {
          await writeFile(seasonnfo, makeNfo(season));
        }
      }

      if (!shallow && !nfo) {
        const episodes = await jserver.getEpisodes(season.SeriesId!, season.Id);
        for (const episode of episodes.Items) {
          await fetchEpisode(episode);
        }
      }
    }

    async function fetchSeries(series:Item) {
      const seriesnfo = path.join(adjustPath(series.Path!), "tvshow.nfo");
      console.log(`Series Metadata ${seriesnfo}`);
      if (!list) {
        await writeFile(seriesnfo, makeNfo(series));
      }

      if (!shallow) {
        const seasons = await jserver.getSeasons(series.Id);
        for (const season of seasons.Items) {
          await fetchSeason(season);
        }
      }
    }

    return fetchItem(await jserver.getItem(id));
  })
  .parseAsync();