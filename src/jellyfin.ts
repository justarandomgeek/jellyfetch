import fetch, { BodyInit, Headers, RequestInit } from 'node-fetch';
import pkg from 'node-machine-id';
const { machineIdSync } = pkg;

export interface SessionInfo {
    Client:string
    DeviceId:string
    DeviceName:string
    Id:string
    IsActive:boolean
    ServerId:string
    UserId:string
    UserName:string
}
export interface User {
    name:string
    Id:string
    ServerId:string
}

export type ItemFields = "AirTime"|"CanDelete"|"CanDownload"|"ChannelInfo"|
  "Chapters"|"ChildCount"|"CumulativeRunTimeTicks"|"CustomRating"|"DateCreated"|
  "DateLastMediaAdded"|"DisplayPreferencesId"|"Etag"|"ExternalUrls"|"Genres"|
  "HomePageUrl"|"ItemCounts"|"MediaSourceCount"|"MediaSources"|"OriginalTitle"|
  "Overview"|"ParentId"|"Path"|"People"|"PlayAccess"|"ProductionLocations"|
  "ProviderIds"|"PrimaryImageAspectRatio"|"RecursiveItemCount"|"Settings"|
  "ScreenshotImageTags"|"SeriesPrimaryImage"|"SeriesStudio"|"SortName"|
  "SpecialEpisodeNumbers"|"Studios"|"BasicSyncInfo"|"SyncInfo"|"Taglines"|
  "Tags"|"RemoteTrailers"|"MediaStreams"|"SeasonUserData"|"ServiceName"|
  "ThemeSongIds"|"ThemeVideoIds"|"ExternalEtag"|"PresentationUniqueKey"|
  "InheritedParentalRatingValue"|"ExternalSeriesId"|"SeriesPresentationUniqueKey"|
  "DateLastRefreshed"|"DateLastSaved"|"RefreshState"|"ChannelImage"|
  "EnableMediaSourceDisplay"|"Width"|"Height"|"ExtraIds"|"LocalTrailerCount"|
  "IsHD"|"SpecialFeatureCount";

  interface NamedUrl {
    Name?: string
    Url?: string
  }

export interface Item {
  Name?: string
  OriginalTitle?: string
  ServerId?: string
  Id: string
  Etag?: string
  SourceType?: string
  PlaylistItemId?: string
  DateCreated?: string
  DateLastMediaAdded?: string
  ExtraType?: string
  AirsBeforeSeasonNumber?: number
  AirsAfterSeasonNumber?: number
  AirsBeforeEpisodeNumber?: number
  CanDelete?: boolean
  CanDownload?: boolean
  HasSubtitles?: boolean
  PreferredMetadataLanguage?: string
  PreferredMetadataCountryCode?: string
  SupportsSync?: boolean
  Container?: string
  SortName?: string
  ForcedSortName?: string
  Video3DFormat?: string
  PremiereDate?: string
  ExternalUrls?: NamedUrl[]
  MediaSources?: MediaSource[]
  CriticRating?: number
  ProductionLocations?: string[]
  Path?: string
  EnableMediaSourceDisplay?: boolean
  OfficialRating?: string
  CustomRating?: string
  ChannelId?: string
  ChannelName?: string
  Overview?: string
  Taglines?: string[]
  Genres?: string[]
  CommunityRating?: number
  CumulativeRunTimeTicks?: number
  RunTimeTicks?: number
  PlayAccess?: string
  AspectRatio?: string
  ProductionYear?: number
  IsPlaceHolder?: boolean
  Number?: string
  ChannelNumber?: string
  IndexNumber?: number
  IndexNumberEnd?: number
  ParentIndexNumber?: number
  RemoteTrailers?: NamedUrl[]
  ProviderIds?:{
    Tvdb?:string
    Imdb?:string
    TvRage?:string
    Tmdb?:string
  }
  IsHD?: boolean
  IsFolder?: boolean
  ParentId?: string
  Type?: string
  //People:
  //Studios:
  //GenreItems:
  ParentLogoItemId?: string
  ParentBackdropItemId?: string
  ParentBackdropImageTags?: string[]
  LocalTrailerCount?: number
  //UserData: {...}?
  RecursiveItemCount?: number
  ChildCount?: number
  SeriesName?: string
  SeriesId?: string
  SeasonId?: string
  SpecialFeatureCount?: number
  DisplayPreferencesId?: string
  Status?: string
  AirTime?: string
  AirDays?: ("Sunday"|"Monday"|"Tuesday"|"Wednesday"|"Thursday"|"Friday"|"Saturday")[]
  Tags?: string[]
  PrimaryImageAspectRatio?: number
  //Artists:
  //ArtistItems:
  Album?: string
  CollectionType?: string
  DisplayOrder?: string
  AlbumId?: string
  AlbumPrimaryImageTag?: string
  SeriesPrimaryImageTag?: string
  AlbumArtist?: string
  //AlbumArtists:
  SeasonName?: string
  //MediaStreams:
  VideoType?: string
  PartCount?: number
  MediaSourceCount?: number
  //ImageTags: {...}?
  //BackdropImageTags:
  //ScreenshotImageTags:
  ParentLogoImageTag?: string
  ParentArtItemId?: string
  ParentArtImageTag?: string
  SeriesThumbImageTag?: string
  //ImageBlurHashes: {...}?
  SeriesStudio?: string
  ParentThumbItemId?: string
  ParentThumbImageTag?: string
  ParentPrimaryImageItemId?: string
  ParentPrimaryImageTag?: string
  //Chapters:
  LocationType?: string
  IsoType?: string
  MediaType?: string
  EndDate?: string
  //LockedFields:
  TrailerCount?: number
  MovieCount?: number
  SeriesCount?: number
  ProgramCount?: number
  EpisodeCount?: number
  SongCount?: number
  AlbumCount?: number
  ArtistCount?: number
  MusicVideoCount?: number
  LockData?: boolean
  Width?: number
  Height?: number
  CameraMake?: string
  CameraModel?: string
  Software?: string
  ExposureTime?: number
  FocalLength?: number
  ImageOrientation?: string
  Aperture?: number
  ShutterSpeed?: number
  Latitude?: number
  Longitude?: number
  Altitude?: number
  IsoSpeedRating?: number
  SeriesTimerId?: string
  ProgramId?: string
  ChannelPrimaryImageTag?: string
  StartDate?: string
  CompletionPercentage?: number
  IsRepeat?: boolean
  EpisodeTitle?: string
  ChannelType?: string
  Audio?: string
  IsMovie?: boolean
  IsSports?: boolean
  IsSeries?: boolean
  IsLive?: boolean
  IsNews?: boolean
  IsKids?: boolean
  IsPremiere?: boolean
  TimerId?: string
  //CurrentProgram: {...}
}

