/**
 * content/ holds the game's data as JSON: servers, tuning numbers, and
 * later programs and contracts. Code elsewhere imports data through this
 * file, never the JSON files directly, so every file is checked once here.
 *
 * To add a server: add a file in servers/, then import and list it below.
 */
import contractsJson from './contracts.json';
import gameJson from './game.json';
import landJson from './land.json';
import mailJson from './mail.json';
import programsJson from './programs.json';
import sitesJson from './sites.json';
import tuningJson from './tuning.json';
import gateway from './servers/gateway.json';
import relayRegistry from './servers/relay-registry.json';
import backroom from './servers/backroom.json';
import tinShed from './servers/tin-shed.json';
import vargaSurplus from './servers/varga-surplus.json';
import lowtideExchange from './servers/lowtide-exchange.json';
import tallisLibrary from './servers/tallis-library.json';
import kestrelNet from './servers/kestrel-net.json';
import polarMesh from './servers/polar-mesh.json';
import paulistaTeleport from './servers/paulista-teleport.json';
import halvorsen from './servers/halvorsen.json';
import meridianFreight from './servers/meridian-freight.json';
import corvaneMutual from './servers/corvane-mutual.json';
import ashgrovePoly from './servers/ashgrove-poly.json';
import aldergateFinch from './servers/aldergate-finch.json';
import sunderbyKraft from './servers/sunderby-kraft.json';
import tesseraWater from './servers/tessera-water.json';
import calderFacilities from './servers/calder-facilities.json';
import calderRe from './servers/calder-re.json';
import gatehousePerimeter from './servers/gatehouse-perimeter.json';
import brennanMarsh from './servers/brennan-marsh.json';
import mirrorjackRig from './servers/mirrorjack-rig.json';
import halftoneDen from './servers/halftone-den.json';
import sableRelay from './servers/sable-relay.json';
import stillPoint from './servers/still-point.json';
import daylightBoard from './servers/daylight-board.json';
import ostranderAnnex from './servers/ostrander-annex.json';
import continuityOffice from './servers/continuity-office.json';
import wickNode from './servers/wick-node.json';
import harbourRelay from './servers/harbour-relay.json';
import assetsJson from './assets.json';
import { parseAssets } from './assets';
import companiesJson from './companies.json';
import { parseCompanies } from './companies';
import hardwareJson from './hardware.json';
import { parseHardware } from './hardware';
import modelsJson from './models.json';
import { parseModels } from './models';
import peopleJson from './people.json';
import { checkPeople, parsePeople } from './people';
import { parseSites } from './sites';
import skillsJson from './skills.json';
import modulesJson from './modules.json';
import { checkParts, parseModules } from './modules';
import rivalsJson from './rivals.json';
import { checkRivals, parseRivals } from './rivals';
import storyJson from './story.json';
import newsJson from './news.json';
import patronsJson from './patrons.json';
import ladderJson from './ladder.json';
import dataJson from './data.json';
import { parseData } from './data';
import { parseLadder } from './ladder';
import { checkPatrons, parsePatrons } from './patrons';
import { checkNews, parseNews } from './news';
import { checkStory, parseStory } from './story';
import { parseSkills } from './skills';
import { checkContent, parseContracts, parseGameInfo, parseMail, parsePrograms, parseServers, parseTuning } from './schema';

export type {
  AccountDef,
  ContractDef,
  CueDef,
  FileContent,
  FileDef,
  GameInfo,
  ServerLinkDef,
  LinkLayer,
  LogDef,
  MailDef,
  MailKey,
  ObjectiveDef,
  ProgramDef,
  ProgramKind,
  RatingDef,
  RecordsDef,
  Role,
  SecurityDef,
  ServerDef,
  ServerKind,
  Tuning,
} from './schema';

export { findPage } from './sites';
export type { ModelDef, ModelSkill } from './models';
export type { HardwareDef, HardwareSlot } from './hardware';
export type { SkillBranch, SkillDef, SkillEffect } from './skills';
export type { ModuleDef, ModuleGrade, ModuleTrait } from './modules';
export type { RivalDef, RivalStyle } from './rivals';
export type { StoryBeat, StoryDef, StoryLapse, StoryLine, StoryMail } from './story';
export { MAIN_LINE, beatFlag, linesOf, storyOf } from './story';
export type { CompanyPools } from './companies';
export type { NewsDef, NewsEventDef, NewsTemplate } from './news';
export type { Favour, PatronDef } from './patrons';
export type { LadderDef, LadderRivalDef } from './ladder';
export type { DataKindDef, DataMarketDef } from './data';
export type { AssetDef, AssetEffect } from './assets';
export type { AskDef, FactDef, FileRef, PeopleDef, PersonDef, RewardDef } from './people';
export type { BlockDef, LinkDef, Net, PageDef, SiteDef } from './sites';

export const gameInfo = parseGameInfo(gameJson);
export const sites = parseSites(sitesJson);
export const tuning = parseTuning(tuningJson);
export const servers = parseServers(
  [gateway, relayRegistry, backroom, tallisLibrary, kestrelNet, polarMesh, paulistaTeleport, halvorsen, meridianFreight, corvaneMutual, ashgrovePoly, aldergateFinch, sunderbyKraft, tesseraWater, calderFacilities, calderRe, gatehousePerimeter, brennanMarsh, mirrorjackRig, halftoneDen, sableRelay, stillPoint, daylightBoard, ostranderAnnex, continuityOffice, wickNode, harbourRelay, tinShed, vargaSurplus, lowtideExchange],
  'servers/',
);
export const programs = parsePrograms(programsJson);
export const contracts = parseContracts(contractsJson);
export const mail = parseMail(mailJson);
checkContent(gameInfo, servers, programs, contracts);
export const models = parseModels(modelsJson);
export const companies = parseCompanies(companiesJson);
export const hardware = parseHardware(hardwareJson, models.map((model) => model.id));
export const people = parsePeople(peopleJson);
export const skills = parseSkills(skillsJson);
export const modules = parseModules(modulesJson);
export const rivals = parseRivals(rivalsJson);
export const story = parseStory(storyJson);
checkParts(modules, servers, contracts, programs, companies.sectors);
checkPeople(people, servers, tuning.phishMaxDetails);
checkRivals(rivals, servers);
export const news = parseNews(newsJson);
export const patrons = parsePatrons(patronsJson);
export const ladder = parseLadder(ladderJson, rivals);
export const data = parseData(dataJson);
export const assets = parseAssets(assetsJson, servers.map((server) => server.id));
checkPatrons(patrons, servers, companies.sectors.map((sector) => sector.id), contracts);
checkStory(story, servers, contracts, rivals, patrons.map((patron) => patron.id));
checkNews(news, story.beats.map((beat) => beat.id), companies.sectors.map((sector) => sector.id));

/**
 * Dots that draw the continents on the globe: [lat, lon, lat, lon, ...]
 * in tenths of a degree. Generated by tools/build-land.mjs.
 */
export const landDots: readonly number[] = landJson.points;
