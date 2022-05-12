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

const patterns = {
  Movie: "{Name} ({ProductionYear})",
  Versions: " - {Version}",
  SeriesFolder: "{Name} ({ProductionYear})",
  SeasonFolder: "{Name}",
  Episode: "{SeriesName} - {Index} - {Name}",
  StripChars: /[:*<>\"?|\\\/]/g,
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

const seenItems = new Map<string, Item>();

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

    async function fetchItemInfo(id:string) {
      let item = seenItems.get(id);
      if (!item) {
        item = await jserver.getItem(id);
        seenItems.set(id, item);
      }
      return item;
    }

    async function ItemPath(item:Item|string) {
      if (typeof item === 'string') {
        item = await fetchItemInfo(item);
      }
      let pattern:string;
      switch (item.Type) {
        case "Series":
          pattern = patterns.SeriesFolder;
          break;
        case "Season":
          pattern = patterns.SeasonFolder;
          break;
        case "Episode":
          pattern = patterns.Episode;
          break;
        case "Movie":
          pattern = patterns.Movie;
          break;
        default:
          throw `No path pattern for ${item.Type} Items`;
      }
      return pattern.replace(/\{([a-zA-Z]+)\}/g, (s, token:string)=>{
        const it = <Item>item;

        if (token === "Index") {
          let index = `S${it.ParentIndexNumber?.toString().padStart(2, '0')}`;
          if (typeof it.IndexNumber === 'number') {
            index += `E${it.IndexNumber?.toString().padStart(2, '0')}`;
            if (typeof it.IndexNumberEnd === 'number') {
              index += `-E${it.IndexNumberEnd.toString().padStart(2, '0')}`;
            }
          }
          return index;
        }

        if (it.hasOwnProperty(token)) {
          const tok = it[<keyof Item>token];
          if (typeof tok === 'string') {
            return tok.replace(patterns.StripChars, '');
          }
          if (typeof tok === 'number') {
            return tok.toString();
          }
        }
        return s;
      });
    }

    async function fetchItem(item:Item|string) {
      if (typeof item === 'string') {
        item = await fetchItemInfo(item);
      }
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
        case "Playlist":
        case "CollectionFolder":
          return fetchCollection(item);
        default:
          console.log(`Downloading ${item.Type} Items not yet supported`);
          break;
      }
    }

    async function fetchCollection(item:Item) {
      const children = await jserver.getItemChildren(item.Id);
      for (const child of children.Items) {
        await fetchItem(child);
      }
    }

    async function fetchMedia(item:Item, dirpath:string, media:MediaSource) {
      if (!media.Name) {
        console.log(`No name for media ${media.Id!} on Item ${item.Id}`);
        return;
      }
      const medianame = media.Name.replace(patterns.StripChars, '');
      const vidpath = path.join(dirpath, `${medianame}.${media.Container}`);
      
      const nfopath = path.join(dirpath, `${medianame}.nfo`);

      console.log(`${item.Type!} Video Metadata ${nfopath}`);
      if (!list) {
        await writeFile(nfopath, makeNfo(item));
      }
      
      console.log(`Video File: ${vidpath} ${media.Size?filesize(media.Size):""}`);
      if (!list && !nfo) {
        const file = await jserver.getFile(media.Id!);
        await writeFileProgress(vidpath, file, media.Size!);
      }
      
      for (const stream of media.MediaStreams!) {
        if (stream.IsExternal) {
          let streampath = path.join(dirpath, medianame);
          if (stream.Title) {
            streampath += `.${stream.Title}`;
          }
          if (stream.Language) {
            streampath += `.${stream.Language}`;
          }
          if (stream.IsDefault) {
            streampath += `.default`;
          }
          if (stream.IsForced) {
            streampath += `.forced`;
          }
          streampath += `.${stream.Codec}`;
          console.log(`External ${stream.Type} Stream ${stream.Index}: ${streampath}`);
          switch (stream.Type) {
            case "Subtitle":
              switch (stream.Codec) {
                case "srt":
                  if (!list && !nfo) {
                    const subs = await jserver.getSubtitle(item.Id, media.Id!, stream.Index, "srt");
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
      const dirpath = path.join(dest, await ItemPath(movie));
      for (const media of movie.MediaSources!) {
        await fetchMedia(movie, dirpath, media);
      }
      movie.SpecialFeatureCount && console.log(`SpecialFeatureCount ${movie.SpecialFeatureCount}`);
      movie.LocalTrailerCount && console.log(`LocalTrailerCount ${movie.LocalTrailerCount}`);
    }

    async function fetchEpisode(episode:Item) {
      const dirpath = path.join(dest, ...await Promise.all([episode.SeriesId!, episode.SeasonId!].map(ItemPath)));
      for (const media of episode.MediaSources!) {
        await fetchMedia(episode, dirpath, media);
      }
    }

    async function fetchSeason(season:Item) {
      const seasonnfo = path.join(dest, ...await Promise.all([season.SeriesId!, season].map(ItemPath)), "season.nfo");
      console.log(`Season Metadata ${seasonnfo}`);
      if (!list) {
        await writeFile(seasonnfo, makeNfo(season));
      }

      if (!shallow && !nfo) {
        const episodes = await jserver.getEpisodes(season.SeriesId!, season.Id);
        for (const episode of episodes.Items) {
          seenItems.set(episode.Id, episode);
          await fetchEpisode(episode);
        }
      }
    }

    async function fetchSeries(series:Item) {
      const seriesnfo = path.join(dest, await ItemPath(series), "tvshow.nfo");
      console.log(`Series Metadata ${seriesnfo}`);
      if (!list) {
        await writeFile(seriesnfo, makeNfo(series));
      }

      if (!shallow) {
        const seasons = await jserver.getSeasons(series.Id);
        for (const season of seasons.Items) {
          seenItems.set(season.Id, season);
          await fetchSeason(season);
        }
      }
    }

    return fetchItem(id);
  })
  .parseAsync();