type ProtocolType = "File"|"Http"|"Rtmp"|"Rtsp"|"Udp"|"Rtp"|"Ftp";
type VideoType = "VideoFile"|"Iso"|"Dvd"|"BluRay";
type IsoType = "Dvd"|"BluRay";
export interface MediaSource {
  Protocol:ProtocolType
  Id?:string
  Path?:string
  EncoderPath?: string
  EncoderProtocol?: ProtocolType
  Type: "Default"|"Grouping"|"Placeholder"
  Container?: string
  Size?: number
  Name?: string
  IsRemote: boolean
  ETag?: string
  RunTimeTicks?: number
  ReadAtNativeFramerate: boolean
  IgnoreDts: boolean
  IgnoreIndex: boolean
  GenPtsInput: boolean
  SupportsTranscoding: boolean
  SupportsDirectStream: boolean
  SupportsDirectPlay: boolean
  IsInfiniteStream: boolean
  RequiresOpening: boolean
  OpenToken?: string
  RequiresClosing: boolean
  LiveStreamId?: string
  BufferMs?: number
  RequiresLooping: boolean
  SupportsProbing: boolean
  VideoType?: VideoType
  IsoType?: IsoType
  Video3DFormat?: string
  MediaStreams?: MediaStream[]
  MediaAttachments?: MediaAttachment[]
  Formats: string[]
  Bitrate?: number
  Timestamp?: "None"|"Zero"|"Valid"
  RequiredHttpHeaders?: {any:string}
  TranscodingUrl?: string
  TranscodingSubProtocol?: string
  TranscodingContainer?: string
  AnalyzeDurationMs?: number
  DefaultAudioStreamIndex?: number
  DefaultSubtitleStreamIndex?: number
}

export interface MediaAttachment {
  Codec?: string
  CodecTag?: string
  Comment?: string
  Index: number
  FileName?: string
  MimeType?: string
  DeliveryUrl?: string
}

export interface MediaStream {
  Codec?: string
  CodecTag?: string
  Language?: string
  ColorRange?: string
  ColorSpace?: string
  ColorTransfer?: string
  ColorPrimaries?: string
  Comment?: string
  TimeBase?: string
  CodecTimeBase?: string
  Title?: string
  VideoRange?: string
  localizedUndefined?: string
  localizedDefault?: string
  localizedForced?: string
  DisplayTitle?: string
  NalLengthSize?: string
  IsInterlaced: boolean
  IsAVC?: boolean
  ChannelLayout?: string
  BitRate?: number
  BitDepth?: number
  RefFrames?: number
  PacketLength?: number
  Channels?: number
  SampleRate?: number
  IsDefault: boolean
  IsForced: boolean
  Height?: number
  Width?: number
  AverageFrameRate?: number
  RealFrameRate?: number
  Profile?: string
  Type: "Audio"|"Video"|"Subtitle"|"EmbeddedImage"
  AspectRatio?: string
  Index: number
  Score?: number
  IsExternal: boolean
  DeliveryMethod?: "Encode"|"Embed"|"External"|"Hls"
  DeliveryUrl?: string
  IsExternalUrl?: boolean
  IsTextSubtitleStream: boolean
  SupportsExternalStream: boolean
  Path?: string
  PixelFormat?: string
  Level?: number
  IsAnamorphic?: boolean
}

