import { Item } from './jellyfin.js';
import * as xmlbuilder2 from 'xmlbuilder2';

function rootNfoElemName(itemType: string) {
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

export function makeNfo(item: Item) {
  const doc = xmlbuilder2.create({ version: '1.0', encoding: 'utf-8' });
  const root = doc.ele(rootNfoElemName(item.Type!));
  root.ele("plot").txt(item.Overview ?? "");
  root.ele("title").txt(item.Name ?? "");
  item.OriginalTitle && root.ele("originaltitle").txt(item.OriginalTitle);
  item.ProductionYear && root.ele("year").txt(item.ProductionYear.toString());
  item.ProviderIds?.Tvdb && root.ele("tvdbid").txt(item.ProviderIds?.Tvdb);
  item.ProviderIds?.Imdb && root.ele(item.Type === "Series" ? "imdb_id" : "imdbid").txt(item.ProviderIds?.Imdb);
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
      item.IndexNumber && root.ele("episode").txt(item.IndexNumber.toString());
      item.IndexNumberEnd && root.ele("episodenumberend").txt(item.IndexNumberEnd.toString());
      item.AirsAfterSeasonNumber && root.ele("airsafter_season").txt(item.AirsAfterSeasonNumber.toString());
      item.AirsBeforeEpisodeNumber && root.ele("airbefore_episode").txt(item.AirsBeforeEpisodeNumber.toString());
      item.AirsBeforeSeasonNumber && root.ele("airsbefore_season").txt(item.AirsBeforeSeasonNumber.toString());
      break;
    case "Movie":
      break;
    default:
      break;
  }
  return doc.end({ prettyPrint: true });
}