export interface ItemQueryResult {
    Items:Item[]
    TotalRecordCount:Number
    StartIndex:number
}

export class Jellyfin {
  private static readonly deviceId = machineIdSync();
  private session?:SessionInfo;
  public constructor(
        public readonly server:string,
        private accessToken?:string) {
  }

  public static async getApiSession(server:string, accessToken:string|undefined, credential_prompt:()=>Promise<{username:string;password:string}>) {
    const j = new Jellyfin(server, accessToken);
    if (accessToken) {
      j.session = (await j.getSessions())?.[0];
    }
    if (!j.session) {
      const {username, password} = await credential_prompt();
      const authres = await j.authenticateUserByName(username, password);
      j.session = authres.SessionInfo;
      j.accessToken = authres.AccessToken;
    }
    return j;
  }

  public get Session(): SessionInfo {
    return this.session!;
  }

  public get AccessToken(): string|undefined {
    return this.accessToken;
  }

  private get AuthorizationHeader() {
    return [
      `MediaBrowser Client="jellyfetch"`,
      `Device="jellyfetch"`,
      `DeviceId="${Jellyfin.deviceId}"`,
      `Version="0.0.1"`,
      `Token="${this.accessToken}"`,
    ].join(', ');
  }

  public ItemFields:ItemFields[] = [
    'Path',
    'ProviderIds',
    'Overview',
    'MediaSources',
    'LocalTrailerCount',
    'SpecialFeatureCount',
    'ChildCount',
    'ExternalSeriesId',
    'ExtraIds',
    'OriginalTitle',
    'ParentId',
    'RecursiveItemCount',
    'Taglines',
  ];

  private get FieldsQuery() {
    return `fields=${this.ItemFields.join(',')}`;
  }

  private async internalFetch(path:string, body?:BodyInit) {
    const headers = new Headers ({
      "X-Emby-Authorization": this.AuthorizationHeader,
    });
    const options:RequestInit = {
      method: 'GET',
      headers: headers,
    };
    if (body) {
      options.method = "POST";
      options.body = body;
      if (typeof body === 'string') {
        headers.append('Content-Type', 'application/json');
      }
    }
    return fetch(new URL(path, this.server).toString(), options);
  }

  private async internalFetchJson<T>(path:string, body?:BodyInit) {
    const result = await this.internalFetch(path, body);
    if (!result.ok) { throw result.statusText; }
    return <Promise<T>> result.json();
  }
    

  public async authenticateUserByName(username:string, password:string) {
    const authres = await this.internalFetchJson<{
            AccessToken:string
            ServerId:string
            SessionInfo:SessionInfo
            User:User
        }>("/Users/AuthenticateByName", JSON.stringify({
          Username: username,
          Pw: password,
        }));
    this.accessToken = authres.AccessToken;
    return authres;
  }

  public async currentUser() {
    const result = await this.internalFetch("/Users/Me");
    if (result.status === 200 || result.status === 400) {
      return <Promise<User>>result.json();
    } else {
      throw result.statusText;
    }
  }

  public async getItem(itemId:string) {
    return this.internalFetchJson<Item>(`/Users/${this.session!.UserId}/Items/${itemId}`);
  }

  public async getItemChildren(parentId:string) {
    return this.internalFetchJson<ItemQueryResult>(`/Users/${this.session!.UserId}/Items?ParentId=${parentId}&${this.FieldsQuery}`);
  }

  public async getSeasons(seriesId:string) {
    return this.internalFetchJson<ItemQueryResult>(`/Shows/${seriesId}/Seasons?${this.FieldsQuery}`);
  }

  public async getEpisodes(seriesId:string, seasonId:string): Promise<any> {
    return this.internalFetchJson<ItemQueryResult>(`/Shows/${seriesId}/Episodes?seasonId=${seasonId}&${this.FieldsQuery}`);
  }

  public async getFile(id:string) {
    const result = await this.internalFetch(`/Items/${id}/File`);
    if (!result.ok) { throw result.statusText; }
    return result.body!;
  }

    
  public async getSubtitle(itemId:string, mediaSourceId:string, index:number, format:string) {
    const result = await this.internalFetch(`/Videos/${itemId}/${mediaSourceId}/Subtitles/${index}/Stream.${format}`);
    if (!result.ok) { throw result.statusText; }
    return result.body!;
  }

  public async getSessions() {
    const result = await this.internalFetchJson<SessionInfo[]>(`/Sessions?deviceId=${Jellyfin.deviceId}`);
    return result;
  }
}