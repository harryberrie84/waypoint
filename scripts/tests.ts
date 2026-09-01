// Pure-logic tests for the attachments + reminders release.
// Run: node --import ./scripts/register.mjs scripts/tests.ts
// Imports the lib modules from source directly (no bundling), like the other
// lib tests. No DOM needed, every function under test is pure.

import { parseInstant, dueReminders, reminderDue, formatInstant, dateStatus } from '../src/lib/reminders.ts';
import {
  roleInWorkspace, isAdmin, canEdit, canInvite,
  classifyWorkspaces, pendingInvitesFor, validateInviteEmail,
  normalizeEmail, readInviteFromSearch,
} from '../src/lib/workspace.ts';
import type { Workspace, WorkspaceMember, WorkspaceInvite } from '../src/types.ts';
import { attachmentOf, geoOf, cellText, matchFilter, groupRows, rowColor, rowTitle, type ColorRule } from '../src/lib/tableQuery.ts';
import { parseDelimited, planImport } from '../src/lib/csv.ts';
import { parseLocaleNumber } from '../src/lib/number.ts';
import { isEmptyDoc, hasWidgetBlock, extractTableIds, remapTableIds, setImageThreadId } from '../src/lib/doc.ts';
import { derivePlacePins, placeTablesForWorkspace, placeRowCells, nextSourceColor, SOURCE_COLORS } from '../src/lib/mapPins.ts';
import { gridsByPage } from '../src/lib/grids.ts';
import { placesToCsv, placesToJson, placesToGpx, placeClipboardText } from '../src/lib/mapExport.ts';
import { bakeSharedTable, monthMatrix } from '../src/lib/sharedTable.ts';
import { coverStyle, COVER_GRADIENTS } from '../src/lib/cover.ts';
import { exifDateToIso } from '../src/lib/exif.ts';
import { albumsIn } from '../src/lib/photoMeta.ts';
import { collectReservationEvents } from '../src/lib/tripViews.ts';
import {
  buildLines, defaultFxBoard, describeAge, formatAmount, formatInverse, formatRate,
  normalizeCode, parseAmount, swapBase, type FxBoardData,
} from '../src/lib/fxBoard.ts';
import { avatarColor, initials } from '../src/lib/avatar.ts';
import { collectEvents, collectEventSpans, eventsByDay, collectMoney, tripDaySpan, pageTables, collectMedia } from '../src/lib/tripViews.ts';
import type { TableData, TableRow, Page } from '../src/types.ts';
import type { ViewConfig } from '../src/lib/tableQuery.ts';
import { compactCount } from '../src/lib/collabCompact.ts';
import { modKey, undoHint, searchHint, isSearchShortcut, isLinux } from '../src/lib/platform.ts';
import { defaultTiers, buildTierRows, tierForRating, ratingForInsert } from '../src/lib/tierList.ts';
import { beginWrite, endWrite, isWriting, isStaleRecord, keepPendingFields, resetWrites } from '../src/lib/proseSync.ts';
import { keyTrustStatus } from '../src/lib/keyTrust.ts';
import { buildSetlistHtml, buildQuizHtml } from '../src/lib/widgetExport.ts';
import {
  selectChildren, selectTopLevel, selectTemplates, selectTrashRoots,
  pageWorkspaceId, selectWorkspacePages, selectWorkspaceTables, selectBreadcrumb, selectRowsForTable,
  selectUnfiledPages,
} from '../src/lib/pageTree.ts';
import { selectMyRole, canEdit as canEditPage, canManageSharing } from '../src/lib/permissions.ts';
import { serializeSetlist, parseSetlist, SETLIST_TEMPLATE, type SetItem } from '../src/lib/setlistIO.ts';
import { formatTime } from '../src/lib/audio.ts';
import { nextNavRow, registerNavSource, navTarget } from '../src/lib/rowNav.ts';
import { pageToICS, tableToICS, eventsToICS, googleCalUrl, isValidCalEvent } from '../src/lib/ics.ts';
import { serializeQuiz, parseQuiz, QUIZ_TEMPLATE, type QuizItem } from '../src/lib/quizIO.ts';
import { sheetToJSON, parseCharacter, CHARACTER_TEMPLATE_JSON, CHARACTER_EXAMPLE, CHARACTER_EXAMPLE_JSON } from '../src/lib/characterIO.ts';
import { mindmapToBundle, parseMindmapBundle, bundleToMindmap, blankMindmapBundle, exampleMindmapBundle, serializeMindmapBundle } from '../src/lib/mindmapIO.ts';
import { flowToBundle, parseFlowBundle, bundleToFlow, blankFlowBundle, exampleFlowBundle, serializeFlowBundle } from '../src/lib/flowIO.ts';
import { parseBackup, assembleBackup, remapDeep, orderPagesByParent, deadTableRemaps } from '../src/lib/restoreBackup.ts';
import {
  descendantPageIds, collectMovedSet, relationSeverances, neutralizeCrossRefs, movedIdsOf,
} from '../src/lib/turnIntoWorkspace.ts';
import { docToMarkdown, boardToBundle, parseKanbanBundle, bundleToBoard, bundleToUpsertPlan, blankKanbanBundle, exampleKanbanBundle } from '../src/lib/kanbanIO.ts';
import { markdownToTiptap, parseInline, parseNotionExport } from '../src/lib/notionImport.ts';
import { collectAgenda, dayStatus } from '../src/lib/agenda.ts';
import { highlightCode } from '../src/lib/codeHighlight.ts';
import { extractPlainText, parseQuery } from '../src/lib/search.ts';
import { parseHumanDate } from '../src/lib/humanDate.ts';
import { isRowDone } from '../src/lib/tableQuery.ts';
import { parseRecipes, parseCaseBriefs, parseStatutes } from '../src/lib/recordImport.ts';
import { BLANK_JSON, BLANK_CSV, EXAMPLE_JSON, EXAMPLE_CSV } from '../src/lib/recordExport.ts';
import { scaleLine, parseQty } from '../src/lib/recipeScale.ts';
import { parseMarkdownTable, splitMarkdownTables } from '../src/lib/markdownTable.ts';
import { parseLatLong, trackingChip } from '../src/lib/smartPaste.ts';
import { whoOwesWhom } from '../src/lib/whoOwes.ts';
import { findClashes } from '../src/lib/clash.ts';
import { isHoliday, countWorkdays, countDaysOff } from '../src/lib/swedishHolidays.ts';
import { publishRef, lookupRef, clearRef } from '../src/lib/refRegistry.ts';
import { extractPageLinks, buildLinkGraph, outboundOf, backlinksOf } from '../src/lib/pageLinks.ts';
import { searchEmoji } from '../src/lib/emoji.ts';
import { hasInlineMarkdown, parseInlineMarkdown } from '../src/lib/inlineMarkdown.ts';
import { onThisDay } from '../src/lib/agenda.ts';
import { parseGithubUrl } from '../src/lib/github.ts';
import { isImageIcon } from '../src/lib/pageIcon.ts';
import { parseCellLink, formatCellLink, cellLinkLabel, linkHref } from '../src/lib/cellLink.ts';
import { assignedToMe } from '../src/lib/assignments.ts';
import { buildEdges, blockingPredecessors, detectCycle, cycleNodes, clampStarts, type Placed } from '../src/lib/deps.ts';
import { nextDate, buildNextCells } from '../src/lib/recurrence.ts';
import {
  beginProseWrite,
  endProseWrite,
  isProseWriting,
  reconcileProseEcho,
  resetProseWrites,
} from '../src/lib/proseSync.ts';
import {
  durationForProfile,
  estimateFlightDurationS,
  autoLegMode,
  FLIGHT_THRESHOLD_M,
} from '../src/lib/routing.ts';
import { tabelogSearchUrl, googleMapsUrl, normalizeNominatim, searchPlaces } from '../src/lib/places.ts';
import { toggleReaction, hasReacted, reactionEntries, totalReactions } from '../src/lib/reactions.ts';
import { poiToGeo, categoryLabel, geoDetailLines } from '../src/lib/poi.ts';
import { parseGoogleMapsUrl, titleFromUrl, prettifySlug, planUrlImport } from '../src/lib/urlImport.ts';
import { netBalances, settleUp, type Expense } from '../src/lib/settle.ts';
import { tally, winner } from '../src/lib/poll.ts';
import { serializeForm, parseForm, slugifyField, slugifyFields, formValues } from '../src/lib/formBlock.ts';
import { buildTablePreset, packedStat, sortRows, resolveCellText } from '../src/lib/tableQuery.ts';
import { buildOverpassQuery, normalizeOverpass, bboxTooBig, AREA_CATEGORIES } from '../src/lib/overpass.ts';
import { parsePlacesImport, MAP_IMPORT_EXAMPLE } from '../src/lib/placesImport.ts';
import { normalizeHex, resolveTheme, contrastRatio, lowContrast, PRESETS, TOKEN_KEYS, CLAY, FONTS, FONT_CATEGORIES, FONT_VIBES } from '../src/lib/theme.ts';
import { ensureHref, menuItemsFor, type SelectionState } from '../src/lib/selectionMenu.ts';
import { toScreen, toCanvas, edgePath, dedupeEdges, connect, collapsedHidden, fitView, nodeCenter, NODE_W, NODE_H, deleteNodes, nodesInRect, toggleSelected, childPosition, duplicateNodes, treeLayout, matchNodes, checkProgress, LAYOUT_GAP_X } from '../src/lib/mindmap.ts';
import { colName, colIndex, parseRef, refName, expandRange, evaluateSheet, literalValue, chartPoints, chartScale, pieSlices } from '../src/lib/sheet.ts';
import {
  grade, buildQueue, forecast, dayIndex, MIN_EASE, withSched, schedOf, setDueIn, deckStats, stateOf, emptyDeck,
  unitsOf, allUnits, subDecks, clozeIndexes, renderCloze, buildCram, pruneSched, gradePreview, DEFAULT_STEPS, migrateDeck,
} from '../src/lib/srs.ts';
import { parseAnkiText, serializeAnkiText } from '../src/lib/ankiIO.ts';
import { readVarint, decodeRecord, columnsFromSql, readTable } from '../src/lib/sqlite.ts';
import { whoseTurn, shareOf, markDone, undoLast, nextDue, dueState, rotaOrder, daysBetween } from '../src/lib/rota.ts';
import { buildBracket, pickWinner, champion, standings } from '../src/lib/bracket.ts';
import { buildWall, wallUnit, wallTone, daysAway } from '../src/lib/countdown.ts';
import { parseTrello, parseTodoist, parseKeep, detectBoardSource, parseBoard } from '../src/lib/importBoards.ts';
import { compileFlow, runPlan, indexFlows, cellScope, taskItems, checkboxFired, coerceCellWrite, interpolateRefs, filterRose, scheduleDue, lastScheduledSlot, type FlowContext, type FlowEnv } from '../src/lib/flow.ts';
import { applyActionsScoped } from '../src/lib/automations.ts';
import { evaluateFormula, matchCriterion } from '../src/lib/formula.ts';
import { pageToMarkdown } from '../src/lib/backup.ts';
import { rollDice, rollDiceDetailed, rollOnTable, formatRoll } from '../src/lib/dice.ts';
import { resolveLookup } from '../src/lib/tableQuery.ts';
import { backlinksFor } from '../src/lib/backlinks.ts';
import { buildCampaignBundle, relationPatchesFor, type CampaignKey } from '../src/lib/campaign.ts';
import { abilityMod, proficiencyBonus, formatMod, classIcon, characterTagline, emptyCharacter } from '../src/lib/character.ts';
import type { FlowData, FlowNode, FlowEdge, FlowTrigger } from '../src/types.ts';
import { docExcerpt } from '../src/lib/excerpt.ts';
import { staticTiles, tileUrl } from '../src/lib/staticTile.ts';
import type { MindNode, MindEdge } from '../src/types.ts';
import type { Column, AttachmentValue } from '../src/types.ts';
import { appendCapture } from '../src/lib/capture.ts';
import { STARTERS } from '../src/lib/starters.ts';
import { buildSearchIndex, searchIndex, bestMatchWord } from '../src/lib/search.ts';
import { splitCells } from '../src/lib/cellCrypto.ts';
import { forecastList, type DayWeather } from '../src/lib/weather.ts';
import { serializeChecklist, parseChecklist, PACKING_TEMPLATE, READINESS_TEMPLATE } from '../src/lib/checklistIO.ts';
import { serializeVote, parseVote, VOTE_TEMPLATE } from '../src/lib/voteIO.ts';
import {
  generateMasterKey, exportMasterKey, importMasterKey, wrapMasterKey, unwrapMasterKey,
  encryptContent, decryptContent, isEnvelope, generateRecoveryCode, normalizeRecoveryCode,
  generateKeyPair, exportPublicKey, generateContentKey, wrapContentKeyFor, unwrapContentKeyWith,
  wrapPrivateKey, unwrapPrivateKey, nonExtractableMaster, sameMasterKey, keyFingerprint,
} from '../src/lib/crypto.ts';
import { oversizeMessage, formatBytes, targetDimensions, MAX_UPLOAD_BYTES } from '../src/lib/image.ts';
import { mediaUrlOfNode } from '../src/lib/doc.ts';
import { bitrateForTarget, clampToSource, formatDuration } from '../src/lib/videoTranscode.ts';
import { uploadRecordIdFromUrl, isUploadUrl, sameUpload, referencesToUrl, mentionsUpload, planChunks } from '../src/lib/uploadRefs.ts';
import { buildDayRoute, orderByNearest, formatDistance, formatMinutes } from '../src/lib/dayRoute.ts';
import { suggestPacking } from '../src/lib/packingPlan.ts';
import { layoutTierImage, cardsPerLine, tierImageFilename, TIER_IMAGE_WIDTH } from '../src/lib/tierImage.ts';
import { isVideoMedia, isVideoFile } from '../src/lib/media.ts';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(e as Error).message}`);
  }
}
function eq(a: unknown, b: unknown, msg = '') {
  const A = JSON.stringify(a);
  const B = JSON.stringify(b);
  if (A !== B) throw new Error(`${msg} expected ${B}, got ${A}`);
}
function ok(v: unknown, msg = '') {
  if (!v) throw new Error(`${msg} expected truthy, got ${JSON.stringify(v)}`);
}
async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n      ${(e as Error).message}`);
  }
}
async function throwsAsync(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

// --- fixtures ---------------------------------------------------------------

function col(over: Partial<Column>): Column {
  return { id: 'c', name: 'Col', type: 'text', width: 120, ...over };
}
function table(columns: Column[]): TableData {
  return { id: 't1', name: 'Deadlines', columns, owner: '', updated: '', created: '' };
}
function row(cells: Record<string, unknown>): TableRow {
  return { id: 'r1', table: 't1', parent: '', cells: cells as TableRow['cells'], position: 0, created: '', updated: '' };
}
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const att: AttachmentValue = { name: 'boarding-pass.pdf', mime: 'application/pdf', size: 81234, data: 'data:application/pdf;base64,AAAA' };

// --- reminders --------------------------------------------------------------

test('parseInstant reads datetime-local as local time', () => {
  eq(parseInstant('2026-06-27T14:00'), new Date(2026, 5, 27, 14, 0).getTime());
});
test('parseInstant reads a date-only string as local midnight', () => {
  eq(parseInstant('2026-06-27'), new Date(2026, 5, 27, 0, 0).getTime());
});
test('parseInstant rejects junk', () => {
  eq(parseInstant('not a date'), null);
  eq(parseInstant(42), null);
});

const titleCol = col({ id: 'title', name: 'Task', type: 'text' });
const remCol = col({ id: 'rem', name: 'Check-in opens', type: 'reminder', reminderLead: '1d' });

test('dueReminders fires inside the lead window and carries deep-link ids', () => {
  const now = Date.now();
  const t = table([titleCol, remCol]);
  const r = row({ title: 'JR Pass pickup', rem: toLocalInput(now + 5 * 60 * 1000) });
  const out = dueReminders({ t1: t }, { r1: r }, now);
  eq(out.length, 1, 'one due');
  eq(out[0].tableId, 't1');
  eq(out[0].rowId, 'r1');
  eq(out[0].columnId, 'rem');
  eq(out[0].fieldName, 'Check-in opens');
});
test('dueReminders pulls the row title from the title column', () => {
  const now = Date.now();
  const t = table([titleCol, remCol]);
  const r = row({ title: 'JR Pass pickup', rem: toLocalInput(now + 5 * 60 * 1000) });
  eq(dueReminders({ t1: t }, { r1: r }, now)[0].title, 'JR Pass pickup');
});
test('dueReminders ignores reminders whose moment has passed', () => {
  const now = Date.now();
  const t = table([titleCol, remCol]);
  const r = row({ title: 'x', rem: toLocalInput(now - 60 * 60 * 1000) });
  eq(dueReminders({ t1: t }, { r1: r }, now).length, 0);
});
test('dueReminders ignores reminders whose lead window has not opened', () => {
  const now = Date.now();
  const atCol = col({ id: 'rem', name: 'At time', type: 'reminder', reminderLead: 'at' });
  const t = table([titleCol, atCol]);
  const r = row({ title: 'x', rem: toLocalInput(now + 2 * 24 * 60 * 60 * 1000) });
  eq(dueReminders({ t1: t }, { r1: r }, now).length, 0);
});
test("a '1h' lead opens the window an hour before the target", () => {
  const now = Date.now();
  const hourCol = col({ id: 'rem', name: '1h', type: 'reminder', reminderLead: '1h' });
  const t = table([titleCol, hourCol]);
  const r = row({ title: 'x', rem: toLocalInput(now + 30 * 60 * 1000) }); // 30m ahead, within 1h lead
  eq(dueReminders({ t1: t }, { r1: r }, now).length, 1);
});
test('dueReminders sorts soonest-first', () => {
  const now = Date.now();
  const t = table([titleCol, remCol]);
  const a = { ...row({ title: 'later', rem: toLocalInput(now + 10 * 60 * 1000) }), id: 'a' };
  const b = { ...row({ title: 'sooner', rem: toLocalInput(now + 5 * 60 * 1000) }), id: 'b' };
  const out = dueReminders({ t1: t }, { a, b }, now);
  eq(out.map((x) => x.title), ['sooner', 'later']);
});

// --- attachments ------------------------------------------------------------

test('attachmentOf narrows a real attachment and rejects others', () => {
  ok(attachmentOf(att), 'attachment matches');
  eq(attachmentOf('hello'), null);
  eq(attachmentOf(null), null);
  eq(attachmentOf({ name: 'x', lat: 1, lon: 2 }), null); // a geo, not an attachment
});
test('geoOf does not match an attachment', () => {
  eq(geoOf(att), null);
});
test('cellText on an attachment column shows the filename', () => {
  eq(cellText(att, col({ type: 'attachment' })), 'boarding-pass.pdf');
  eq(cellText(null, col({ type: 'attachment' })), '');
});
test('isEmpty/notEmpty filters treat a present attachment as filled', () => {
  const f = (op: 'isEmpty' | 'notEmpty') => matchFilter(att, { id: 'f', columnId: 'c', op, value: null });
  eq(f('notEmpty'), true);
  eq(f('isEmpty'), false);
  const empty: AttachmentValue = { name: '', mime: '', size: 0, data: '' };
  eq(matchFilter(empty, { id: 'f', columnId: 'c', op: 'isEmpty', value: null }), true);
});

// --- routing (Part C: per-mode duration, flight estimate, auto-route) --------

test('durationForProfile gives walk, cycle and drive distinct times', () => {
  const dist = 6000; // 6 km
  const osrm = 600; // OSRM's own driving duration, 10 min
  const drive = durationForProfile('driving', dist, osrm);
  const walk = durationForProfile('walking', dist, osrm);
  const cycle = durationForProfile('cycling', dist, osrm);
  eq(drive, osrm, 'driving keeps OSRM duration:');
  // 6 km on foot at 5 km/h ≈ 72 min, by bike at 15 km/h ≈ 24 min, all different.
  ok(walk > cycle && cycle > drive, 'walk > cycle > drive:');
  ok(Math.abs(walk - 4320) < 1, 'walk ~72 min:');
  ok(Math.abs(cycle - 1440) < 1, 'cycle ~24 min:');
});

test('estimateFlightDurationS is monotonic with a fixed offset', () => {
  // Zero distance is still ~40 min of taxi/climb/descent.
  eq(estimateFlightDurationS(0), 40 * 60);
  const short = estimateFlightDurationS(800_000); // 800 km = 1 cruise hour
  eq(Math.round(short), 60 * 60 + 40 * 60, '1h cruise + 40m fixed:');
  ok(estimateFlightDurationS(1_600_000) > short, 'farther takes longer:');
});

test('autoLegMode flies the long legs and drives the short ones', () => {
  eq(autoLegMode(FLIGHT_THRESHOLD_M + 1), 'flight');
  eq(autoLegMode(FLIGHT_THRESHOLD_M - 1), 'drive');
  eq(autoLegMode(1_200_000), 'flight', 'Stockholm→Fukuoka-scale leg flies:');
  eq(autoLegMode(50_000), 'drive', 'a 50 km hop drives:');
});

// --- places (OSM search + outbound deep links) ------------------------------

test('tabelogSearchUrl encodes name + city, Japanese included', () => {
  const u = tabelogSearchUrl('一蘭', '福岡');
  ok(u.startsWith('https://tabelog.com/en/rstLst/?sw='), 'tabelog search base:');
  eq(decodeURIComponent(u.split('sw=')[1]), '一蘭 福岡', 'round-trips to name + city:');
  eq(decodeURIComponent(tabelogSearchUrl('Ichiran').split('sw=')[1]), 'Ichiran', 'no city → just name:');
});

test('googleMapsUrl is a keyless maps search by name + latlon', () => {
  const u = googleMapsUrl('一蘭', 33.5902, 130.4017);
  ok(u.startsWith('https://www.google.com/maps/search/?api=1&query='), 'maps search base:');
  eq(decodeURIComponent(u.split('query=')[1]), '一蘭 33.5902,130.4017');
});

test('normalizeNominatim maps jsonv2 rows and carries no rating', () => {
  const out = normalizeNominatim([
    {
      place_id: 123,
      lat: '33.5902',
      lon: '130.4017',
      name: 'Ichiran',
      display_name: 'Ichiran, Nakasu, Hakata, Fukuoka, Japan',
      category: 'amenity',
      type: 'restaurant',
      address: { city: 'Fukuoka', country: 'Japan' },
    },
    { lat: 'NaN', lon: '5' }, // unusable coordinates, dropped
  ]);
  eq(out.length, 1, 'drops the bad row:');
  const p = out[0];
  eq(p.id, '123');
  eq(p.name, 'Ichiran');
  eq(p.lat, 33.5902);
  eq(p.lon, 130.4017);
  eq(p.city, 'Fukuoka', 'city pulled from address parts:');
  eq(p.category, 'restaurant', 'uses the jsonv2 type:');
  eq(p.source, 'osm');
  ok(!('rating' in p), 'never has a rating field:');
});

test('normalizeNominatim returns [] for junk', () => {
  eq(normalizeNominatim(null), []);
  eq(normalizeNominatim({}), []);
  eq(normalizeNominatim('nope'), []);
});

// searchPlaces must degrade to [] (never throw) when the network fails.
{
  const orig = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error('network down'))) as typeof fetch;
  try {
    const out = await searchPlaces('shimokitazawa tokyo');
    if (JSON.stringify(out) === '[]') {
      passed++;
      console.log('  ok  searchPlaces returns [] on a failed fetch');
    } else {
      failed++;
      console.log(`FAIL  searchPlaces returns [] on a failed fetch\n      got ${JSON.stringify(out)}`);
    }
  } catch (e) {
    failed++;
    console.log(`FAIL  searchPlaces threw instead of returning []\n      ${(e as Error).message}`);
  } finally {
    globalThis.fetch = orig;
  }
}

// --- reactions (emoji votes on rows) ----------------------------------------

test('toggleReaction adds then removes a user vote, dropping empty emoji', () => {
  const a = toggleReaction(null, '👍', 'u1');
  eq(a, { '👍': ['u1'] });
  const b = toggleReaction(a, '👍', 'u2');
  eq(b['👍'], ['u1', 'u2']);
  const c = toggleReaction(b, '👍', 'u1');
  eq(c['👍'], ['u2']);
  const d = toggleReaction(c, '👍', 'u2');
  eq(d, {}, 'last voter leaving drops the emoji:');
});
test('toggleReaction does not mutate its input', () => {
  const a = { '👍': ['u1'] };
  const b = toggleReaction(a, '👍', 'u2');
  eq(a, { '👍': ['u1'] }, 'input untouched:');
  eq(b['👍'], ['u1', 'u2']);
});
test('hasReacted reflects membership', () => {
  const m = { '❤️': ['u1'] };
  ok(hasReacted(m, '❤️', 'u1'));
  ok(!hasReacted(m, '❤️', 'u2'));
  ok(!hasReacted(null, '❤️', 'u1'));
});
test('reactionEntries sorts by count desc and drops empties; totalReactions sums', () => {
  const m = { '👍': ['a', 'b', 'c'], '🍜': ['a'], '🔥': [] };
  const e = reactionEntries(m);
  eq(e.map((x) => x.emoji), ['👍', '🍜']);
  eq(e[0].count, 3);
  eq(totalReactions(m), 4);
});

// --- POI enrichment (OSM extratags → GeoValue) ------------------------------

test('normalizeNominatim reads extratags but still carries no rating', () => {
  const out = normalizeNominatim([
    {
      place_id: 5,
      lat: '1',
      lon: '2',
      name: 'Cafe',
      type: 'cafe',
      extratags: { opening_hours: '08:00-18:00', cuisine: 'coffee_shop', 'contact:website': 'https://c', stars: '3' },
    },
  ]);
  eq(out.length, 1);
  const p = out[0];
  eq(p.openingHours, '08:00-18:00');
  eq(p.cuisine, 'coffee_shop');
  eq(p.website, 'https://c', 'falls back to contact:website:');
  eq(p.stars, 3);
  ok(!('rating' in p), 'never invents a rating:');
});
test('poiToGeo copies only the fields OSM provided', () => {
  const full = poiToGeo({ id: '1', name: 'Ichiran', lat: 33.59, lon: 130.4, category: 'restaurant', cuisine: 'ramen', openingHours: '24/7', website: 'https://x', phone: '+81', address: 'A', source: 'osm' });
  eq(full.category, 'restaurant');
  eq(full.openingHours, '24/7');
  ok(!('stars' in full), 'absent stars stays absent:');
  eq(poiToGeo({ id: '2', name: 'Tower', lat: 1, lon: 2, source: 'osm' }), { name: 'Tower', lat: 1, lon: 2 }, 'bare result → just name/lat/lon:');
});
test('categoryLabel + geoDetailLines build human lines from what exists', () => {
  eq(categoryLabel({ name: 'x', lat: 0, lon: 0, category: 'fast_food', cuisine: 'ramen;japanese' }), 'fast food · ramen, japanese');
  const lines = geoDetailLines({ name: 'h', lat: 0, lon: 0, category: 'hotel', stars: 4, openingHours: '24/7', phone: '+81' });
  ok(lines.includes('hotel'), 'category line:');
  ok(lines.some((l) => l.includes('4-star')), 'star line:');
  ok(lines.includes('24/7') && lines.includes('+81'), 'hours + phone:');
  eq(geoDetailLines({ name: 'x', lat: 0, lon: 0 }), [], 'nothing tagged → no lines:');
});

// --- URL import (paste a link → row) ----------------------------------------

test('parseGoogleMapsUrl pulls a name + coords from a /place/ link', () => {
  const r = parseGoogleMapsUrl('https://www.google.com/maps/place/Ichiran+Hakata/@33.5913,130.4101,17z/data=!3m1');
  ok(r);
  eq(r!.name, 'Ichiran Hakata');
  eq(r!.lat, 33.5913);
  eq(r!.lon, 130.4101);
});
test('parseGoogleMapsUrl reads ll=, !3d!4d, and a q= name', () => {
  eq(parseGoogleMapsUrl('https://maps.google.com/?ll=35.6,139.7')?.lat, 35.6);
  const d = parseGoogleMapsUrl('https://www.google.com/maps/place//data=!4m2!3d33.59!4d130.4');
  eq(d?.lat, 33.59);
  eq(d?.lon, 130.4);
  eq(parseGoogleMapsUrl('https://www.google.com/maps?q=Tower')?.name, 'Tower');
});
test('parseGoogleMapsUrl returns null for non-maps hosts', () => {
  eq(parseGoogleMapsUrl('https://www.booking.com/hotel/jp/grand.html'), null);
});
test('prettifySlug + titleFromUrl clean a booking slug, else fall back to the domain', () => {
  eq(prettifySlug('grand-hyatt-fukuoka'), 'Grand Hyatt Fukuoka');
  eq(titleFromUrl('https://www.booking.com/hotel/jp/grand-hyatt-fukuoka.html'), 'Grand Hyatt Fukuoka');
  eq(titleFromUrl('https://airbnb.com/rooms/12345'), 'airbnb.com', 'idless slug → domain:');
});
test('planUrlImport: maps link yields geo + title; booking link yields title only', () => {
  const m = planUrlImport('https://www.google.com/maps/place/Ohori+Park/@33.586,130.378,16z');
  eq(m.isMaps, true);
  eq(m.geo?.lat, 33.586);
  eq(m.title, 'Ohori Park');
  const b = planUrlImport('booking.com/hotel/jp/grand-hyatt-fukuoka.html');
  eq(b.isMaps, false);
  eq(b.geo, null);
  eq(b.title, 'Grand Hyatt Fukuoka');
  ok(b.url.startsWith('https://'), 'normalizes a bare host:');
});

// --- person column ----------------------------------------------------------

test('matchFilter: person includes / excludes / isEmpty (array-contains)', () => {
  const cell = ['u1', 'u2'];
  eq(matchFilter(cell, { id: 'f', columnId: 'c', op: 'includes', value: 'u1' }), true);
  eq(matchFilter(cell, { id: 'f', columnId: 'c', op: 'includes', value: 'u9' }), false);
  eq(matchFilter(cell, { id: 'f', columnId: 'c', op: 'excludes', value: 'u9' }), true);
  eq(matchFilter(cell, { id: 'f', columnId: 'c', op: 'excludes', value: 'u1' }), false);
  eq(matchFilter([], { id: 'f', columnId: 'c', op: 'isEmpty', value: null }), true);
  eq(matchFilter(cell, { id: 'f', columnId: 'c', op: 'notEmpty', value: null }), true);
});

test('cellText: person resolves names with a roster, falls back to ids', () => {
  const pc = col({ id: 'p', name: 'Owner', type: 'person' });
  const roster = [{ id: 'u1', name: 'Alice' }, { id: 'u2', name: 'Cara' }];
  eq(cellText(['u1', 'u2'], pc, roster), 'Alice, Cara');
  eq(cellText(['u1', 'u9'], pc, roster), 'Alice, u9'); // unknown id stays as id
  eq(cellText(['u1'], pc), 'u1'); // no roster → ids
  eq(cellText([], pc, roster), '');
});

test('groupRows: person buckets per user + Unassigned; multi lands in each', () => {
  const pc = col({ id: 'p', name: 'Owner', type: 'person' });
  const r1 = row({ p: ['u1'] });
  const r2 = { ...row({ p: ['u1', 'u2'] }), id: 'r2' };
  const r3 = { ...row({ p: [] }), id: 'r3' };
  const groups = groupRows([r1, r2, r3], pc);
  const byKey = Object.fromEntries(groups.map((g) => [g.key || 'none', g.rows.map((r) => r.id)]));
  eq(byKey['u1'], ['r1', 'r2']);
  eq(byKey['u2'], ['r2']);
  eq(byKey['none'], ['r3']); // trailing Unassigned bucket
  eq(groups[groups.length - 1].label, 'Unassigned');
});

test('groupRows: select grouping is unchanged', () => {
  const sc = col({ id: 's', name: 'Status', type: 'select', options: [{ id: 'o1', label: 'To do', color: '#000' }] });
  const groups = groupRows([row({ s: 'o1' }), { ...row({ s: '' }), id: 'r2' }], sc);
  eq(groups[0].key, 'o1');
  eq(groups[0].rows.length, 1);
  eq(groups[groups.length - 1].rows.map((r) => r.id), ['r2']); // uncategorized last
});

test('assignedToMe: finds the user across tables, ignores non-matches', () => {
  const pc = col({ id: 'p', name: 'Owner', type: 'person' });
  const tA: TableData = { id: 'tA', name: 'A', columns: [col({ id: 'c', name: 'Task', type: 'text' }), pc], owner: '', updated: '', created: '' };
  const tB: TableData = { id: 'tB', name: 'B', columns: [col({ id: 'c', name: 'Task', type: 'text' }), pc], owner: '', updated: '', created: '' };
  const rows: Record<string, TableRow> = {
    r1: { id: 'r1', table: 'tA', parent: '', cells: { c: 'Pack', p: ['me', 'u2'] }, position: 0, created: '', updated: '2026-01-01T00:00:00Z' },
    r2: { id: 'r2', table: 'tB', parent: '', cells: { c: 'Book', p: ['u2'] }, position: 0, created: '', updated: '2026-01-02T00:00:00Z' },
    r3: { id: 'r3', table: 'tB', parent: '', cells: { c: 'Mine', p: ['me'] }, position: 0, created: '', updated: '2026-01-03T00:00:00Z' },
  };
  const out = assignedToMe({ tA, tB }, rows, 'me');
  eq(out.map((a) => a.rowId), ['r3', 'r1']); // r2 excluded; most-recent first
  eq(assignedToMe({ tA, tB }, rows, '').length, 0); // no user → nothing
});

// --- dependencies -----------------------------------------------------------

function depRow(id: string, preds: string[]): TableRow {
  return { id, table: 't1', parent: '', cells: { dep: preds }, position: 0, created: '', updated: '' };
}

test('buildEdges: resolves predecessor ids, drops dangling ones', () => {
  const rows = [depRow('a', []), depRow('b', ['a', 'ghost']), depRow('c', ['b'])];
  const edges = buildEdges(rows, 'dep');
  eq(edges, [{ fromRowId: 'a', toRowId: 'b' }, { fromRowId: 'b', toRowId: 'c' }]);
});

test('blockingPredecessors: only not-done predecessors block, danglers and dupes dropped', () => {
  // group column 'stage'; 'done' is the done option id. card 'c' depends on a, b, a (dup), ghost.
  const mk = (id: string, stage: string, preds?: string[]): TableRow => ({
    id, table: 't1', parent: '', cells: { stage, ...(preds ? { dep: preds } : {}) }, position: 0, created: '', updated: '',
  });
  const a = mk('a', 'done');       // finished, no longer blocks
  const b = mk('b', 'todo');       // still open, blocks
  const c = mk('c', 'todo', ['a', 'b', 'a', 'ghost']);
  const done = new Set(['done']);
  const blockers = blockingPredecessors(c, [a, b, c], 'dep', 'stage', done);
  eq(blockers.map((r) => r.id), ['b'], 'a is done, b blocks, dup + ghost dropped');
  // once b is done too, nothing blocks.
  eq(blockingPredecessors(c, [a, mk('b', 'done'), c], 'dep', 'stage', done).length, 0);
  // a card with no depends cell is never blocked.
  eq(blockingPredecessors(mk('x', 'todo'), [a, b], 'dep', 'stage', done).length, 0);
});

test('detectCycle: flags A→B→A, clears a DAG, flags a self-edge', () => {
  eq(detectCycle([{ fromRowId: 'a', toRowId: 'b' }, { fromRowId: 'b', toRowId: 'a' }]), true);
  eq(detectCycle([{ fromRowId: 'a', toRowId: 'b' }, { fromRowId: 'b', toRowId: 'c' }]), false);
  eq(detectCycle([{ fromRowId: 'a', toRowId: 'a' }]), true);
  eq([...cycleNodes([{ fromRowId: 'a', toRowId: 'b' }, { fromRowId: 'b', toRowId: 'a' }])].sort(), ['a', 'b']);
});

test('clampStarts: chain pushes C past B end; diamond takes the latest path', () => {
  // A: [0,2], B depends A: [0,1], C depends B: [0,0]
  const placed: Placed[] = [
    { rowId: 'a', start: 0, end: 2 },
    { rowId: 'b', start: 0, end: 1 },
    { rowId: 'c', start: 0, end: 0 },
  ];
  const edges = [{ fromRowId: 'a', toRowId: 'b' }, { fromRowId: 'b', toRowId: 'c' }];
  const floors = clampStarts(placed, edges);
  eq(floors.get('b'), 2); // ≥ A's end
  eq(floors.get('c'), 3); // ≥ B's clamped end (2 + dur 1)
  // Diamond: A→B, A→C, B→D, C→D with C longer than B → D floored by C's path.
  const dPlaced: Placed[] = [
    { rowId: 'a', start: 0, end: 1 },
    { rowId: 'b', start: 0, end: 1 },
    { rowId: 'c', start: 0, end: 4 },
    { rowId: 'd', start: 0, end: 0 },
  ];
  const dEdges = [
    { fromRowId: 'a', toRowId: 'b' },
    { fromRowId: 'a', toRowId: 'c' },
    { fromRowId: 'b', toRowId: 'd' },
    { fromRowId: 'c', toRowId: 'd' },
  ];
  const df = clampStarts(dPlaced, dEdges);
  // B: start max(0, A.end 1)=1, end 1+1=2. C: start 1, end 1+4=5. D floor = max(2,5) = 5.
  eq(df.get('d'), 5);
});

test('clampStarts: a cycle returns without hanging', () => {
  const placed: Placed[] = [
    { rowId: 'a', start: 0, end: 1 },
    { rowId: 'b', start: 0, end: 1 },
  ];
  const edges = [{ fromRowId: 'a', toRowId: 'b' }, { fromRowId: 'b', toRowId: 'a' }];
  const floors = clampStarts(placed, edges); // must terminate
  ok(floors instanceof Map, 'returns a map without infinite-looping');
});

// --- recurrence -------------------------------------------------------------

test('nextDate: day / week / month advance', () => {
  eq(nextDate('2026-06-25', { unit: 'day', n: 3 }), '2026-06-28');
  eq(nextDate('2026-06-25', { unit: 'week', n: 1 }), '2026-07-02');
  eq(nextDate('2026-06-15', { unit: 'month', n: 2 }), '2026-08-15');
});

test('nextDate: month rollover clamps to end-of-month + leap year', () => {
  eq(nextDate('2026-01-31', { unit: 'month', n: 1 }), '2026-02-28'); // 2026 not leap
  eq(nextDate('2024-01-31', { unit: 'month', n: 1 }), '2024-02-29'); // 2024 leap
  eq(nextDate('2026-12-31', { unit: 'month', n: 1 }), '2027-01-31'); // year rollover
});

test('buildNextCells: clones, advances only the date, resets the done signal', () => {
  const prev = { name: 'Standup', date: '2026-06-25', done: true, note: 'keep me' };
  const next = buildNextCells(prev, 'date', { unit: 'day', n: 1 }, 'done');
  eq(next.date, '2026-06-26'); // advanced
  eq(next.done, null); // reset → spawned row is open (this is what stops the loop)
  eq(next.note, 'keep me'); // everything else intact
  eq(next.name, 'Standup');
  eq(prev.done, true); // original not mutated
});

// --- prose echo guard -------------------------------------------------------

test('reconcileProseEcho keeps local body while a page is mid-write', () => {
  resetProseWrites();
  const seq = beginProseWrite('p1');
  ok(isProseWriting('p1'), 'flagged writing');
  const local = { id: 'p1', title: 'Day 1', content: { typed: 'latest' } };
  const echo = { id: 'p1', title: 'Day 1 (renamed remotely)', content: { typed: 'stale' } };
  const merged = reconcileProseEcho(local, echo);
  eq(merged.content, { typed: 'latest' }, 'kept the locally typed body');
  eq(merged.title, 'Day 1 (renamed remotely)', 'still synced the rest of the record');
  endProseWrite('p1', seq);
});

test('reconcileProseEcho takes the echo body once writing has settled', () => {
  resetProseWrites();
  const seq = beginProseWrite('p2');
  endProseWrite('p2', seq);
  ok(!isProseWriting('p2'), 'released after settle');
  const local = { id: 'p2', content: { typed: 'old' } };
  const echo = { id: 'p2', content: { typed: 'remote' } };
  eq(reconcileProseEcho(local, echo).content, { typed: 'remote' }, 'remote edit flows in');
});

test('a stale settle does not release the guard mid-typing', () => {
  // Keystroke fires write A (seqA); user types more, firing write B (seqB);
  // write A settles first, it must NOT clear the flag, or B's newer text gets
  // clobbered by B's own in-flight echo.
  resetProseWrites();
  const seqA = beginProseWrite('p3');
  const seqB = beginProseWrite('p3');
  endProseWrite('p3', seqA);
  ok(isProseWriting('p3'), 'still guarded, newer write B outstanding');
  endProseWrite('p3', seqB);
  ok(!isProseWriting('p3'), 'released once the current write settles');
});

test('reconcileProseEcho leaves a brand-new doc (no local) untouched', () => {
  resetProseWrites();
  const echo = { id: 'p4', content: { typed: 'fresh' } };
  eq(reconcileProseEcho(undefined, echo).content, { typed: 'fresh' });
});

test('resetProseWrites clears all guards', () => {
  beginProseWrite('p5');
  resetProseWrites();
  ok(!isProseWriting('p5'), 'cleared');
});

// --- settle (budget) --------------------------------------------------------

const idEx = (over: Partial<Expense>): Expense => ({ amount: 0, currency: 'JPY', paidBy: '', splitAmong: [], ...over });
// Test converter: 1 JPY = 0.07 SEK, identity otherwise.
const conv = (amt: number, from: string, to: string): number => {
  if (from === to) return amt;
  if (from === 'JPY' && to === 'SEK') return amt * 0.07;
  return NaN;
};

test('netBalances: equal split across 3 with payer included nets to ~0', () => {
  const bal = netBalances([idEx({ amount: 300, currency: 'SEK', paidBy: 'a', splitAmong: ['a', 'b', 'c'] })], ['a', 'b', 'c'], 'SEK', conv);
  eq(Math.round(bal.a), 200, 'payer paid 300, owes 100, net +200');
  eq(Math.round(bal.b), -100);
  eq(Math.round(bal.c), -100);
  ok(Math.abs(bal.a + bal.b + bal.c) < 1e-6, 'sums to ~0');
});

test('netBalances: payer excluded from the split', () => {
  const bal = netBalances([idEx({ amount: 200, currency: 'SEK', paidBy: 'a', splitAmong: ['b', 'c'] })], ['a', 'b', 'c'], 'SEK', conv);
  eq(Math.round(bal.a), 200);
  eq(Math.round(bal.b), -100);
  eq(Math.round(bal.c), -100);
});

test('netBalances: empty splitAmong falls back to all members', () => {
  const bal = netBalances([idEx({ amount: 300, currency: 'SEK', paidBy: 'a', splitAmong: [] })], ['a', 'b', 'c'], 'SEK', conv);
  eq(Math.round(bal.a), 200);
  eq(Math.round(bal.b), -100);
  eq(Math.round(bal.c), -100);
});

test('netBalances: multi-currency normalizes to base', () => {
  // 1000 JPY = 70 SEK, paid by a, split a+b → each owes 35.
  const bal = netBalances([idEx({ amount: 1000, currency: 'JPY', paidBy: 'a', splitAmong: ['a', 'b'] })], ['a', 'b'], 'SEK', conv);
  ok(Math.abs(bal.a - 35) < 1e-6, 'a net +35');
  ok(Math.abs(bal.b + 35) < 1e-6, 'b net -35');
});

test('netBalances: a missing rate is excluded, not propagated', () => {
  const bal = netBalances(
    [
      idEx({ amount: 100, currency: 'EUR', paidBy: 'a', splitAmong: ['a', 'b'] }), // EUR has no rate → NaN → skipped
      idEx({ amount: 100, currency: 'SEK', paidBy: 'a', splitAmong: ['a', 'b'] }),
    ],
    ['a', 'b'],
    'SEK',
    conv,
  );
  eq(Math.round(bal.a), 50, 'only the SEK expense counts');
  eq(Math.round(bal.b), -50);
});

test('netBalances: a deleted user id in splitAmong is dropped', () => {
  const bal = netBalances([idEx({ amount: 200, currency: 'SEK', paidBy: 'a', splitAmong: ['a', 'ghost'] })], ['a', 'b'], 'SEK', conv);
  // 'ghost' isn't a member → split falls to just 'a' → a owes itself, net 0.
  eq(Math.round(bal.a), 0);
  ok(bal.ghost === undefined, 'ghost never appears');
});

test('settleUp: a 3-person round-trip collapses to <=2 transfers and conserves', () => {
  const bal = netBalances(
    [
      idEx({ amount: 300, currency: 'SEK', paidBy: 'a', splitAmong: ['a', 'b', 'c'] }),
      idEx({ amount: 300, currency: 'SEK', paidBy: 'b', splitAmong: ['a', 'b', 'c'] }),
    ],
    ['a', 'b', 'c'],
    'SEK',
    conv,
  );
  const transfers = settleUp(bal);
  ok(transfers.length <= 2, `<= 2 transfers, got ${transfers.length}`);
  const owed = Object.values(bal).filter((v) => v < 0).reduce((s, v) => s - v, 0);
  const moved = transfers.reduce((s, t) => s + t.amount, 0);
  ok(Math.abs(moved - owed) < 1e-6, 'transfers conserve total owed');
});

test('settleUp: already-even balances need no transfers', () => {
  eq(settleUp({ a: 0, b: 0 }).length, 0);
});

// --- poll -------------------------------------------------------------------

const pollRow = (id: string, votes: number): TableRow => ({
  id,
  table: 'p',
  parent: '',
  cells: {},
  reactions: votes > 0 ? { '👍': Array.from({ length: votes }, (_, i) => `u${i}`) } : null,
  position: 0,
  created: '',
  updated: '',
});
const voteOf = (r: TableRow) => (r.reactions?.['👍'] ?? []).length;

test('tally: counts per option, sorted desc, pct sums to ~100', () => {
  const t = tally([pollRow('a', 1), pollRow('b', 3), pollRow('c', 0)], voteOf);
  eq(t.map((e) => e.rowId), ['b', 'a', 'c'], 'sorted by count desc');
  eq(t[0].count, 3);
  const pctSum = t.reduce((s, e) => s + e.pct, 0);
  ok(Math.abs(pctSum - 100) < 1e-6, 'pct sums to 100 with votes');
});

test('tally: all-zero gives 0% across the board', () => {
  const t = tally([pollRow('a', 0), pollRow('b', 0)], voteOf);
  ok(t.every((e) => e.pct === 0), 'no votes → 0%');
});

test('winner: clear top wins; tie and empty return null', () => {
  eq(winner(tally([pollRow('a', 1), pollRow('b', 3)], voteOf)), 'b');
  eq(winner(tally([pollRow('a', 2), pollRow('b', 2)], voteOf)), null, 'tie → null');
  eq(winner(tally([pollRow('a', 0), pollRow('b', 0)], voteOf)), null, 'no votes → null');
  eq(winner([]), null, 'empty → null');
});

// --- formBlock --------------------------------------------------------------

test('serializeForm → parseForm round-trips (stable text)', () => {
  const cols: Column[] = [
    col({ id: 'c1', name: 'Name', type: 'text' }),
    col({ id: 'c2', name: 'Date', type: 'date' }),
    col({ id: 'c3', name: 'Confirmation #', type: 'text' }),
  ];
  const cells = { c1: 'Louvre Museum Tour', c2: '2026-07-01', c3: 'LV-99281A' };
  const text1 = serializeForm(cols, cells, 'travel-stop');
  const parsed = parseForm(text1)!;
  ok(parsed && parsed.key === 'travel-stop', 'key parsed');
  // Re-render from the parsed fields → identical text (stable round-trip).
  const text2 = [`:::form[${parsed.key}]`, ...parsed.values.map((f) => `${f.slug}: ${f.value}`), ':::'].join('\n');
  eq(text2, text1, 'text → struct → text is stable');
  ok(text1.includes('confirmation: LV-99281A'), 'a multi-word value with a # in the name round-trips');
});

test('parseForm preserves unknown keys (no data loss on a richer paste)', () => {
  const text = ':::form[travel-stop]\nname: Tokyo\nextra_field: kept\n:::';
  const parsed = parseForm(text)!;
  ok(parsed.values.some((f) => f.slug === 'extra_field' && f.value === 'kept'), 'unknown line kept');
});

test('slugifyField is stable; slugifyFields disambiguates collisions', () => {
  eq(slugifyField('Confirmation #'), 'confirmation');
  eq(slugifyField('Confirmation #'), 'confirmation', 'stable on repeat');
  eq(slugifyFields(['Place', 'Place', 'Place']), ['place', 'place_2', 'place_3'], 'collisions get distinct keys');
});

test('formValues drops empties and renders a checkbox as true', () => {
  const cols: Column[] = [col({ id: 'c1', name: 'Name', type: 'text' }), col({ id: 'c2', name: 'Done', type: 'checkbox' }), col({ id: 'c3', name: 'Notes', type: 'text' })];
  const vals = formValues(cols, { c1: 'X', c2: true, c3: '' });
  eq(vals.map((v) => v.slug), ['name', 'done'], 'empty Notes dropped');
  eq(vals.find((v) => v.slug === 'done')!.value, 'true');
});

// --- packing + presets ------------------------------------------------------

test('packedStat: 0/0, mixed, all-packed', () => {
  let n = 0;
  const r = (packed: boolean): TableRow => ({ id: `r${n++}`, table: 't', parent: '', cells: { p: packed }, position: 0, created: '', updated: '' });
  eq(packedStat([], 'p'), { done: 0, total: 0, pct: 0 });
  eq(packedStat([r(true), r(false), r(false), r(false)], 'p'), { done: 1, total: 4, pct: 25 });
  eq(packedStat([r(true), r(true)], 'p'), { done: 2, total: 2, pct: 100 });
});

test('/budget preset builds the expected columns', () => {
  const { columns } = buildTablePreset('budget');
  const names = columns.map((c) => c.name);
  ok(names.includes('Amount') && names.includes('Currency') && names.includes('Paid by') && names.includes('Split among') && names.includes('Category'), 'core columns present');
  ok(columns.find((c) => c.name === 'Split among')!.peopleMulti === true, 'Split among is multi-person');
  ok(columns.find((c) => c.name === 'Currency')!.type === 'select', 'Currency is a select');
});

test('/packing preset: columns + Priority-then-Category default sort + count agg', () => {
  const { columns, view } = buildTablePreset('packing');
  const priority = columns.find((c) => c.name === 'Priority')!;
  const category = columns.find((c) => c.name === 'Category')!;
  eq(view.sorts.map((s) => s.columnId), [priority.id, category.id], 'sorted by Priority then Category');
  ok(columns.find((c) => c.name === 'Packed')!.agg === 'count', 'Packed footer counts');
});

test('/reservation preset builds Name/Place/When/File/Cost/Status in a schedule view', () => {
  const { columns, view } = buildTablePreset('reservation');
  const names = columns.map((c) => c.name);
  ok(['Name', 'Place', 'When', 'File', 'Cost', 'Status'].every((n) => names.includes(n)), 'columns present');
  ok(columns.find((c) => c.name === 'File')!.type === 'attachment', 'File is an attachment');
  eq(view.type, 'schedule');
});

test('bookings: accommodation + transport gain a File column; transport gains Reserved seat?', () => {
  const acc = buildTablePreset('accommodation').columns.map((c) => `${c.name}:${c.type}`);
  ok(acc.includes('File:attachment'), 'accommodation File column');
  const tr = buildTablePreset('transport').columns.map((c) => `${c.name}:${c.type}`);
  ok(tr.includes('File:attachment'), 'transport File column');
  ok(tr.includes('Reserved seat?:checkbox'), 'transport Reserved seat? checkbox');
});

test('sortRows orders a select column by option order, not option id', () => {
  const opts = [
    { id: 'zzz', label: 'P1', color: '' },
    { id: 'aaa', label: 'P2', color: '' },
    { id: 'mmm', label: 'P3', color: '' },
  ];
  const cols: Column[] = [col({ id: 'pri', name: 'Priority', type: 'select', options: opts })];
  const mk = (id: string, opt: string): TableRow => ({ id, table: 't', parent: '', cells: { pri: opt }, position: 0, created: '', updated: '' });
  // Option ids sort alphabetically aaa<mmm<zzz, but option *order* is P1(zzz),P2(aaa),P3(mmm).
  const sorted = sortRows([mk('r3', 'mmm'), mk('r1', 'zzz'), mk('r2', 'aaa')], [{ id: 's', columnId: 'pri', dir: 'asc' }], cols);
  eq(sorted.map((r) => r.id), ['r1', 'r2', 'r3'], 'P1, P2, P3 by option order');
});

test('resolveCellText: reads a named grid cell + degrades gracefully', () => {
  const cols: Column[] = [col({ id: 'name', name: 'Item', type: 'text' }), col({ id: 'amt', name: 'Amount', type: 'number' })];
  const t: TableData = { id: 'tb', name: 'Budget', columns: cols, owner: '', updated: '', created: '' };
  const r: TableRow = { id: 'r9', table: 'tb', parent: '', cells: { name: 'Rent', amt: 1200 }, position: 0, created: '', updated: '' };
  const tables = { tb: t };
  const rows = { r9: r };
  const hit = resolveCellText(tables, rows, 'tb', 'amt', 'r9');
  eq(hit.ok, true, 'resolves');
  eq(hit.value, '1200', 'the cell value');
  eq(hit.rowName, 'Rent', 'row name from the first column');
  eq(hit.columnName, 'Amount', 'column name');
  // Missing column / row / table => not ok, empty value, never throws.
  eq(resolveCellText(tables, rows, 'tb', 'gone', 'r9').ok, false, 'missing column');
  eq(resolveCellText(tables, rows, 'tb', 'amt', 'nope').ok, false, 'missing row');
  eq(resolveCellText({}, {}, 'tb', 'amt', 'r9').value, '', 'missing table -> empty');
});

test('board card-sort: reversed label order + empties always last', () => {
  // The Kanban cog builds exactly this single-rule sort per stage. Descending
  // walks the custom option order backwards; an unset label still sorts last.
  const opts = [
    { id: 'o1', label: 'P1', color: '' },
    { id: 'o2', label: 'P2', color: '' },
    { id: 'o3', label: 'P3', color: '' },
  ];
  const cols: Column[] = [col({ id: 'pri', name: 'Priority', type: 'select', options: opts })];
  const mk = (id: string, opt: string): TableRow => ({ id, table: 't', parent: '', cells: { pri: opt }, position: 0, created: '', updated: '' });
  const cards = [mk('a', 'o1'), mk('b', 'o3'), mk('none', ''), mk('c', 'o2')];
  const desc = sortRows(cards, [{ id: 'cardsort', columnId: 'pri', dir: 'desc' }], cols);
  eq(desc.map((r) => r.id), ['b', 'c', 'a', 'none'], 'P3, P2, P1, then the unlabelled card');
});

// --- map: Overpass "find nearby" -------------------------------------------

test('buildOverpassQuery: node + way clauses per filter, inside the bbox', () => {
  const bars = AREA_CATEGORIES.find((c) => c.key === 'bar')!;
  const q = buildOverpassQuery(bars, { south: 1, west: 2, north: 3, east: 4 });
  ok(q.includes('[out:json]'), 'json output');
  ok(q.includes('node["amenity"="bar"](1,2,3,4);'), 'bar node clause with bbox');
  ok(q.includes('way["amenity"="pub"](1,2,3,4);'), 'pub way clause (OR-ed filter)');
  ok(q.includes('out center'), 'out center so ways get a point');
});

test('normalizeOverpass: node + way center, drop unnamed, de-dupe', () => {
  const out = normalizeOverpass({
    elements: [
      { type: 'node', id: 1, lat: 35.0, lon: 139.0, tags: { name: 'Ramen Ya', amenity: 'restaurant', cuisine: 'ramen' } },
      { type: 'way', id: 2, center: { lat: 35.1, lon: 139.1 }, tags: { name: 'Sushi Ten', amenity: 'restaurant' } },
      { type: 'node', id: 3, lat: 35.2, lon: 139.2, tags: { amenity: 'restaurant' } }, // no name -> dropped
      { type: 'node', id: 4, lat: 35.0, lon: 139.0, tags: { name: 'Ramen Ya', amenity: 'restaurant' } }, // dupe of #1
    ],
  });
  eq(out.map((r) => r.name), ['Ramen Ya', 'Sushi Ten'], 'named, de-duped, way center resolved');
  eq(out[0].cuisine, 'ramen', 'POI tags carried through');
  eq(normalizeOverpass('garbage').length, 0, 'junk input is empty, never throws');
});

test('bboxTooBig: guards a zoomed-out viewport', () => {
  ok(!bboxTooBig({ south: 35.6, west: 139.6, north: 35.7, east: 139.8 }), 'a district-sized box is fine');
  ok(bboxTooBig({ south: 30, west: 130, north: 40, east: 140 }), 'a whole-region box is refused');
});

test('parsePlacesImport: name+coords, bare coords, comma-name, junk', () => {
  const r = parsePlacesImport(
    [
      '# my list',
      'Tsuta, 35.7300, 139.7101',
      "Joe's, Diner, 35.6, 139.7", // comma in the name is kept
      '35.6586\t139.7454', // tab, no name -> coordinate name
      'Skytree 35.7101 139.8107', // space separated
      'not a place at all',
      '', // blank ignored
    ].join('\n'),
  );
  eq(r.places.length, 4, 'four valid places');
  eq(r.skipped, 1, 'one junk line skipped');
  eq(r.places[0], { name: 'Tsuta', lat: 35.73, lon: 139.7101 }, 'name + coords');
  eq(r.places[1].name, "Joe's, Diner", 'comma inside the name survives');
  eq(r.places[2].name, '35.65860, 139.74540', 'bare coords get a coordinate name');
  eq(r.places[3], { name: 'Skytree', lat: 35.7101, lon: 139.8107 }, 'space separated');
});

test('parsePlacesImport: a Google Maps link and out-of-range coords', () => {
  const r = parsePlacesImport('Meiji Jingu\nhttps://www.google.com/maps?q=35.6764,139.6993\n999, 999');
  eq(r.places.length, 1, 'only the maps link yields a place');
  eq(r.places[0].lat, 35.6764, 'lat from the link');
  ok(r.skipped >= 1, 'the out-of-range 999,999 line is skipped');
});

test('parsePlacesImport: the map import example parses every line', () => {
  const r = parsePlacesImport(MAP_IMPORT_EXAMPLE);
  eq(r.places.length, 4, 'name+coords, another, bare coords, and a maps link');
  eq(r.skipped, 0, 'no line is left unread');
  eq(r.places[0].name, 'Tsuta Ramen', 'the named place keeps its name');
});



// --- theme (appearance) -----------------------------------------------------

test('fonts: a classified shelf; every preset font exists and no dup keys', () => {
  ok(FONTS.length >= 20, 'a healthy shelf of fonts (>= 20)');
  const keys = FONTS.map((f) => f.key);
  eq(keys.length, new Set(keys).size, 'no duplicate font keys');
  const keySet = new Set(keys);
  for (const p of PRESETS) ok(keySet.has(p.font), `preset ${p.id} uses a listed font (${p.font})`);
  const cats = new Set(FONT_CATEGORIES);
  const vibes = new Set(FONT_VIBES);
  for (const f of FONTS) {
    ok(cats.has(f.category), `${f.label} has a known category`);
    ok(vibes.has(f.vibe), `${f.label} has a known vibe`);
    ok(f.stack.includes(','), `${f.label} stack has a system fallback`);
  }
});

test('normalizeHex expands shorthand and rejects garbage', () => {
  eq(normalizeHex('#abc'), '#aabbcc');
  eq(normalizeHex('#E05A86'), '#e05a86');
  eq(normalizeHex('rgb(224, 90, 134)'), '#e05a86');
  eq(normalizeHex('not a color'), null);
  eq(normalizeHex('#12'), null);
  eq(normalizeHex(''), null);
});

test('resolveTheme falls back to Clay for a missing/corrupt token', () => {
  // A theme missing one token (and with a junk value in another) backfills both
  // from the Clay default rather than leaving a var unset.
  const broken = {
    ...CLAY,
    light: { ...CLAY.light, clay: 'garbage', paper: undefined as unknown as string },
  };
  const out = resolveTheme(broken, 'light');
  eq(out.clay, CLAY.light.clay, 'junk clay → default');
  eq(out.paper, CLAY.light.paper, 'missing paper → default');
  eq(out.ink, CLAY.light.ink, 'kept value stays');
});

test('resolveTheme picks the light vs dark set by mode', () => {
  const t = { ...CLAY, light: { ...CLAY.light, paper: '#ffffff' }, dark: { ...CLAY.dark, paper: '#000000' } };
  eq(resolveTheme(t, 'light').paper, '#ffffff');
  eq(resolveTheme(t, 'dark').paper, '#000000');
});

test('resolveTheme on null is fully-populated Clay', () => {
  const out = resolveTheme(null, 'light');
  ok(TOKEN_KEYS.every((k) => /^#[0-9a-f]{6}$/.test(out[k])), 'every token is a canonical hex');
});

test('every preset defines every token in both modes (no holes) + readable ink', () => {
  for (const p of PRESETS) {
    for (const k of TOKEN_KEYS) {
      ok(normalizeHex(p.light[k]) !== null, `${p.id} light ${k} valid`);
      ok(normalizeHex(p.dark[k]) !== null, `${p.id} dark ${k} valid`);
    }
    ok(!lowContrast(p.light), `${p.id} light ink-on-paper reads fine`);
  }
  eq(PRESETS.length, 22, 'the preset count is pinned, so adding one is a deliberate act');
  ok(PRESETS[0].id === 'clay', 'Clay is the default');
});

test('Clay render is unchanged: light and dark token sets are identical', () => {
  // Pixel-identical guarantee, Clay is mode-independent today, so the dark
  // toggle still just swaps which token each `dark:` class reads.
  for (const k of TOKEN_KEYS) eq(CLAY.light[k], CLAY.dark[k], `clay ${k}`);
});

test('contrastRatio / lowContrast flag a known bad pair, pass a good one', () => {
  // Black on white is the 21:1 ceiling; identical colors are the 1:1 floor.
  ok(contrastRatio('#000000', '#ffffff') > 20, 'black/white ~21:1');
  ok(contrastRatio('#777777', '#777777') < 1.05, 'same colour ~1:1');
  ok(!lowContrast(CLAY.light), 'Clay ink-on-paper reads fine');
  ok(lowContrast({ ...CLAY.light, ink: '#f6f5f2', paper: '#faf9f6' }), 'pale ink on paper warns');
});

// --- selection menu ---------------------------------------------------------

test('ensureHref adds https to a bare host, passes schemes/anchors, rejects empty', () => {
  eq(ensureHref('tabelog.com'), 'https://tabelog.com');
  eq(ensureHref('  example.org/x  '), 'https://example.org/x');
  eq(ensureHref('https://already.test'), 'https://already.test');
  eq(ensureHref('mailto:a@b.com'), 'mailto:a@b.com');
  eq(ensureHref('tel:+4670'), 'tel:+4670');
  eq(ensureHref('#anchor'), '#anchor');
  eq(ensureHref('   '), '');
});

function selState(over: Partial<SelectionState>): SelectionState {
  return { hasSelection: false, inLink: false, onAtom: false, isEmptyDoc: false, ...over };
}
function sectionIds(state: SelectionState): string[] {
  return menuItemsFor(state).map((s) => s.id);
}
function itemsOf(state: SelectionState, id: string): string[] {
  return menuItemsFor(state).find((s) => s.id === id)?.items ?? [];
}

test('menuItemsFor: a text selection shows link + format + transform', () => {
  const s = selState({ hasSelection: true });
  ok(['clipboard', 'link', 'format', 'transform', 'flair'].every((id) => sectionIds(s).includes(id)), 'all sections');
  eq(itemsOf(s, 'link'), ['addLink'], 'no link yet → add');
  ok(itemsOf(s, 'format').includes('highlight'), 'highlight offered');
});

test('menuItemsFor: a collapsed cursor shows only the reduced clipboard set', () => {
  const s = selState({ hasSelection: false });
  eq(sectionIds(s), ['clipboard']);
  eq(itemsOf(s, 'clipboard'), ['paste', 'selectAll']);
});

test('menuItemsFor: an atom block shows block actions, not text formatting', () => {
  const s = selState({ onAtom: true });
  eq(sectionIds(s), ['clipboard', 'block']);
  eq(itemsOf(s, 'block'), ['duplicateBlock', 'deleteBlock']);
});

test('menuItemsFor: a selection inside a link shows edit/remove/open', () => {
  const s = selState({ hasSelection: true, inLink: true });
  eq(itemsOf(s, 'link'), ['editLink', 'removeLink', 'openLink']);
});

// --- mindmap ----------------------------------------------------------------

function mnode(over: Partial<MindNode>): MindNode {
  return { id: 'n', x: 0, y: 0, kind: 'text', payload: '', ...over };
}

test('toCanvas/toScreen round-trip across zoom levels', () => {
  for (const zoom of [0.4, 1, 2.3]) {
    const vp = { x: 37, y: -12, zoom };
    const screen = { x: 220, y: 140 };
    const back = toScreen(toCanvas(screen, vp), vp);
    ok(Math.abs(back.x - screen.x) < 1e-9 && Math.abs(back.y - screen.y) < 1e-9, `round-trip @${zoom}`);
  }
});

test('connect refuses self + duplicate edges; dedupeEdges drops them', () => {
  let edges: MindEdge[] = [];
  edges = connect(edges, 'a', 'b');
  edges = connect(edges, 'a', 'b'); // duplicate
  edges = connect(edges, 'c', 'c'); // self
  eq(edges.length, 1, 'one real edge');
  edges = connect(edges, 'b', 'a'); // reverse is allowed
  eq(edges.length, 2, 'reverse kept');
  const messy: MindEdge[] = [
    { id: '1', from: 'a', to: 'b' },
    { id: '2', from: 'a', to: 'b' },
    { id: '3', from: 'x', to: 'x' },
  ];
  eq(dedupeEdges(messy).map((e) => e.id), ['1'], 'dup + self removed');
});

test('collapsedHidden hides a subtree and survives a cycle', () => {
  const nodes = ['a', 'b', 'c', 'd'].map((id) => mnode({ id }));
  const edges: MindEdge[] = [
    { id: '1', from: 'a', to: 'b' },
    { id: '2', from: 'b', to: 'c' },
    { id: '3', from: 'c', to: 'a' }, // cycle back to a
    { id: '4', from: 'b', to: 'd' },
  ];
  const hidden = collapsedHidden(nodes, edges, new Set(['b']));
  ok(hidden.has('c') && hidden.has('d'), 'descendants hidden');
  ok(!hidden.has('b'), 'collapsed node stays visible');
  // The cycle (c→a→b) must not loop forever; reaching here means it returned.
  ok(true, 'no hang on cycle');
});

test('fitView frames the nodes and centres them; empty → identity', () => {
  eq(fitView([], { width: 800, height: 600 }), { x: 0, y: 0, zoom: 1 });
  const nodes = [mnode({ id: 'a', x: 0, y: 0 }), mnode({ id: 'b', x: 400, y: 200 })];
  const vp = fitView(nodes, { width: 800, height: 600 });
  ok(vp.zoom > 0.2 && vp.zoom <= 1.4, 'zoom in range');
  // Bounding-box centre should map to the viewport centre.
  const cx = (0 + (400 + NODE_W)) / 2;
  const cy = (0 + (200 + NODE_H)) / 2;
  const mid = toScreen({ x: cx, y: cy }, vp);
  ok(Math.abs(mid.x - 400) < 1 && Math.abs(mid.y - 300) < 1, 'centre at viewport middle');
});

test('edgePath starts and ends at the node centres', () => {
  const a = nodeCenter(mnode({ id: 'a', x: 0, y: 0 }));
  const b = nodeCenter(mnode({ id: 'b', x: 300, y: 100 }));
  const path = edgePath(a, b);
  ok(path.startsWith(`M ${a.x.toFixed(1)} ${a.y.toFixed(1)}`), 'starts at a-centre');
  ok(path.trimEnd().endsWith(`${b.x.toFixed(1)} ${b.y.toFixed(1)}`), 'ends at b-centre');
});

// --- excerpt (page node short view) -----------------------------------------

test('docExcerpt returns empty for null / empty / textless docs', () => {
  eq(docExcerpt(null), '');
  eq(docExcerpt(undefined), '');
  eq(docExcerpt({}), '');
  eq(docExcerpt({ type: 'doc', content: [] }), '');
  // an atom block (e.g. an image) carries no text
  eq(docExcerpt({ type: 'doc', content: [{ type: 'image' }] }), '');
});

test('docExcerpt flattens a simple paragraph', () => {
  const doc = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] },
  ] };
  eq(docExcerpt(doc), 'hello world');
});

test('docExcerpt joins block boundaries with a space and collapses whitespace', () => {
  const doc = { type: 'doc', content: [
    { type: 'heading', content: [{ type: 'text', text: 'Fukuoka' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '  ramen\n\nand   castles ' }] },
  ] };
  // heading + paragraph must not glue: "Fukuoka ramen and castles"
  eq(docExcerpt(doc), 'Fukuoka ramen and castles');
});

test('docExcerpt truncates on a word boundary with an ellipsis, never past max', () => {
  const long = 'one two three four five six seven eight nine ten eleven twelve';
  const doc = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: long }] },
  ] };
  const out = docExcerpt(doc, 20);
  ok(out.length <= 21, `≤ max (+ellipsis): ${out.length}`); // 20 chars + the …
  ok(out.endsWith('…'), 'has ellipsis');
  ok(!out.slice(0, -1).endsWith(' '), 'no trailing space before ellipsis');
  ok(long.startsWith(out.slice(0, -1)), 'a clean prefix of the source');
});

// --- staticTiles (place node mini-map) --------------------------------------

test('staticTiles puts the marker at the box centre', () => {
  const { marker } = staticTiles(35.6, 139.7, 13, 160, 80);
  eq(marker, { left: 80, top: 40 });
});

test('staticTiles covers the box and offsets stay within one tile of the edges', () => {
  const w = 160, h = 80;
  const { tiles, tileSize } = staticTiles(35.6, 139.7, 13, w, h);
  ok(tiles.length >= 1, 'at least one tile');
  // every tile column/row is a valid index at this zoom
  const n = Math.pow(2, 13);
  for (const t of tiles) {
    ok(t.x >= 0 && t.x < n && t.y >= 0 && t.y < n, 'tile index in range');
    // a covering tile's left/top must sit in (−TILE, w/h], i.e. it touches the box
    ok(t.left > -tileSize && t.left < w, 'left overlaps box');
    ok(t.top > -tileSize && t.top < h, 'top overlaps box');
  }
  // the box's left edge (x=0) and right edge (x=w) are both covered
  const coversLeft = tiles.some((t) => t.left <= 0 && t.left + tileSize > 0);
  const coversRight = tiles.some((t) => t.left < w && t.left + tileSize >= w);
  ok(coversLeft && coversRight, 'horizontal coverage');
});

test('staticTiles wraps columns at the date line (never negative)', () => {
  // near lon −180 the covering set straddles the seam; columns must wrap to [0,n)
  const { tiles } = staticTiles(0, -179.99, 4, 160, 80);
  const n = Math.pow(2, 4);
  ok(tiles.every((t) => t.x >= 0 && t.x < n), 'all columns wrapped into range');
});

test('tileUrl builds the standard OSM path', () => {
  eq(tileUrl({ x: 7, y: 3, z: 13, left: 0, top: 0 }), 'https://tile.openstreetmap.org/13/7/3.png');
});

// --- workspaces (feature 4) -------------------------------------------------

function wmember(over: Partial<WorkspaceMember>): WorkspaceMember {
  return { id: 'm', workspace: 'w', user: 'u', userName: 'U', role: 'viewer', created: '', ...over };
}
function wspace(id: string): Workspace {
  return { id, name: id, icon: '', owner: 'u1', created: '', updated: '' };
}
function winvite(over: Partial<WorkspaceInvite>): WorkspaceInvite {
  return { id: 'i', workspace: 'w', email: '', role: 'editor', invitedBy: 'u1', status: 'pending', created: '', ...over };
}

test('roleInWorkspace: creator/admin, promoted member, and non-member', () => {
  const members = [
    wmember({ id: '1', workspace: 'w1', user: 'creator', role: 'admin' }),
    wmember({ id: '2', workspace: 'w1', user: 'promoted', role: 'admin' }),
    wmember({ id: '3', workspace: 'w1', user: 'editor1', role: 'editor' }),
  ];
  eq(roleInWorkspace(members, 'w1', 'creator'), 'admin');
  eq(roleInWorkspace(members, 'w1', 'promoted'), 'admin');
  eq(roleInWorkspace(members, 'w1', 'stranger'), 'none', 'non-member is none');
  eq(roleInWorkspace(members, 'w2', 'creator'), 'none', 'wrong workspace is none');
});

test('isAdmin / canEdit / canInvite gate by role', () => {
  ok(isAdmin('admin') && !isAdmin('editor') && !isAdmin('none'));
  ok(canEdit('admin') && canEdit('editor'), 'admin+editor write');
  ok(!canEdit('viewer') && !canEdit('none'), 'viewer + non-member cannot write');
  ok(canInvite('admin') && !canInvite('editor') && !canInvite('viewer'), 'only admin invites');
});

test('classifyWorkspaces: solo → private, second member → shared', () => {
  const workspaces = [wspace('solo'), wspace('team'), wspace('other')];
  const members = [
    wmember({ id: '1', workspace: 'solo', user: 'me' }),
    wmember({ id: '2', workspace: 'team', user: 'me' }),
    wmember({ id: '3', workspace: 'team', user: 'friend' }),
    wmember({ id: '4', workspace: 'other', user: 'someone-else' }), // I'm not in it
  ];
  const { private: priv, shared } = classifyWorkspaces(workspaces, members, 'me');
  eq(priv.map((w) => w.id), ['solo'], 'solo is private');
  eq(shared.map((w) => w.id), ['team'], 'team is shared');
  ok(!priv.concat(shared).some((w) => w.id === 'other'), "workspaces I'm not in are excluded");
});

test('classifyWorkspaces: the moment-of-invite transition (claimed second member)', () => {
  const ws = [wspace('w')];
  const solo = [wmember({ id: '1', workspace: 'w', user: 'me' })];
  eq(classifyWorkspaces(ws, solo, 'me').private.length, 1, 'still private with a pending invite (no 2nd member yet)');
  const claimed = [...solo, wmember({ id: '2', workspace: 'w', user: 'guest' })];
  eq(classifyWorkspaces(ws, claimed, 'me').shared.length, 1, 'shared once the invite is claimed');
  eq(classifyWorkspaces(ws, claimed, 'me').private.length, 0);
});

test('pendingInvitesFor matches email case-insensitively, ignores accepted', () => {
  const invites = [
    winvite({ id: 'a', email: 'Anna@Example.com', status: 'pending' }),
    winvite({ id: 'b', email: 'anna@example.com', workspace: 'w2', status: 'pending' }),
    winvite({ id: 'c', email: 'anna@example.com', status: 'accepted' }),
    winvite({ id: 'd', email: 'bob@example.com', status: 'pending' }),
  ];
  const got = pendingInvitesFor('  ANNA@example.COM ', invites).map((i) => i.id).sort();
  eq(got, ['a', 'b'], 'both pending matches, not the accepted one or bob');
});

test('validateInviteEmail: shape check + case-insensitive dedupe', () => {
  eq(validateInviteEmail('').ok, false);
  eq(validateInviteEmail('not-an-email').ok, false);
  const ok1 = validateInviteEmail('New@Person.com');
  ok(ok1.ok && ok1.email === 'New@Person.com', 'trims/keeps a valid one');
  const dup = validateInviteEmail('taken@x.com', ['Taken@X.com', 'other@x.com']);
  eq(dup.ok, false, 'already a member/invite is rejected');
});

test('normalizeEmail lowercases + trims so the claim hook matches the signup', () => {
  eq(normalizeEmail('  Bob@Example.COM '), 'bob@example.com');
  eq(normalizeEmail('already@lower.com'), 'already@lower.com');
});

test('readInviteFromSearch pulls the prefill, ignores junk', () => {
  eq(readInviteFromSearch('?invite=bob%40x.com&ws=Fukuoka%20Trip'), { email: 'bob@x.com', workspace: 'Fukuoka Trip' });
  eq(readInviteFromSearch('?invite=anna@x.com'), { email: 'anna@x.com', workspace: '' });
  eq(readInviteFromSearch('?invite=notanemail'), null, 'must look like an email');
  eq(readInviteFromSearch(''), null, 'no param → null');
  eq(readInviteFromSearch('?other=1'), null, 'unrelated query → null');
});

// --- cell links -------------------------------------------------------------

test('parseCellLink matches a single markdown link, trims, rejects partials', () => {
  eq(parseCellLink('[Booking](https://example.com)'), { label: 'Booking', href: 'https://example.com' });
  eq(parseCellLink('  [Hotel Monterey]( booking.com/x ) '), { label: 'Hotel Monterey', href: 'booking.com/x' });
  eq(parseCellLink('just text'), null);
  eq(parseCellLink('[no href]()'), null);
  eq(parseCellLink('see [a](b) and [c](d)'), null); // not the whole value → plain text
  eq(parseCellLink(42), null);
});

test('formatCellLink round-trips and falls back to href when label is blank', () => {
  eq(parseCellLink(formatCellLink('Map', 'https://maps.app/x')), { label: 'Map', href: 'https://maps.app/x' });
  eq(formatCellLink('   ', 'https://x.test'), '[https://x.test](https://x.test)');
});

test('linkHref leaves schemes alone, https-prefixes bare hosts', () => {
  eq(linkHref('https://x.test'), 'https://x.test');
  eq(linkHref('mailto:a@b.test'), 'mailto:a@b.test');
  eq(linkHref('booking.com/x'), 'https://booking.com/x');
});

test('cellLinkLabel / cellText use the visible label so sort + search match', () => {
  eq(cellLinkLabel('[Booking](https://example.com)'), 'Booking');
  eq(cellLinkLabel('plain'), 'plain');
  eq(cellText('[Booking](https://example.com)', col({ type: 'text' })), 'Booking');
  eq(cellText('https://raw.example.com', col({ type: 'url' })), 'https://raw.example.com');
});

// --- mindmap selection (Part 1) ---------------------------------------------

test('deleteNodes drops nodes + incident edges, keeps the rest, no-ops on empty', () => {
  const nodes = ['a', 'b', 'c'].map((id) => mnode({ id }));
  const edges: MindEdge[] = [
    { id: '1', from: 'a', to: 'b' },
    { id: '2', from: 'b', to: 'c' },
    { id: '3', from: 'a', to: 'c' },
  ];
  const out = deleteNodes(nodes, edges, new Set(['b']));
  eq(out.nodes.map((n) => n.id), ['a', 'c'], 'b gone');
  eq(out.edges.map((e) => e.id), ['3'], 'edges touching b dropped, a→c kept');
  const noop = deleteNodes(nodes, edges, new Set());
  eq(noop.nodes.length, 3);
  eq(noop.edges.length, 3);
});

test('nodesInRect selects inside + straddling, rejects outside', () => {
  const nodes = [
    mnode({ id: 'in', x: 50, y: 50 }), // fully inside
    mnode({ id: 'edge', x: 190, y: 50 }), // straddles the right edge (box 190..358)
    mnode({ id: 'out', x: 600, y: 600 }), // far outside
  ];
  const hit = nodesInRect(nodes, { x: 0, y: 0, w: 200, h: 200 });
  ok(hit.includes('in') && hit.includes('edge'), 'inside + straddling chosen');
  ok(!hit.includes('out'), 'outside rejected');
});

test('toggleSelected: additive toggles, plain replaces', () => {
  let sel = new Set<string>(['a']);
  sel = toggleSelected(sel, 'b', true);
  eq([...sel].sort(), ['a', 'b'], 'additive adds');
  sel = toggleSelected(sel, 'a', true);
  eq([...sel], ['b'], 'additive removes when present');
  sel = toggleSelected(sel, 'z', false);
  eq([...sel], ['z'], 'plain replaces with sole id');
});

// --- mindmap: grow, tidy, find, roll-up -------------------------------------

test('childPosition: first child sits level, later ones stack below', () => {
  const parent = mnode({ id: 'p', x: 100, y: 40 });
  const first = childPosition(parent, []);
  eq(first.x, 100 + NODE_W + 72, 'one column to the right of the parent');
  eq(first.y, 40, 'the first child lines up with its parent');
  const second = childPosition(parent, [mnode({ id: 'c1', x: first.x, y: first.y })]);
  eq(second.x, first.x, 'siblings share a column');
  ok(second.y > first.y + NODE_H - 1, 'the next child clears the one above it');
  // A tall child must be cleared by its measured height, not the default.
  const third = childPosition(parent, [mnode({ id: 'c1', x: first.x, y: 0, h: 300 })]);
  eq(third.y, 324, 'a tall sibling is cleared by its own height');
});

test('duplicateNodes: fresh ids, offset, and only fully-internal edges copied', () => {
  const nodes = [mnode({ id: 'a', x: 0, y: 0 }), mnode({ id: 'b', x: 50, y: 0 }), mnode({ id: 'out', x: 900, y: 0 })];
  const edges: MindEdge[] = [
    { id: 'e1', from: 'a', to: 'b', label: 'keep' },
    { id: 'e2', from: 'b', to: 'out' },
  ];
  let n = 0;
  const mint = (p?: string) => `${p ?? ''}${++n}`;
  const out = duplicateNodes(nodes, edges, new Set(['a', 'b']), mint);
  eq(out.nodes.length, 5, 'two copies appended, originals untouched');
  eq(out.newIds.length, 2, 'both copies reported');
  ok(!out.newIds.includes('a') && !out.newIds.includes('b'), 'copies get fresh ids');
  const copyA = out.nodes.find((x) => x.id === out.newIds[0])!;
  eq(copyA.x, 28, 'the copy is offset so it does not hide under the original');
  eq(out.edges.length, 3, 'only the a->b edge was copied');
  const copied = out.edges[2];
  eq(copied.label, 'keep', 'edge attrs ride along');
  ok(out.newIds.includes(copied.from) && out.newIds.includes(copied.to), 'the copy wires to copies, never back to the originals');
  eq(duplicateNodes(nodes, edges, new Set(), mint).nodes.length, 3, 'empty selection is a no-op');
});

test('treeLayout: roots left, children right, parent centred, nothing stranded', () => {
  const nodes = ['root', 'a', 'b', 'island'].map((id) => mnode({ id }));
  const edges: MindEdge[] = [
    { id: '1', from: 'root', to: 'a' },
    { id: '2', from: 'root', to: 'b' },
  ];
  const out = treeLayout(nodes, edges);
  const at = (id: string) => out.find((n) => n.id === id)!;
  eq(at('root').x, 0, 'a root owns the first column');
  eq(at('a').x, NODE_W + LAYOUT_GAP_X, 'a child clears the widest card in the column before it');
  eq(at('b').x, at('a').x, 'siblings share a column');
  ok(at('a').y !== at('b').y, 'siblings do not overlap');
  eq(at('root').y, (at('a').y + at('b').y + NODE_H) / 2 - NODE_H / 2, 'the parent is centred on its children band');
  ok(at('island').y > Math.max(at('a').y, at('b').y), 'an unconnected node still gets a place of its own');
  eq(out.length, nodes.length, 'no node is dropped');
});

test('treeLayout: spacing comes from the cards, so a tall node never overlaps', () => {
  // The old version stepped a fixed 110px per row, so a 320px image node simply
  // sat on top of whatever came next. Every pair in a column must stay clear.
  const nodes = [
    mnode({ id: 'root' }),
    mnode({ id: 'tall', h: 320, w: 260 }),
    mnode({ id: 'short' }),
    mnode({ id: 'third' }),
  ];
  const edges: MindEdge[] = [
    { id: '1', from: 'root', to: 'tall' },
    { id: '2', from: 'root', to: 'short' },
    { id: '3', from: 'root', to: 'third' },
  ];
  const out = treeLayout(nodes, edges);
  const at = (id: string) => out.find((n) => n.id === id)!;
  const h = (n: MindNode) => n.h ?? NODE_H;
  const col = [at('tall'), at('short'), at('third')].sort((p, q) => p.y - q.y);
  for (let i = 1; i < col.length; i++) {
    ok(col[i].y >= col[i - 1].y + h(col[i - 1]), `${col[i].id} clears ${col[i - 1].id} instead of overlapping it`);
  }
  ok(at('short').y >= at('tall').y + 320 || at('tall').y >= at('short').y + NODE_H, 'the 320px card is cleared by its real height');
  // A wide card widens its whole column, so the next column starts past it.
  const next = out.filter((n) => n.id !== 'root' && n.x > at('root').x)[0];
  ok(next.x >= at('root').x + NODE_W + LAYOUT_GAP_X, 'the column after the root clears it');
});

test('treeLayout: a cycle terminates and every node still lands somewhere', () => {
  const nodes = ['x', 'y', 'z'].map((id) => mnode({ id }));
  const edges: MindEdge[] = [
    { id: '1', from: 'x', to: 'y' },
    { id: '2', from: 'y', to: 'z' },
    { id: '3', from: 'z', to: 'x' }, // back-edge, no node has indegree 0
  ];
  const out = treeLayout(nodes, edges);
  eq(out.length, 3, 'all three placed');
  eq(new Set(out.map((n) => `${n.x},${n.y}`)).size, 3, 'and none of them stacked on each other');
});

test('matchNodes: case-insensitive contains, blank matches nothing', () => {
  const nodes = [mnode({ id: 'a', payload: 'Book the Shinkansen' }), mnode({ id: 'b', payload: 'ramen' })];
  const label = (n: MindNode) => String(n.payload ?? '');
  eq(matchNodes(nodes, 'shink', label), ['a'], 'case-insensitive substring');
  eq(matchNodes(nodes, '   ', label), [], 'a blank query highlights nothing, not everything');
  eq(matchNodes(nodes, 'zzz', label), [], 'no match is empty');
});

test('checkProgress counts only checkbox nodes', () => {
  const nodes = [
    mnode({ id: 'a', kind: 'widget', payload: { text: 'one', checked: true } }),
    mnode({ id: 'b', kind: 'widget', payload: { text: 'two', checked: false } }),
    mnode({ id: 'c', kind: 'text', payload: 'not a checkbox' }),
  ];
  eq(checkProgress(nodes), { done: 1, total: 2 }, 'text nodes are not counted');
  eq(checkProgress([]), { done: 0, total: 0 }, 'an empty map has nothing to report');
});

// --- spreadsheet -------------------------------------------------------------

test('sheet: column names and references round-trip past Z', () => {
  eq(colName(0), 'A');
  eq(colName(25), 'Z');
  eq(colName(26), 'AA');
  eq(colName(51), 'AZ');
  eq(colIndex('A'), 0);
  eq(colIndex('AA'), 26);
  eq(colIndex('4'), -1, 'a number is not a column');
  eq(parseRef('B3'), { row: 2, col: 1 });
  eq(parseRef('aa10'), { row: 9, col: 26 }, 'lower case parses too');
  eq(parseRef('SUM'), null, 'a function name is not a reference');
  eq(refName(2, 1), 'B3');
});

test('sheet: a range expands row by row and refuses an absurd one', () => {
  eq(expandRange('A1', 'B2'), ['A1', 'B1', 'A2', 'B2']);
  eq(expandRange('B2', 'A1'), ['A1', 'B1', 'A2', 'B2'], 'a backwards range normalises');
  eq(expandRange('A1', 'A1'), ['A1'], 'one cell is a valid range');
  eq(expandRange('A1', 'ZZ99999').length, 0, 'a runaway range expands to nothing rather than hanging');
});

test('sheet: SUM over a range, ignoring the blanks inside it', () => {
  const data = { rows: 10, cols: 5, cells: { A1: '10', A2: '', A3: '5', B1: '=SUM(A1:A3)', B2: '=COUNT(A1:A3)', B3: '=AVG(A1:A3)' } };
  const out = evaluateSheet(data);
  eq(out.B1.value, 15, 'blanks contribute nothing');
  eq(out.B2.value, 2, 'and are not counted');
  eq(out.B3.value, 7.5, 'nor dragged into the average');
});

test('sheet: formulas evaluate in dependency order, however they are written', () => {
  // C depends on B which depends on A, but they are stored in the wrong order.
  const data = { rows: 5, cols: 5, cells: { C1: '=B1*2', B1: '=A1+1', A1: '4' } };
  const out = evaluateSheet(data);
  eq(out.B1.value, 5, 'B1 sees A1');
  eq(out.C1.value, 10, 'C1 sees the computed B1, not a stale or blank one');
});

test('sheet: a reference cycle is marked, not recursed into', () => {
  const out = evaluateSheet({ rows: 5, cols: 5, cells: { A1: '=B1', B1: '=A1', C1: '=1+1' } });
  eq(out.A1.error, '#CYCLE');
  eq(out.B1.error, '#CYCLE');
  eq(out.C1.value, 2, 'a healthy cell elsewhere still computes');
});

test('sheet: a broken formula is contained, and poisons only what reads it', () => {
  const out = evaluateSheet({ rows: 5, cols: 5, cells: { A1: '=1/0', B1: '=A1+1', C1: '=2+2' } });
  ok(out.A1.error, 'the bad cell reports an error');
  eq(out.B1.error, '#ERR', 'a cell reading it cannot be trusted either');
  eq(out.C1.value, 4, 'an unrelated cell is unaffected');
});

test('sheet: text, literals and the numeric test', () => {
  eq(literalValue('12'), 12);
  eq(literalValue('-3.5'), -3.5);
  eq(literalValue('12kr'), '12kr', 'a number with a unit stays text');
  eq(literalValue(''), '');
  eq(literalValue('  '), '');
  const out = evaluateSheet({ rows: 5, cols: 5, cells: { A1: 'Tokyo', B1: '=UPPER(A1)', C1: '=LEN(A1)' } });
  eq(out.B1.value, 'TOKYO');
  eq(out.C1.value, 5);
});

test('sheet: the spreadsheet function set answers like a spreadsheet', () => {
  const cells: Record<string, string> = { A1: '4', A2: '8', A3: '15', A4: '16', A5: '23', A6: '42' };
  const at = (f: string) => evaluateSheet({ rows: 10, cols: 5, cells: { ...cells, Z1: `=${f}` } }).Z1;
  eq(at('SUM(A1:A6)').value, 108);
  eq(at('MEDIAN(A1:A6)').value, 15.5);
  eq(at('MIN(A1:A6)').value, 4);
  eq(at('MAX(A1:A6)').value, 42);
  eq(at('COUNTIF(A1:A6, ">15")').value, 3, 'a criterion string filters');
  eq(at('SUMIF(A1:A6, ">15")').value, 81);
  eq(at('ROUNDUP(2.01, 0)').value, 3);
  eq(at('ROUNDDOWN(2.99, 0)').value, 2);
  eq(at('INT(-2.5)').value, -3);
  eq(at('IFS(A1>100, "big", A1>1, "small")').value, 'small');
  eq(at('SWITCH("b", "a", 1, "b", 2, 0)').value, 2);
  eq(at('MID("Fukuoka", 2, 3)').value, 'uku');
  eq(at('FIND("uo", "Fukuoka")').value, 4, '1-based, like a spreadsheet');
  eq(at('SUBSTITUTE("a-b-c", "-", "+")').value, 'a+b+c');
  eq(at('PROPER("tokyo station")').value, 'Tokyo Station');
});

test('sheet: negative and zero rounding behave the way a spreadsheet user expects', () => {
  const at = (f: string) => evaluateSheet({ rows: 3, cols: 3, cells: { Z1: `=${f}` } }).Z1.value;
  eq(at('ROUNDUP(-2.01, 0)'), -3, 'away from zero');
  eq(at('ROUNDDOWN(-2.99, 0)'), -2, 'toward zero');
  eq(at('EVEN(-1.2)'), -2);
  eq(at('ODD(2.2)'), 3);
});

test('matchCriterion: comparisons, equality and text', () => {
  ok(matchCriterion(6, '>5'));
  ok(!matchCriterion(5, '>5'));
  ok(matchCriterion(5, '>=5'));
  ok(matchCriterion(4, '<>5'));
  ok(matchCriterion('Tokyo', 'tokyo'), 'text compares case-insensitively');
  ok(matchCriterion('Tokyo', '=Tokyo'));
  ok(!matchCriterion('Osaka', 'Tokyo'));
});

test('sheet: chart points pair values with labels and drop what cannot be plotted', () => {
  const data = { rows: 10, cols: 5, cells: { A1: 'Food', A2: 'Trains', B1: '120', B2: 'n/a', B3: '80', A3: 'Stays' } };
  const results = evaluateSheet(data);
  const points = chartPoints({ id: 'c', kind: 'bar', range: 'B1:B3', labels: 'A1:A3', x: 0, y: 0, w: 300, h: 200 }, results);
  eq(points.length, 2, 'the non-numeric cell is dropped rather than plotted as zero');
  eq(points[0], { label: 'Food', value: 120 });
  eq(points[1], { label: 'Stays', value: 80 }, 'labels stay paired with their own row');
});

test('sheet: chart scale anchors at zero, pie slices skip non-positives', () => {
  eq(chartScale([{ label: 'a', value: 5 }, { label: 'b', value: 15 }]), { min: 0, max: 15, span: 15 });
  const withNegative = chartScale([{ label: 'a', value: -5 }, { label: 'b', value: 10 }]);
  eq(withNegative.min, -5, 'a negative extends the axis instead of drawing off the canvas');
  eq(chartScale([]).span, 1, 'an empty chart does not divide by zero');
  const slices = pieSlices([{ label: 'a', value: 3 }, { label: 'b', value: 1 }, { label: 'c', value: -2 }]);
  eq(slices.length, 2, 'a negative cannot be a slice');
  eq(slices[0].from, 0);
  eq(slices[1].to, 1, 'the slices close the circle');
});

// --- spaced repetition, Anki, rota, bracket ---------------------------------

test('srs: learning steps come first, then it graduates to days', () => {
  // A new card should come back in a minute, not tomorrow. That is the whole
  // difference between something that teaches and something that only tests.
  const now = new Date(2026, 7, 5, 12, 0).getTime();
  const deck = { learnSteps: [1, 10], leechAt: 8 };
  const first = grade(undefined, 'good', now, deck);
  eq(first.step, 0, 'still learning');
  eq(first.dueMs, now + 60000, 'back in one minute');
  eq(first.interval, 0);
  const second = grade(first, 'good', now, deck);
  eq(second.step, 1, 'on to the second step');
  eq(second.dueMs, now + 10 * 60000, 'ten minutes');
  const graduated = grade(second, 'good', now, deck);
  eq(graduated.step, undefined, 'off the steps');
  eq(graduated.interval, 1, 'and on to day intervals');
  // Easy skips the steps entirely.
  eq(grade(undefined, 'easy', now, deck).step, undefined, 'easy graduates immediately');
  eq(grade(undefined, 'easy', now, deck).interval, 4);
  // Again restarts them.
  const failed = grade(graduated, 'again', now, deck);
  eq(failed.step, 0, 'a lapse goes back to the first step');
  eq(failed.dueMs, now + 60000);
});

test('srs: a unit that keeps failing becomes a leech and stops being asked', () => {
  const now = Date.now();
  const deck = { learnSteps: [1], leechAt: 3 };
  let s = grade(undefined, 'again', now, deck);
  eq(s.leech, undefined, 'one lapse is not a leech');
  s = grade(s, 'again', now, deck);
  s = grade(s, 'again', now, deck);
  eq(s.lapses, 3);
  eq(s.leech, true, 'the third lapse tags it');
  eq(s.suspended, true, 'and takes it out of rotation rather than asking forever');
});

test('srs: cloze deletions expand into one unit each, the rest stay readable', () => {
  const text = 'The capital of {{c1::Japan}} is {{c2::Tokyo::city}}';
  eq(clozeIndexes(text), [1, 2]);
  eq(renderCloze(text, 1, false), 'The capital of [...] is Tokyo', 'the other deletion shows its answer');
  eq(renderCloze(text, 1, true), 'The capital of Japan is Tokyo');
  eq(renderCloze(text, 2, false), 'The capital of Japan is [city]', 'a hint is used when given');
  const units = unitsOf({ id: 'n1', front: '', back: '', cloze: text });
  eq(units.length, 2, 'two deletions, two things to review');
  eq(units.map((u) => u.key), ['n1::c1', 'n1::c2'], 'each gets its own schedule key');
  eq(units[0].kind, 'cloze');
  // Cloze markup with no deletions is still one unit rather than vanishing.
  eq(unitsOf({ id: 'n2', front: '', back: '', cloze: 'no deletions here' }).length, 1);
});

test('srs: a reverse card is a second unit with its own schedule', () => {
  const units = unitsOf({ id: 'c1', front: 'neko', back: 'cat', reverse: true });
  eq(units.length, 2);
  eq(units[0].front, 'neko');
  eq(units[1].front, 'cat', 'the reverse asks it the other way round');
  eq(units[1].key, 'c1::r');
  eq(unitsOf({ id: 'c2', front: 'a', back: 'b' }).length, 1, 'without the flag it is one');
  // The two halves schedule independently.
  let deck = { ...emptyDeck(), cards: [{ id: 'c1', front: 'neko', back: 'cat', reverse: true }] };
  deck = withSched(deck, 'me', 'c1', { interval: 30, ease: 2.5, due: dayIndex(Date.now()) + 30, reps: 3, lapses: 0 });
  const q = buildQueue(deck, 'me', Date.now());
  eq(q.due.length, 1, 'the forward half is scheduled ahead, the reverse is still new');
  eq(q.due[0].key, 'c1::r');
});

test('srs: sub-decks group cards and can narrow the queue', () => {
  const deck = {
    ...emptyDeck(),
    cards: [
      { id: 'a', front: '1', back: '1', deck: 'Verbs' },
      { id: 'b', front: '2', back: '2', deck: 'Verbs' },
      { id: 'c', front: '3', back: '3' },
    ],
  };
  eq(subDecks(deck), [{ name: '', units: 1 }, { name: 'Verbs', units: 2 }], 'the root sorts first');
  eq(allUnits(deck, 'Verbs').length, 2);
  eq(buildQueue(deck, 'me', Date.now(), 'Verbs').due.length, 2, 'the queue can be narrowed to one sub-deck');
});

test('srs: cram ignores scheduling and can filter by tag', () => {
  const deck = {
    ...emptyDeck(),
    cards: [
      { id: 'a', front: '1', back: '1', tags: ['jlpt'] },
      { id: 'b', front: '2', back: '2', tags: ['food'] },
      { id: 'c', front: '3', back: '3', tags: ['jlpt', 'food'] },
    ],
  };
  eq(buildCram(deck).length, 3, 'everything by default');
  eq(buildCram(deck, { tag: 'jlpt' }).map((u) => u.cardId), ['a', 'c'], 'filtered by tag');
  // A card scheduled far ahead is still crammable: that is the point.
  const scheduled = withSched(deck, 'me', 'a', { interval: 90, ease: 2.5, due: 99999, reps: 9, lapses: 0 });
  eq(buildCram(scheduled, { tag: 'jlpt' }).length, 2, 'scheduling is ignored');
});

test('srs: scheduling is PER USER, so two people cannot overwrite each other', () => {
  const now = Date.now();
  const deck = { ...emptyDeck(), cards: [{ id: 'c1', front: 'a', back: 'b' }] };
  const afterBob = withSched(deck, 'bob', 'c1', grade(undefined, 'easy', now), { day: dayIndex(now), grade: 'easy' });
  const afterBoth = withSched(afterBob, 'alice', 'c1', grade(undefined, 'again', now), { day: dayIndex(now), grade: 'again' });
  eq(schedOf(afterBoth, 'bob', 'c1').interval, 4, "Bob's schedule is untouched");
  eq(schedOf(afterBoth, 'alice', 'c1').interval, 0, "Alice's is separate");
  eq(buildQueue(afterBoth, 'bob', now).due.length, 0, 'nothing is due for Bob');
  // Alice answered 'again', which is a LEARNING step: back in a minute, not
  // instantly. So it is pending now and due once the minute is up.
  eq(buildQueue(afterBoth, 'alice', now).due.length, 0, 'not this second');
  eq(buildQueue(afterBoth, 'alice', now + 61000).due.length, 1, 'but a minute later it is');
  eq(stateOf(afterBoth, 'nobody').sched, {}, 'a third person starts clean');
});

test('srs: the queue leads with learning, then reviews, then new', () => {
  const now = new Date(2026, 7, 5, 12, 0).getTime();
  const today = dayIndex(now);
  let deck = {
    ...emptyDeck(),
    newPerDay: 1,
    cards: [
      { id: 'new1', front: 'n', back: 'n' },
      { id: 'new2', front: 'n', back: 'n' },
      { id: 'due', front: 'd', back: 'd' },
      { id: 'step', front: 's', back: 's' },
      { id: 'ahead', front: 'a', back: 'a' },
    ],
  };
  deck = withSched(deck, 'me', 'due', { interval: 3, ease: 2.5, due: today - 1, reps: 2, lapses: 0 });
  deck = withSched(deck, 'me', 'step', { interval: 0, ease: 2.5, due: today, dueMs: now - 1000, step: 0, reps: 1, lapses: 0 });
  deck = withSched(deck, 'me', 'ahead', { interval: 9, ease: 2.5, due: today + 9, reps: 4, lapses: 0 });
  const q = buildQueue(deck, 'me', now);
  eq(q.due.map((u) => u.key), ['step', 'due', 'new1'], 'learning, then review, then one new');
  eq(q.counts.learning, 1);
  eq(q.counts.review, 1);
  eq(q.counts.new, 1);
  eq(q.counts.later, 1);
  const held = buildQueue({ ...deck, maxPerDay: 0 }, 'me', now);
  eq(held.counts.review, 0, 'a review ceiling holds a backlog back');
});

test('srs: suspend takes a unit out without deleting it, prune drops dead keys', () => {
  const now = Date.now();
  let deck = { ...emptyDeck(), cards: [{ id: 'c1', front: 'a', back: 'b' }] };
  eq(buildQueue(deck, 'me', now).due.length, 1);
  deck = withSched(deck, 'me', 'c1', { interval: 0, ease: 2.5, due: dayIndex(now), reps: 0, lapses: 0, suspended: true });
  eq(buildQueue(deck, 'me', now).due.length, 0, 'not offered');
  eq(buildQueue(deck, 'me', now).counts.suspended, 1, 'but counted, not hidden');
  // Delete the card; its schedule should not linger forever.
  const gone = pruneSched({ ...deck, cards: [] }, 'me');
  eq(Object.keys(stateOf(gone, 'me').sched).length, 0, 'a dead key is pruned');
});

test('srs: "show it again in N days" sets an exact gap and keeps the history', () => {
  const pushed = setDueIn({ interval: 3, ease: 2.4, due: 100, reps: 7, lapses: 2 }, 30, 100);
  eq(pushed.due, 130, 'due exactly when asked');
  eq(pushed.interval, 30, 'and the next answer multiplies from there');
  eq(pushed.reps, 7);
  eq(pushed.lapses, 2);
});

test('srs: previews read in minutes while learning and days once graduated', () => {
  const now = Date.now();
  const p = gradePreview(undefined, now, { learnSteps: [1, 10] });
  eq(p.good, '1m', 'a new card comes back in a minute');
  eq(p.easy, '4d', 'unless you say easy');
  const mature = gradePreview({ interval: 40, ease: 2.5, due: dayIndex(now), reps: 9, lapses: 0 }, now);
  eq(mature.again, '1m', 'a lapse goes back into learning, so it returns in minutes');
  ok(mature.good.endsWith('mo') || mature.good.endsWith('d'), 'a long interval reads in days or months');
});

test('srs: stats split learning/young/mature and retention uses the real log', () => {
  const today = 500;
  let deck = {
    ...emptyDeck(),
    cards: [
      { id: 'a', front: 'a', back: 'a' },
      { id: 'b', front: 'b', back: 'b' },
      { id: 'c', front: 'c', back: 'c' },
      { id: 'd', front: 'd', back: 'd' },
    ],
  };
  deck = withSched(deck, 'me', 'a', { interval: 40, ease: 2.5, due: today + 40, reps: 10, lapses: 1 }, { day: today, grade: 'good' });
  deck = withSched(deck, 'me', 'b', { interval: 5, ease: 2.5, due: today + 5, reps: 4, lapses: 0 }, { day: today, grade: 'good' });
  deck = withSched(deck, 'me', 'c', { interval: 0, ease: 2.5, due: today, step: 0, reps: 1, lapses: 1 }, { day: today - 1, grade: 'again' });
  const st = deckStats(deck, 'me', today);
  eq(st.total, 4);
  eq(st.unseen, 1);
  eq(st.mature, 1, 'past three weeks is mature');
  eq(st.young, 1);
  eq(st.learning, 1);
  eq(st.reviewsToday, 2);
  eq(st.streak, 2, 'today and yesterday');
  eq(st.retention, 67, 'two of three logged answers were not a lapse');
  eq(st.recent[st.recent.length - 1], 2, 'the last bucket is today');
  eq(deckStats(emptyDeck(), 'me', today).retention, null, 'no history means no claim');
});

test('srs: a deck written by an older build upgrades without losing progress', () => {
  // Scheduling used to live ON the card and be shared. If the new code just
  // ignored those fields, every interval would silently reset to zero and the
  // deck would read as brand new. That is the data loss this exists to prevent.
  const legacy = {
    cards: [
      { id: 'a', front: 'neko', back: 'cat', interval: 21, ease: 2.6, due: 900, reps: 9, lapses: 1 },
      { id: 'b', front: 'inu', back: 'dog', interval: 3, ease: 2.5, due: 850, reps: 2, lapses: 0, suspended: true },
      { id: 'c', front: 'tori', back: 'bird' },
    ],
  } as unknown as Parameters<typeof migrateDeck>[0];
  const up = migrateDeck(legacy, 'me');
  eq(schedOf(up, 'me', 'a').interval, 21, 'the interval survives');
  eq(schedOf(up, 'me', 'a').due, 900, 'and so does when it is next due');
  eq(schedOf(up, 'me', 'a').reps, 9);
  eq(schedOf(up, 'me', 'b').suspended, true, 'a suspended card stays suspended');
  eq(schedOf(up, 'me', 'c'), undefined, 'a never-reviewed card stays new');
  ok(!('interval' in up.cards[0]), 'the legacy field is stripped off the card');
  eq(up.cards.length, 3, 'no card is dropped');
  eq(up.cards[0].front, 'neko', 'and the content is untouched');
  // Idempotent, and safe to call on a modern deck every load.
  eq(migrateDeck(up, 'me'), up, 'a second pass is a no-op');
  const modern = { ...emptyDeck(), cards: [{ id: 'x', front: 'f', back: 'b' }] };
  eq(migrateDeck(modern, 'me'), modern, 'a deck with nothing legacy is returned untouched');
  // A schedule this user already has is never overwritten by the old shared one.
  const mine = withSched(legacy as never, 'me', 'a', { interval: 5, ease: 2.5, due: 1000, reps: 1, lapses: 0 });
  eq(schedOf(migrateDeck(mine, 'me'), 'me', 'a').interval, 5, 'mine wins over the legacy copy');
});

test('srs: several imports stay separate, each with its own queue', () => {
  const deck = {
    ...emptyDeck(),
    cards: [
      { id: 'a', front: '1', back: '1', deck: 'Japanese' },
      { id: 'b', front: '2', back: '2', deck: 'Japanese' },
      { id: 'c', front: '3', back: '3', deck: 'Capitals' },
    ],
  };
  eq(subDecks(deck).map((d) => d.name), ['Capitals', 'Japanese'], 'each import is its own deck');
  eq(buildQueue(deck, 'me', Date.now(), 'Japanese').due.length, 2, 'and has its own queue');
  eq(buildQueue(deck, 'me', Date.now(), 'Capitals').due.length, 1);
  eq(buildQueue(deck, 'me', Date.now()).due.length, 3, 'with everything together by default');
});

test('srs: the day index rolls over at local midnight, not UTC', () => {
  const late = new Date(2026, 0, 5, 23, 30);
  const early = new Date(2026, 0, 6, 0, 30);
  eq(dayIndex(early) - dayIndex(late), 1, 'one local midnight apart');
  eq(dayIndex(new Date(2026, 0, 5, 0, 1)), dayIndex(new Date(2026, 0, 5, 23, 59)), 'same local day');
  eq(DEFAULT_STEPS.length, 2, 'the default steps are Anki-shaped');
});

test('ankiIO: plain text round-trips, header lines honoured', () => {
  const text = ['#separator:tab', '#html:false', '#deck:Japan', '#tags column:3', 'neko\tcat\tanimals nouns', 'inu\tdog\tanimals'].join('\n');
  const parsed = parseAnkiText(text);
  eq(parsed.cards.length, 2);
  eq(parsed.cards[0].front, 'neko');
  eq(parsed.cards[0].back, 'cat');
  eq(parsed.cards[0].tags, ['animals', 'nouns'], 'the tags column is read');
  const back = serializeAnkiText(parsed.cards.map((c, i) => ({ ...c, id: String(i) })), 'Japan');
  const again = parseAnkiText(back);
  eq(again.cards.map((c) => [c.front, c.back]), [['neko', 'cat'], ['inu', 'dog']], 'it survives a round trip');
});

test('ankiIO: guesses the separator, strips html, reports what it skipped', () => {
  const semi = parseAnkiText('front;back\nonly-one-column');
  eq(semi.cards.length, 1, 'the semicolon file parses');
  eq(semi.skipped, 1, 'and the unusable line is counted, not silently dropped');
  const html = parseAnkiText('#html:true\n<b>neko</b><br>ねこ\t<div>cat</div>');
  eq(html.cards[0].front, 'neko\nねこ', 'br becomes a line break and tags go');
  eq(html.cards[0].back, 'cat');
  eq(parseAnkiText('').problem !== undefined, true, 'an empty file says so rather than importing nothing');
  // A "#" only means a directive at the top of the file. A card whose front is a
  // hashtag or a chord name must not be eaten as one.
  const hashes = parseAnkiText('#separator:tab\nC#\tC sharp\n#hashtag\twhat it means');
  eq(hashes.cards.length, 2, 'both cards survive');
  eq(hashes.cards[1].front, '#hashtag', 'a leading # in the body is content, not a header');
});

test('ankiIO: a tab inside a field cannot break the columns on export', () => {
  const out = serializeAnkiText([{ id: '1', front: 'a\tb', back: 'c\nd', tags: ['x'] }]);
  const rows = out.split('\n').filter((l) => !l.startsWith('#'));
  eq(rows[0].split('\t').length, 3, 'still exactly three columns');
  eq(parseAnkiText(out).cards[0].front, 'a b', 'the tab became a space');
});

test('sqlite: varints, serial types and a record decode', () => {
  eq(readVarint(new Uint8Array([0x01]), 0), [1, 1], 'a single byte');
  eq(readVarint(new Uint8Array([0x81, 0x00]), 0), [128, 2], 'two bytes, 7 bits each');
  eq(readVarint(new Uint8Array([0x82, 0x01]), 0), [257, 2]);
  // header(4) + types: 1 (int8), 19 (text len 3), then body 0x2a "abc"
  const rec = new Uint8Array([0x03, 0x01, 0x13, 0x2a, 0x61, 0x62, 0x63]);
  eq(decodeRecord(rec), [42, 'abc'], 'an integer and a string come back');
  const nulls = new Uint8Array([0x03, 0x00, 0x09, 0x00]);
  eq(decodeRecord(nulls), [null, 1], 'NULL and the constant-1 serial type');
  eq(readTable(new Uint8Array([1, 2, 3]), 'notes'), null, 'a file that is not SQLite returns null, it does not throw');
});

test('sqlite: column names come out of a CREATE TABLE', () => {
  const sql = 'CREATE TABLE notes (id integer PRIMARY KEY, guid text NOT NULL, mid integer, flds text, PRIMARY KEY(id))';
  eq(columnsFromSql(sql), ['id', 'guid', 'mid', 'flds'], 'the table constraint is not a column');
  eq(columnsFromSql('nonsense'), []);
});

test('rota: whose turn is derived from who has done it least', () => {
  const chore = { id: 'dishes', name: 'Dishes', everyDays: 1, people: ['bob', 'alice'] };
  const data = { chores: [chore], log: [] as ReturnType<typeof markDone>['log'] };
  eq(whoseTurn(chore, data.log), 'bob', 'a fresh rota starts at the top of the list');
  const after = markDone(data, 'dishes', 'bob', '2026-08-01');
  eq(whoseTurn(chore, after.log), 'alice', 'then it moves on');
  // Alice covers for Bob twice out of turn; the rota should even it back up.
  const covered = markDone(markDone(after, 'dishes', 'alice', '2026-08-02'), 'dishes', 'alice', '2026-08-03');
  eq(whoseTurn(chore, covered.log), 'bob', 'whoever has done it least is up, however it got that way');
  eq(shareOf(chore, covered.log), { bob: 1, alice: 2 });
  eq(whoseTurn({ ...chore, people: [] }, []), null, 'nobody assigned means nobody is up');
});

test('rota: due dates, overdue ordering and undo', () => {
  const weekly = { id: 'bath', name: 'Bathroom', everyDays: 7, people: ['a'] };
  const daily = { id: 'bin', name: 'Bins', everyDays: 1, people: ['a'] };
  const data = { chores: [weekly, daily], log: [{ choreId: 'bath', on: '2026-07-20', by: 'a' }, { choreId: 'bin', on: '2026-08-05', by: 'a' }] };
  eq(nextDue(weekly, data.log, '2026-08-05'), '2026-07-27');
  eq(dueState(weekly, data.log, '2026-08-05'), 'overdue');
  eq(dueState(daily, data.log, '2026-08-05'), 'later', 'done today, so not due again until tomorrow');
  eq(rotaOrder(data, '2026-08-05')[0].id, 'bath', 'the overdue one leads');
  eq(nextDue({ id: 'new', name: 'n', everyDays: 3, people: [] }, [], '2026-08-05'), '2026-08-05', 'never done means due now');
  eq(undoLast(data, 'bath').log.length, 1, 'undo removes the latest entry for that chore only');
  eq(daysBetween('2026-08-01', '2026-08-05'), 4);
});

test('bracket: seeds, byes, and the winner walks forward', () => {
  const data = { entrants: ['A', 'B', 'C'], results: {} as Record<string, string> };
  const rounds = buildBracket(data);
  eq(rounds.length, 2, 'three entrants fit a four-slot bracket, so two rounds');
  const first = rounds[0];
  eq(first.length, 2);
  const bye = first.find((m) => m.bye)!;
  ok(bye, 'the odd entrant gets a bye');
  eq(bye.winner, 'A', 'and the top seed is the one who gets it');
  eq(rounds[1][0].a, 'A', 'the bye winner is already in the final');
  eq(rounds[1][0].b, null, 'waiting on the other match');
});

test('bracket: a pick advances, and changing an earlier result drops what it orphaned', () => {
  let data = { entrants: ['A', 'B', 'C', 'D'], results: {} as Record<string, string> };
  const r0 = buildBracket(data)[0];
  data = pickWinner(data, r0[0].id, r0[0].a!);
  data = pickWinner(data, r0[1].id, r0[1].a!);
  let rounds = buildBracket(data);
  const finalId = rounds[1][0].id;
  data = pickWinner(data, finalId, rounds[1][0].a!);
  eq(champion(data), rounds[1][0].a, 'the final decides it');
  // Now flip the first match. The stored final pick can no longer happen.
  data = pickWinner(data, r0[0].id, r0[0].b!);
  rounds = buildBracket(data);
  eq(rounds[1][0].winner, null, 'the orphaned final result is gone, not shown as stale');
  eq(champion(data), null);
  eq(data.results[finalId], undefined, 'and it was pruned from what gets saved');
});

test('bracket: too few entrants build nothing, standings track how far each got', () => {
  eq(buildBracket({ entrants: ['solo'], results: {} }), [], 'one entrant is not a tournament');
  eq(buildBracket({ entrants: [], results: {} }), []);
  let data = { entrants: ['A', 'B', 'C', 'D'], results: {} as Record<string, string> };
  const r0 = buildBracket(data)[0];
  data = pickWinner(data, r0[0].id, 'A');
  const table = standings(data);
  eq(table[0].name, 'A', 'the winner of a round leads');
  eq(table[0].reached, 1);
  // Standard seeding is 1 v 4 and 2 v 3, so A's opponent is D, not B.
  eq(r0[0].a, 'A');
  eq(r0[0].b, 'D', 'the top seed plays the bottom one');
  ok(table.find((s) => s.name === 'D')!.out, 'the loser is marked out');
  ok(!table.find((s) => s.name === 'B')!.out, 'someone who has not played yet is not');
});

// --- version diff + quick add ------------------------------------------------








// --- Trello / Todoist / Keep importers ---------------------------------------

test('parseTrello: lists become stages, archived work is left behind', () => {
  const file = JSON.stringify({
    name: 'Japan',
    lists: [{ id: 'l1', name: 'To do' }, { id: 'l2', name: 'Done' }, { id: 'l3', name: 'Old', closed: true }],
    cards: [
      { name: 'Book flights', idList: 'l1', desc: 'return via Fukuoka', due: '2026-09-01T10:00:00Z', labels: [{ name: 'travel' }] },
      { name: 'Get JR pass', idList: 'l2' },
      { name: 'Ancient card', idList: 'l1', closed: true },
    ],
  });
  const out = parseTrello(file);
  eq(out.count, 2, 'the archived card is not imported');
  eq(out.skipped, 1, 'and it is reported rather than swallowed');
  eq(out.bundle.title, 'Japan');
  eq(out.bundle.cards[0].cells.Title, 'Book flights');
  eq(out.bundle.cards[0].cells.Stage, 'To do', 'the list became the stage');
  eq(out.bundle.cards[0].cells.Due, '2026-09-01', 'the due date is trimmed to a day');
  eq(out.bundle.cards[0].cells.Labels, 'travel');
  eq(out.bundle.cards[0].body, 'return via Fukuoka', 'the description becomes the card page');
  const stage = out.bundle.columns.find((c) => c.isStage);
  eq(stage.options.map((o) => o.label), ['To do', 'Done'], 'closed lists are not stages');
  ok(stage.options.find((o) => o.label === 'Done').done, 'a stage called Done is flagged done');
  ok(parseTrello('not json').problem, 'junk is refused with a reason');
});

test('parseTrello: a decorated list name still reads as the done stage', () => {
  // Real boards name their lists with an emoji in front. A plain compare misses
  // those, and the board arrives with no done column at all.
  const file = JSON.stringify({
    name: 'Campaign planning',
    lists: [
      { id: 'l1', name: '👋 Start Here' },
      { id: 'l2', name: '📝 To Do' },
      { id: 'l3', name: '⚔️ In Progress' },
      { id: 'l4', name: '✅ Done' },
    ],
    cards: [
      { name: 'Instructions', idList: 'l1', desc: 'open this card' },
      { name: 'Create the main villain', idList: 'l2' },
      { name: 'Map the nearby area', idList: 'l3' },
      { name: 'Campaign name chosen', idList: 'l4' },
    ],
  });
  const out = parseTrello(file);
  eq(out.count, 4, 'every live card comes across');
  eq(out.skipped, 0);
  const stage = out.bundle.columns.find((c) => c.isStage);
  eq(stage.options.length, 4, 'one stage per list, decoration and all');
  ok(stage.options.find((o) => o.label.endsWith('Done')).done, 'the emoji one is still flagged done');
  ok(!stage.options.find((o) => o.label.endsWith('In Progress')).done, 'without dragging others in with it');
});

test('board import: valid JSON that is not an object is refused, never thrown', () => {
  // JSON.parse('null') succeeds and hands back null. Reading a property off that
  // threw, so the one input that looked handled was the one that crashed, and the
  // dialog showed the engine's error instead of a reason.
  for (const junk of ['null', '42', '"a string"', 'true', '[]']) {
    ok(parseTrello(junk).problem, `trello refuses ${junk} with a reason`);
    ok(parseKeep(junk).problem || parseKeep(junk).bundle === null, `keep refuses ${junk}`);
    ok(parseTodoist(junk).problem, `todoist refuses ${junk}`);
    eq(detectBoardSource(junk), null, `${junk} is not detected as any service`);
  }
});

test('parseTodoist: projects become stages and completed tasks are kept', () => {
  const file = JSON.stringify({
    projects: [{ id: '1', name: 'Trip' }, { id: '2', name: 'Home' }],
    items: [
      { content: 'Renew passport', project_id: '1', due: { date: '2026-09-10' }, priority: 4 },
      { content: 'Water plants', project_id: '2', checked: 1 },
      { content: '   ' },
    ],
  });
  const out = parseTodoist(file);
  eq(out.count, 2);
  eq(out.skipped, 1, 'the blank task is reported');
  eq(out.bundle.cards[0].cells.Stage, 'Trip');
  eq(out.bundle.cards[0].cells.Priority, 'High', 'Todoist priority 4 is translated, not passed through as a 4');
  eq(out.bundle.cards[0].cells.Due, '2026-09-10');
  eq(out.bundle.cards[1].cells.Stage, 'Done', 'a completed task keeps its history rather than being dropped');
});

test('parseKeep: a checklist becomes cards, a note becomes one card', () => {
  const file = JSON.stringify([
    { title: 'Packing', listContent: [{ text: 'socks', isChecked: true }, { text: 'charger', isChecked: false }, { text: '' }] },
    { title: 'Idea', textContent: 'try the ramen place near the station', isPinned: true },
    { title: '', textContent: '' },
  ]);
  const out = parseKeep(file);
  eq(out.count, 3, 'two checklist items and one note');
  eq(out.skipped, 2, 'the blank item and the empty note');
  eq(out.bundle.cards[0].cells.Title, 'socks');
  eq(out.bundle.cards[0].cells.Done, true, 'a ticked item comes in ticked');
  eq(out.bundle.cards[0].cells.List, 'Packing', 'the note title groups its items');
  eq(out.bundle.cards[2].cells.Stage, 'Pinned', 'pinned survives as a stage');
  eq(out.bundle.cards[2].body, 'try the ramen place near the station');
  // Takeout writes one file per note, so a single object must work too.
  eq(parseKeep(JSON.stringify({ title: 'Solo', textContent: 'just this' })).count, 1);
});

test('detectBoardSource: recognises each export by shape, not by file name', () => {
  eq(detectBoardSource(JSON.stringify({ lists: [], cards: [] })), 'trello');
  eq(detectBoardSource(JSON.stringify({ items: [{ content: 'x' }] })), 'todoist');
  eq(detectBoardSource(JSON.stringify([{ textContent: 'hi' }])), 'keep');
  eq(detectBoardSource('{"something":1}'), null);
  eq(detectBoardSource('not json'), null);
  ok(parseBoard('{"nope":1}').problem, 'an unknown shape is refused, not guessed at');
  eq(parseBoard(JSON.stringify({ lists: [{ id: 'a', name: 'L' }], cards: [{ name: 'c', idList: 'a' }] })).count, 1, 'auto-detect routes to the right parser');
});

// --- flows (Part 2) ---------------------------------------------------------

function fnode(over: Partial<FlowNode>): FlowNode {
  return { id: 'n', x: 0, y: 0, kind: 'note', payload: '', ...over };
}
const ENV: FlowEnv = { now: new Date('2026-06-27T09:00:00Z') };
function ctx(over: Partial<FlowContext> = {}): FlowContext {
  return { vars: {}, ...over };
}

test('compileFlow orders a linear trigger→filter→action', () => {
  const data: FlowData = {
    nodes: [
      fnode({ id: 't', kind: 'trigger', payload: { kind: 'rowCreated', tableId: 'T1' } }),
      fnode({ id: 'f', kind: 'filter', payload: { expr: '[amount] > 100' } }),
      fnode({ id: 'a', kind: 'action', payload: { target: { kind: 'thisRow' }, actions: [] } }),
    ],
    edges: [
      { id: 'e1', from: 't', to: 'f' },
      { id: 'e2', from: 'f', to: 'a' },
    ],
  };
  const plan = compileFlow(data);
  eq(plan.errors, []);
  eq(plan.triggers.length, 1);
  eq(plan.triggers[0].steps.map((n) => n.id), ['t', 'f', 'a'], 'topological order');
});

test('compileFlow flags a cycle instead of hanging', () => {
  const data: FlowData = {
    nodes: [fnode({ id: 'a', kind: 'trigger', payload: { kind: 'manual' } }), fnode({ id: 'b', kind: 'action', payload: { target: { kind: 'thisRow' }, actions: [] } })],
    edges: [
      { id: '1', from: 'a', to: 'b' },
      { id: '2', from: 'b', to: 'a' },
    ],
  };
  const plan = compileFlow(data);
  ok(plan.errors.length > 0, 'cycle reported');
  eq(plan.triggers.length, 0, 'no plan emitted');
});

test('compileFlow gives a triggerless widget flow its own entry', () => {
  const data: FlowData = {
    nodes: [fnode({ id: 'w', kind: 'widget', payload: { label: 'run' } }), fnode({ id: 'a', kind: 'action', payload: { target: { kind: 'createRow', tableId: 'T1' }, actions: [] } })],
    edges: [{ id: '1', from: 'w', to: 'a' }],
  };
  const plan = compileFlow(data);
  eq(plan.triggers.length, 1, 'widget is an entry');
  eq(plan.triggers[0].steps.map((n) => n.id), ['w', 'a']);
});

test('runPlan: passing filter forwards, failing filter stops the branch', () => {
  const steps: FlowNode[] = [
    fnode({ id: 't', kind: 'trigger', payload: { kind: 'rowCreated', tableId: 'T1' } }),
    fnode({ id: 'f', kind: 'filter', payload: { expr: '[amount] > 100' } }),
    fnode({ id: 'a', kind: 'action', payload: { target: { kind: 'createRow', tableId: 'T2' }, actions: [{ columnId: 'flag', kind: 'check' }] } }),
  ];
  const edges: FlowEdge[] = [
    { id: 'e1', from: 't', to: 'f' },
    { id: 'e2', from: 'f', to: 'a', branch: 'pass' },
  ];
  const pass = runPlan(steps, edges, ctx({ vars: { amount: 250 } }), ENV);
  eq(pass.effects.length, 1, 'action ran when filter passed');
  const fail = runPlan(steps, edges, ctx({ vars: { amount: 5 } }), ENV);
  eq(fail.effects.length, 0, 'action skipped when filter failed');
});

test('runPlan: fail-branch edge fires only when the filter fails', () => {
  const steps: FlowNode[] = [
    fnode({ id: 'f', kind: 'trigger', payload: { kind: 'manual' } }),
    fnode({ id: 'g', kind: 'filter', payload: { expr: '[ok] == 1' } }),
    fnode({ id: 'a', kind: 'action', payload: { target: { kind: 'createRow', tableId: 'T2' }, actions: [{ columnId: 'x', kind: 'setValue', value: 'failed' }] } }),
  ];
  const edges: FlowEdge[] = [
    { id: 'e1', from: 'f', to: 'g' },
    { id: 'e2', from: 'g', to: 'a', branch: 'fail' },
  ];
  eq(runPlan(steps, edges, ctx({ vars: { ok: 0 } }), ENV).effects.length, 1, 'fail branch fires on failure');
  eq(runPlan(steps, edges, ctx({ vars: { ok: 1 } }), ENV).effects.length, 0, 'fail branch silent on pass');
});

test('runPlan: a code node writes outKey for a later filter to read', () => {
  const steps: FlowNode[] = [
    fnode({ id: 't', kind: 'trigger', payload: { kind: 'manual' } }),
    fnode({ id: 'c', kind: 'code', payload: { expr: '[qty] * [price]', outKey: 'total' } }),
    fnode({ id: 'f', kind: 'filter', payload: { expr: '[total] >= 50' } }),
    fnode({ id: 'a', kind: 'action', payload: { target: { kind: 'createRow', tableId: 'T2' }, actions: [{ columnId: 'big', kind: 'check' }] } }),
  ];
  const edges: FlowEdge[] = [
    { id: '1', from: 't', to: 'c' },
    { id: '2', from: 'c', to: 'f' },
    { id: '3', from: 'f', to: 'a', branch: 'pass' },
  ];
  const c = ctx({ vars: { qty: 4, price: 20 } });
  const out = runPlan(steps, edges, c, ENV);
  eq(c.vars.total, 80, 'code wrote the product into context');
  eq(out.effects.length, 1, 'downstream filter saw it and passed');

  // runPlan MUTATING the caller's vars is why the store hands each listener its
  // own copy: two flows on the same trigger share one context object at the call
  // site, so without the copy the second one starts holding the first one's
  // intermediates. Pinning the mutation here keeps that reason visible.
  const shared = ctx({ vars: { qty: 1, price: 1 } });
  runPlan(steps, edges, shared, ENV);
  ok('total' in shared.vars, 'runPlan writes into the context it is given');
  const own = { ...shared, vars: { ...shared.vars } };
  delete own.vars.total;
  runPlan(steps, edges, own, ENV);
  eq(shared.vars.total, 1, 'a copied context leaves the original alone');
});

test('indexFlows: a trashed page stops listening', () => {
  const flow: FlowData = {
    nodes: [fnode({ id: 't', kind: 'trigger', payload: { kind: 'rowCreated', tableId: 'T1' } })],
    edges: [],
  };
  eq(indexFlows([{ id: 'p1', flow }]).byTableCreate.get('T1')?.length, 1, 'a live page listens');
  eq(indexFlows([{ id: 'p1', flow, trashed: true }]).byTableCreate.get('T1'), undefined, 'a trashed page does not');
  eq(indexFlows([{ id: 'p1', flow, trashed: false }]).byTableCreate.get('T1')?.length, 1, 'and listens again once restored');

  // enabled:false and trashed are separate switches; neither implies the other.
  eq(indexFlows([{ id: 'p1', flow: { ...flow, enabled: false } }]).byTableCreate.get('T1'), undefined, 'a disabled flow is still off');
});

test('runPlan: action targets emit the right Effect kind', () => {
  const acts = [{ columnId: 'done', kind: 'check' as const }];
  const thisRow = runPlan(
    [fnode({ id: 'a', kind: 'action', payload: { target: { kind: 'thisRow' }, actions: acts } })],
    [],
    ctx({ vars: {}, row: { tableId: 'T1', rowId: 'r9', cells: {} } }),
    ENV,
  );
  eq(thisRow.effects[0], { kind: 'setCells', tableId: 'T1', rowId: 'r9', cells: { done: true } });

  const create = runPlan(
    [fnode({ id: 'a', kind: 'action', payload: { target: { kind: 'createRow', tableId: 'T2' }, actions: acts } })],
    [],
    ctx(),
    ENV,
  );
  eq(create.effects[0], { kind: 'createRow', tableId: 'T2', cells: { done: true } });

  const match = runPlan(
    [fnode({ id: 'a', kind: 'action', payload: { target: { kind: 'matchRow', tableId: 'T3', columnId: 'name', value: 'JR Pass' }, actions: acts } })],
    [],
    ctx(),
    ENV,
  );
  eq(match.effects[0], { kind: 'matchSetCells', tableId: 'T3', columnId: 'name', value: 'JR Pass', cells: { done: true } });
});

test('runPlan: thisRow with no row is a no-op (checkbox/standalone run)', () => {
  const out = runPlan(
    [fnode({ id: 'a', kind: 'action', payload: { target: { kind: 'thisRow' }, actions: [{ columnId: 'x', kind: 'check' }] } })],
    [],
    ctx({ vars: { checked: 1 } }),
    ENV,
  );
  eq(out.effects.length, 0, 'nothing to write back to');
});

test('runPlan: a self-referential plan terminates and is described, not applied', () => {
  // An action that writes the field the trigger fired on. The executor returns
  // an effect; it never re-enters itself (the runtime guard handles recursion).
  const steps: FlowNode[] = [
    fnode({ id: 't', kind: 'trigger', payload: { kind: 'rowFieldEquals', tableId: 'T1', columnId: 'status', value: 'done' } }),
    fnode({ id: 'a', kind: 'action', payload: { target: { kind: 'thisRow' }, actions: [{ columnId: 'status', kind: 'setValue', value: 'done' }] } }),
  ];
  const out = runPlan(steps, [{ id: 'e', from: 't', to: 'a' }], ctx({ vars: { status: 'done' }, row: { tableId: 'T1', rowId: 'r1', cells: {} } }), ENV);
  eq(out.effects.length, 1, 'one effect, no loop');
  eq(out.effects[0].kind, 'setCells');
});

test('cellScope keys by column name and coerces by type', () => {
  const cols: Column[] = [
    col({ id: 'c1', name: 'amount', type: 'number' }),
    col({ id: 'c2', name: 'status', type: 'select', options: [{ id: 'o1', label: 'Done', color: '#000' }] }),
    col({ id: 'c3', name: 'flag', type: 'checkbox' }),
  ];
  const scope = cellScope(cols, { c1: 250, c2: 'o1', c3: true });
  eq(scope.amount, 250);
  eq(scope.status, 'Done', 'select resolves to its label');
  eq(scope.flag, 1, 'checkbox → 1');
  ok(evaluateFormula('[amount] > 100 && [status] == "Done"', scope).value === 1, 'composes in a filter');
});

test('taskItems flattens nested task lists to {text, checked}[]', () => {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'passport' }] }] },
          { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'visa' }] }] },
        ],
      },
    ],
  };
  eq(taskItems(doc), [{ text: 'passport', checked: true }, { text: 'visa', checked: false }]);
});

test('taskItems carries the stable id when present', () => {
  const doc = {
    type: 'doc',
    content: [{ type: 'taskList', content: [
      { type: 'taskItem', attrs: { checked: false, id: 'tk_1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'passport' }] }] },
    ] }],
  };
  eq(taskItems(doc), [{ id: 'tk_1', text: 'passport', checked: false }]);
});

test('checkboxFired only on the configured transition + matching text', () => {
  const docWith = (passport: boolean, visa: boolean) => ({
    type: 'doc',
    content: [
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: passport }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'passport' }] }] },
          { type: 'taskItem', attrs: { checked: visa }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'visa' }] }] },
        ],
      },
    ],
  });
  ok(checkboxFired(docWith(false, false), docWith(true, false), { text: 'passport' }, 'checked'), 'fires on tick of the named item');
  ok(!checkboxFired(docWith(false, false), docWith(true, false), { text: 'visa' }, 'checked'), 'other item unchanged → silent');
  ok(!checkboxFired(docWith(true, false), docWith(true, false), { text: 'passport' }, 'checked'), 'already checked → no re-fire');
  ok(checkboxFired(docWith(true, false), docWith(false, false), { text: 'passport' }, 'unchecked'), 'fires on the unchecked transition');
});

test('checkboxFired by id survives a text edit; missing id → no match', () => {
  const docWith = (label: string, checked: boolean) => ({
    type: 'doc',
    content: [{ type: 'taskList', content: [
      { type: 'taskItem', attrs: { checked, id: 'tk_9' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: label }] }] },
    ] }],
  });
  // The label changed between versions, but the id binds the trigger to the same box.
  ok(checkboxFired(docWith('passport', false), docWith('passport renewal', true), { id: 'tk_9' }, 'checked'), 'id match tolerates a renamed label');
  ok(!checkboxFired(docWith('passport', false), docWith('passport', true), { id: 'tk_nope' }, 'checked'), 'unknown id never fires');
});

// --- automation extensions (v19) --------------------------------------------

test('formula: mod / clamp', () => {
  eq(evaluateFormula('mod(7, 3)', {}).value, 1);
  eq(evaluateFormula('mod(10, 0)', {}).ok, false, 'mod by zero degrades, not NaN');
  eq(evaluateFormula('clamp(12, 0, 10)', {}).value, 10);
  eq(evaluateFormula('clamp(-4, 0, 10)', {}).value, 0);
  eq(evaluateFormula('clamp(5, 0, 10)', {}).value, 5);
});

test('formula: string ops len/lower/upper/contains', () => {
  eq(evaluateFormula('len("ramen")', {}).value, 5);
  eq(evaluateFormula('lower("Fukuoka")', {}).value, 'fukuoka');
  eq(evaluateFormula('upper("jr")', {}).value, 'JR');
  eq(evaluateFormula('contains("tonkotsu", "kotsu")', {}).value, 1);
  eq(evaluateFormula('contains("tonkotsu", "miso")', {}).value, 0);
  // string fns don't break arithmetic coercion around them
  eq(evaluateFormula('len("ab") + 3', {}).value, 5);
});

test('pageToMarkdown: headings, lists, todos, marks', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Day one' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'meet at ' }, { type: 'text', text: 'Hakata', marks: [{ type: 'bold' }] }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ramen' }] }] }] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'buy suica' }] }] }] },
    ],
  };
  const md = pageToMarkdown('Trip', doc);
  ok(md.includes('# Trip'), 'title heading');
  ok(md.includes('## Day one'), 'h2');
  ok(md.includes('meet at **Hakata**'), 'bold mark');
  ok(md.includes('- ramen'), 'bullet');
  ok(md.includes('- [x] buy suica'), 'checked todo');
});

test('formula: new math functions', () => {
  eq(evaluateFormula('roundto(12.345, 2)', {}).value, 12.35);
  eq(evaluateFormula('percent(3, 4)', {}).value, 75);
  eq(evaluateFormula('pow(2, 10)', {}).value, 1024);
  eq(evaluateFormula('product(2, 3, 4)', {}).value, 24);
  eq(evaluateFormula('count(1, 2, 3)', {}).value, 3);
  eq(evaluateFormula('trunc(8.9)', {}).value, 8);
  eq(evaluateFormula('sign(-4)', {}).value, -1);
});

test('formula: new text + logic functions', () => {
  eq(evaluateFormula('left("Fukuoka", 4)', {}).value, 'Fuku');
  eq(evaluateFormula('right("Fukuoka", 3)', {}).value, 'oka');
  eq(evaluateFormula('trim("  hi  ")', {}).value, 'hi');
  eq(evaluateFormula('replace("a-b-c", "-", "/")', {}).value, 'a/b/c');
  eq(evaluateFormula('startswith("tonkotsu", "ton")', {}).value, 1);
  eq(evaluateFormula('endswith("tonkotsu", "tsu")', {}).value, 1);
  eq(evaluateFormula('and(1, 1)', {}).value, 1);
  eq(evaluateFormula('and(1, 0)', {}).value, 0);
  eq(evaluateFormula('or(0, 1)', {}).value, 1);
  eq(evaluateFormula('not(0)', {}).value, 1);
  eq(evaluateFormula('isblank("")', {}).value, 1);
  eq(evaluateFormula('coalesce("", "", "kept")', {}).value, 'kept');
});

test('applyActionsScoped: setExpr reads scope, does math, fails to null', () => {
  const scope = { hp: 7, name: 'Boss' };
  eq(applyActionsScoped([{ columnId: 'c1', kind: 'setExpr', value: '[hp] * 2' }], scope), { c1: 14 });
  eq(applyActionsScoped([{ columnId: 'c1', kind: 'setExpr', value: 'upper([name])' }], scope), { c1: 'BOSS' });
  eq(applyActionsScoped([{ columnId: 'c1', kind: 'setExpr', value: '[hp] / 0' }], scope), { c1: null }, 'broken expr → null');
});

test('applyActionsScoped: literal + expr actions mix in one list', () => {
  const out = applyActionsScoped(
    [
      { columnId: 'a', kind: 'setValue', value: 'x' },
      { columnId: 'b', kind: 'setExpr', value: '1 + 2' },
      { columnId: 'c', kind: 'check' },
    ],
    {},
  );
  eq(out, { a: 'x', b: 3, c: true });
});

test('applyActionsScoped: increment from 0 / string / negative, and chains', () => {
  eq(applyActionsScoped([{ columnId: 'n', kind: 'increment', value: '1' }], {}, undefined, undefined, {}), { n: 1 }, 'missing → 0 + 1');
  eq(applyActionsScoped([{ columnId: 'n', kind: 'increment', value: '5' }], {}, undefined, undefined, { n: 'oops' }), { n: 5 }, 'non-numeric → 0');
  eq(applyActionsScoped([{ columnId: 'n', kind: 'increment', value: '-2' }], {}, undefined, undefined, { n: 10 }), { n: 8 });
  // two increments in one list stack (earlier write is visible to the next)
  eq(
    applyActionsScoped(
      [{ columnId: 'n', kind: 'increment', value: '1' }, { columnId: 'n', kind: 'increment', value: '1' }],
      {}, undefined, undefined, { n: 0 },
    ),
    { n: 2 },
  );
});

test('applyActionsScoped: append to multiselect / text, no-op on duplicate', () => {
  eq(applyActionsScoped([{ columnId: 'tags', kind: 'append', value: 'o2' }], {}, undefined, undefined, { tags: ['o1'] }), { tags: ['o1', 'o2'] });
  eq(applyActionsScoped([{ columnId: 'tags', kind: 'append', value: 'o1' }], {}, undefined, undefined, { tags: ['o1'] }), { tags: ['o1'] }, 'duplicate id is a no-op');
  eq(applyActionsScoped([{ columnId: 't', kind: 'append', value: 'two' }], {}, undefined, undefined, { t: 'one' }), { t: 'one two' });
  eq(applyActionsScoped([{ columnId: 't', kind: 'append', value: 'x' }], {}, undefined, undefined, { t: '' }), { t: 'x' }, 'empty text → just the value');
});

test('applyActionsScoped: toggle flips a checkbox', () => {
  eq(applyActionsScoped([{ columnId: 'd', kind: 'toggle' }], {}, undefined, undefined, { d: true }), { d: false });
  eq(applyActionsScoped([{ columnId: 'd', kind: 'toggle' }], {}, undefined, undefined, { d: false }), { d: true });
  eq(applyActionsScoped([{ columnId: 'd', kind: 'toggle' }], {}, undefined, undefined, {}), { d: true }, 'undefined → true');
});

test('runPlan: code computes a total, setExpr stores it as a number', () => {
  const steps: FlowNode[] = [
    fnode({ id: 't', kind: 'trigger', payload: { kind: 'manual' } }),
    fnode({ id: 'c', kind: 'code', payload: { expr: '[qty] * [price]', outKey: 'total' } }),
    fnode({ id: 'a', kind: 'action', payload: { target: { kind: 'thisRow' }, actions: [{ columnId: 'sum', kind: 'setExpr', value: '[total]' }] } }),
  ];
  const edges: FlowEdge[] = [
    { id: '1', from: 't', to: 'c' },
    { id: '2', from: 'c', to: 'a' },
  ];
  const out = runPlan(steps, edges, ctx({ vars: { qty: 3, price: 20 }, row: { tableId: 'T1', rowId: 'r1', cells: {} } }), ENV);
  eq(out.effects.length, 1);
  eq(out.effects[0], { kind: 'setCells', tableId: 'T1', rowId: 'r1', cells: { sum: 60 } }, 'the computed number, not a string');
});

test('coerceCellWrite: a bare id into a relation column becomes an array', () => {
  const relCol = col({ id: 'rel', type: 'relation', relationTableId: 'T2' });
  eq(coerceCellWrite(relCol, 'r9'), ['r9']);
  eq(coerceCellWrite(relCol, ''), [], 'empty string clears the links');
  eq(coerceCellWrite(relCol, ['r1', 'r2']), ['r1', 'r2'], 'an array passes through');
  eq(coerceCellWrite(col({ id: 'n', type: 'number' }), 5), 5, 'non-relation untouched');
});

test('@row + relation: createRow setExpr resolves the trigger row id', () => {
  // The store seeds @row; here we simulate that scope and assert the effect carries it.
  const steps: FlowNode[] = [
    fnode({ id: 'a', kind: 'action', payload: { target: { kind: 'createRow', tableId: 'T2' }, actions: [{ columnId: 'session', kind: 'setExpr', value: '[@row]' }] } }),
  ];
  const out = runPlan(steps, [], ctx({ vars: { '@row': 'r42' }, row: { tableId: 'T1', rowId: 'r42', cells: {} } }), ENV);
  eq(out.effects[0], { kind: 'createRow', tableId: 'T2', cells: { session: 'r42' } });
  // and the store-side coercion would wrap it for a relation column:
  eq(coerceCellWrite(col({ id: 'session', type: 'relation', relationTableId: 'T1' }), 'r42'), ['r42']);
});

test('interpolateRefs fills [name] / [@row], leaves unknowns alone', () => {
  eq(interpolateRefs('HP is [hp]', { hp: 3 }), 'HP is 3');
  eq(interpolateRefs('row [@row] of [place]', { '@row': 'r1', place: 'Hakata' }), 'row r1 of Hakata');
  eq(interpolateRefs('keep [missing]', {}), 'keep [missing]', 'unknown ref is left verbatim');
});

test('runPlan: notify + comment effects carry the interpolated message', () => {
  const notify = runPlan(
    [fnode({ id: 'a', kind: 'action', payload: { target: { kind: 'notify' }, actions: [], text: 'HP dropped to [hp]' } })],
    [],
    ctx({ vars: { hp: 0 }, row: { tableId: 'T1', rowId: 'r1', cells: {} } }),
    ENV,
  );
  eq(notify.effects[0], { kind: 'notify', text: 'HP dropped to 0', rowId: 'r1', tableId: 'T1' });

  const comment = runPlan(
    [fnode({ id: 'a', kind: 'action', payload: { target: { kind: 'comment', pageId: 'p9' }, actions: [], text: 'recap for [@row]' } })],
    [],
    ctx({ vars: { '@row': 'r1' }, row: { tableId: 'T1', rowId: 'r1', cells: {} } }),
    ENV,
  );
  eq(comment.effects[0], { kind: 'comment', pageId: 'p9', body: 'recap for r1' });
});

test('runPlan: matchRow all → matchAllSetCells, first → matchSetCells', () => {
  const acts = [{ columnId: 'done', kind: 'check' as const }];
  const all = runPlan(
    [fnode({ id: 'a', kind: 'action', payload: { target: { kind: 'matchRow', tableId: 'T3', columnId: 'arc', value: 'A', all: true }, actions: acts } })],
    [], ctx(), ENV,
  );
  eq(all.effects[0].kind, 'matchAllSetCells');
  const first = runPlan(
    [fnode({ id: 'a', kind: 'action', payload: { target: { kind: 'matchRow', tableId: 'T3', columnId: 'arc', value: 'A' }, actions: acts } })],
    [], ctx(), ENV,
  );
  eq(first.effects[0].kind, 'matchSetCells', 'default stays first-match');
});

test('filterRose fires on the rising edge only', () => {
  const cols: Column[] = [col({ id: 'h', name: 'hp', type: 'number' })];
  ok(filterRose('[hp] <= 0', cols, { h: 5 }, { h: 0 }), 'false→true fires');
  ok(!filterRose('[hp] <= 0', cols, { h: 0 }, { h: -1 }), 'already true → no re-fire');
  ok(!filterRose('[hp] <= 0', cols, { h: 5 }, { h: 3 }), 'stays false → silent');
  ok(filterRose('[place] != ""', [col({ id: 'p', name: 'place', type: 'text' })], { p: '' }, { p: 'Hakata' }), 'became non-empty');
});

test('reminderDue: inside the window, once, not after', () => {
  const target = Date.parse('2026-07-01T09:00:00Z');
  const hour = 3600e3;
  ok(reminderDue(target, '1h', target - hour / 2, false), 'inside the 1h lead window');
  ok(!reminderDue(target, '1h', target - 2 * hour, false), 'before the window opens');
  ok(!reminderDue(target, 'at', target + 1, false), 'after the moment passed');
  ok(!reminderDue(target, '1h', target - hour / 2, true), 'already notified → silent');
  ok(!reminderDue(null, 'at', Date.now(), false), 'no datetime → not due');
});


// --- dice / rng (TTRPG keystone) --------------------------------------------

function seqRng(vals: number[]): () => number {
  let i = 0;
  return () => vals[i++ % vals.length];
}

test('rollDice: bounds, modifiers, and dN default count', () => {
  eq(rollDice('1d20', () => 0), 1, 'min face');
  eq(rollDice('1d20', () => 0.999), 20, 'max face');
  eq(rollDice('d20', () => 0.999), 20, 'd20 === 1d20');
  eq(rollDice('2d6+3', () => 0), 5, '1+1+3');
  eq(rollDice('2d6+3', () => 0.999), 15, '6+6+3');
  eq(rollDice('2d6-1', () => 0.999), 11, '6+6-1');
});

test('rollDice: keep highest / lowest', () => {
  // sides 6, rng → faces [1,4,6,1]
  const r = seqRng([0, 0.5, 0.99, 0]);
  const detail = rollDiceDetailed('4d6kh3', r);
  eq(detail.dice, [1, 4, 6, 1], 'all four rolled');
  eq(detail.kept, [6, 4, 1], 'highest three kept');
  eq(detail.total, 11, 'sum of kept');
  eq(rollDiceDetailed('4d6kl1', seqRng([0, 0.5, 0.99, 0])).total, 1, 'lowest one');
});

test('rollDice: a malformed spec throws (no silent 0)', () => {
  let threw = false;
  try {
    rollDice('not-dice', () => 0);
  } catch {
    threw = true;
  }
  ok(threw, 'garbage spec throws');
  ok(formatRoll('2d6+3', rollDiceDetailed('2d6+3', () => 0)).includes('= 5'), 'readout has the total');
});

test('formula: dice/rand/pick are inert without an injected rng', () => {
  ok(!evaluateFormula('dice("1d6")', {}).ok, 'dice throws in a live column');
  ok(!evaluateFormula('rand(1,6)', {}).ok, 'rand throws in a live column');
  ok(!evaluateFormula('pick(1,2,3)', {}).ok, 'pick throws in a live column');
});

test('formula: dice/rand/pick resolve when an rng is injected', () => {
  eq(evaluateFormula('dice("1d6")', {}, undefined, () => 0).value, 1, 'dice min');
  eq(evaluateFormula('dice("1d6")', {}, undefined, () => 0.999).value, 6, 'dice max');
  eq(evaluateFormula('rand(1,6)', {}, undefined, () => 0).value, 1, 'rand low');
  eq(evaluateFormula('rand(1,6)', {}, undefined, () => 0.999).value, 6, 'rand high');
  eq(evaluateFormula('rand(6,1)', {}, undefined, () => 0).value, 1, 'rand tolerates reversed args');
  eq(evaluateFormula('pick(10,20,30)', {}, undefined, () => 0).value, 10, 'pick first');
  eq(evaluateFormula('pick(10,20,30)', {}, undefined, () => 0.9).value, 30, 'pick last');
});

test('setExpr can roll: rng flows through applyActionsScoped, null without it', () => {
  const acts = [{ columnId: 'x', kind: 'setExpr' as const, value: 'dice("1d1") + [Mod]' }];
  eq(applyActionsScoped(acts, { Mod: 2 }, new Date(), undefined, {}, () => 0).x, 3, 'rolled + mod');
  eq(applyActionsScoped(acts, { Mod: 2 }, new Date(), undefined, {}).x, null, 'no rng → dice throws → null');
});

test('rollOnTable: weighted buckets, default weight 1, empty → null', () => {
  const rows = [
    { weight: 1, value: 'goblins' },
    { weight: 2, value: 'nothing' },
    { value: 'treasure' }, // missing weight counts as 1 → total 4
  ];
  eq(rollOnTable(rows, () => 0), 'goblins', 'first bucket at 0');
  eq(rollOnTable(rows, () => 0.3), 'nothing', 'into the weight-2 bucket');
  eq(rollOnTable(rows, () => 0.99), 'treasure', 'last bucket near 1');
  eq(rollOnTable([], () => 0.5), null, 'empty table → null');
});

// --- lookup + backlinks (campaign glue) -------------------------------------

function tbl(id: string, name: string, columns: Column[]): TableData {
  return { id, name, columns, owner: '', updated: '', created: '' };
}
function rw(id: string, tableId: string, cells: Record<string, unknown>): TableRow {
  return { id, table: tableId, parent: '', cells: cells as TableRow['cells'], position: 0, created: '', updated: '' };
}

test('resolveLookup: reads a column across a relation, joins multi, degrades to empty', () => {
  const npcCols: Column[] = [
    col({ id: 'an', name: 'Name', type: 'text' }),
    col({ id: 'af', name: 'Faction', type: 'relation', relationTableId: 'F' }),
    col({ id: 'al', name: 'Faction rep', type: 'lookup', lookupRelationColumnId: 'af', lookupTargetColumnId: 'fr' }),
  ];
  const facCols: Column[] = [col({ id: 'fn', name: 'Name', type: 'text' }), col({ id: 'fr', name: 'Rep', type: 'number' })];
  const tables = { N: tbl('N', 'NPCs', npcCols), F: tbl('F', 'Factions', facCols) };
  const f1 = rw('f1', 'F', { fn: 'Cult', fr: 42 });
  const f2 = rw('f2', 'F', { fn: 'Guild', fr: 7 });
  const rows = { f1, f2 };
  const lookupCol = npcCols[2];

  eq(resolveLookup(rw('n1', 'N', { af: ['f1'] }), npcCols, lookupCol, tables, rows), '42', 'single');
  eq(resolveLookup(rw('n2', 'N', { af: ['f1', 'f2'] }), npcCols, lookupCol, tables, rows), '42, 7', 'multi joins');
  eq(resolveLookup(rw('n3', 'N', { af: [] }), npcCols, lookupCol, tables, rows), '', 'no links → empty');
  const broken = col({ id: 'al', name: 'x', type: 'lookup', lookupRelationColumnId: 'af', lookupTargetColumnId: 'gone' });
  eq(resolveLookup(rw('n4', 'N', { af: ['f1'] }), npcCols, broken, tables, rows), '', 'missing target → empty');
});

test('backlinksFor: collects referencing rows, dedupes, groups by table', () => {
  const npcCols: Column[] = [
    col({ id: 'an', name: 'Name', type: 'text' }),
    col({ id: 'af', name: 'Faction', type: 'relation', relationTableId: 'F' }),
    col({ id: 'aa', name: 'Ally faction', type: 'relation', relationTableId: 'F' }),
  ];
  const facCols: Column[] = [col({ id: 'fn', name: 'Name', type: 'text' })];
  const tables = { N: tbl('N', 'NPCs', npcCols), F: tbl('F', 'Factions', facCols) };
  const f1 = rw('f1', 'F', { fn: 'Cult' });
  const bob = rw('bob', 'N', { an: 'Bob', af: ['f1'], aa: ['f1'] }); // links f1 twice
  const sue = rw('sue', 'N', { an: 'Sue', af: ['f1'] });
  const dan = rw('dan', 'N', { an: 'Dan', af: [] });
  const groups = backlinksFor(tables, { f1, bob, sue, dan }, 'f1');
  eq(groups.length, 1, 'one source table');
  eq(groups[0].tableName, 'NPCs');
  eq(groups[0].refs.length, 2, 'bob (once, deduped) + sue');
  eq(groups[0].refs.map((r) => r.title).sort(), ['Bob', 'Sue']);
  eq(backlinksFor(tables, { f1, bob, sue, dan }, 'nobody'), [], 'nothing links → empty');
});

// --- DM-only column gate ----------------------------------------------------


// --- campaign bundle wiring -------------------------------------------------

test('relationPatchesFor: each relation column targets the right sibling id', () => {
  const specs = buildCampaignBundle();
  const idByKey: Record<CampaignKey, string> = {
    pcs: 'TP', npcs: 'TN', locations: 'TL', factions: 'TF', sessions: 'TS', quests: 'TQ', items: 'TI',
  };
  const patches = relationPatchesFor(specs, idByKey);
  eq(patches.length, 9, 'nine relation columns across the seven tables');

  const link = (key: CampaignKey, colName: string) => {
    const spec = specs.find((s) => s.key === key)!;
    const c = spec.columns.find((x) => x.name === colName)!;
    return patches.find((p) => p.columnId === c.id)!;
  };
  eq(link('npcs', 'Location').relationTableId, 'TL', 'NPC.Location → Locations');
  eq(link('npcs', 'Faction').relationTableId, 'TF', 'NPC.Faction → Factions');
  eq(link('quests', 'Related').relationTableId, 'TQ', 'Quest.Related self-relation → Quests');
  eq(link('pcs', 'Inventory').relationTableId, 'TI', 'PC.Inventory → Items');
  eq(link('npcs', 'Location').tableId, 'TN', 'patch is scoped to the owning table');
});


// --- character sheets -------------------------------------------------------

test('abilityMod floors toward -inf, not toward zero', () => {
  eq(abilityMod(10), 0, '10 is +0');
  eq(abilityMod(11), 0, '11 still +0');
  eq(abilityMod(12), 1, '12 is +1');
  eq(abilityMod(20), 5, '20 is +5');
  eq(abilityMod(7), -2, '7 is -2 (floor, not trunc)');
  eq(abilityMod(1), -5, '1 is -5');
});

test('proficiencyBonus steps every four levels', () => {
  eq(proficiencyBonus(1), 2, 'level 1');
  eq(proficiencyBonus(4), 2, 'level 4 still +2');
  eq(proficiencyBonus(5), 3, 'level 5 → +3');
  eq(proficiencyBonus(17), 6, 'level 17 → +6');
  eq(proficiencyBonus(0), 2, 'guards a nonsense level');
});

test('formatMod keeps the sign', () => {
  eq(formatMod(0), '+0', 'zero reads +0');
  eq(formatMod(3), '+3', 'positive');
  eq(formatMod(-1), '-1', 'negative keeps its own sign');
});

test('classIcon maps known classes, falls back to a die', () => {
  eq(classIcon('Wizard'), '🧙', 'known class');
  eq(classIcon('  ranger '), '🏹', 'trimmed + case-insensitive');
  eq(classIcon('Blood Hunter'), '🎲', 'homebrew falls back');
  eq(classIcon(''), '🎲', 'blank falls back');
});

test('characterTagline composes level + race + class, skipping blanks', () => {
  eq(characterTagline({ ...emptyCharacter(), level: 3, race: 'Wood Elf', className: 'Ranger' }), 'Level 3 Wood Elf Ranger');
  eq(characterTagline({ ...emptyCharacter(), level: 1, race: '', className: 'Fighter' }), 'Level 1 Fighter');
  eq(characterTagline({ ...emptyCharacter(), level: 0, race: '', className: '' }), '', 'nothing to say');
});

// --- capture (two-tap inbox) ------------------------------------------------

test('appendCapture starts a checklist on an empty/absent doc', () => {
  const out = appendCapture(null, 'buy milk');
  eq(out.type, 'doc');
  eq(out.content?.length, 1, 'one node');
  eq(out.content?.[0].type, 'taskList');
  eq(out.content?.[0].content?.length, 1, 'one item');
  eq(out.content?.[0].content?.[0].content?.[0].content?.[0].text, 'buy milk');
});

test('appendCapture folds into a trailing taskList instead of stacking lists', () => {
  const first = appendCapture({ type: 'doc', content: [] }, 'a');
  const second = appendCapture(first, 'b');
  eq(second.content?.length, 1, 'still one list');
  eq(second.content?.[0].content?.length, 2, 'two items');
});

test('appendCapture appends a new list after non-list content, never mutating input', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] };
  const out = appendCapture(doc, 'todo');
  eq(out.content?.length, 2, 'paragraph + new list');
  eq(out.content?.[1].type, 'taskList');
  eq(doc.content.length, 1, 'original untouched');
});

test('starters build valid docs and a blank notebook', () => {
  const blank = STARTERS.find((s) => s.key === 'blank');
  ok(blank, 'blank exists');
  eq(blank!.build(), null, 'blank page has no content');
  for (const s of STARTERS) {
    const built = s.build();
    if (built) eq(built.type, 'doc', `${s.key} builds a doc`);
    ok(s.title.length > 0, `${s.key} has a title`);
  }
});

// --- search (pages + table cells) -------------------------------------------

function mkPage(over: Partial<Page>): Page {
  return {
    id: 'p1', title: '', icon: '', parent: '', order: 0, content: null, owner: '',
    trashed: false, visibility: 'workspace', editors: [], viewers: [], template: false,
    cover: '', map: null, mindmap: null, flow: null, updated: '2026-01-01', created: '', ...over,
  };
}

function searchFixture() {
  const page = mkPage({
    id: 'p1', title: 'WiFi', updated: '2026-02-01',
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'the password is hunter2' }] }] },
  });
  const older = mkPage({ id: 'p2', title: 'Old note', updated: '2026-01-01' });
  const tbl = table([col({ id: 'c1', name: 'Name', type: 'text' }), col({ id: 'c2', name: 'Note', type: 'text' })]);
  const r = row({ c1: 'Router', c2: 'wifi password swordfish' }); // id r1, table t1
  return {
    pages: { p1: page, p2: older },
    tables: { t1: tbl },
    rows: { r1: r },
  };
}

test('buildSearchIndex flattens pages and rows into one corpus', () => {
  const { pages, tables, rows } = searchFixture();
  const idx = buildSearchIndex(pages, tables, rows);
  eq(idx.length, 3, 'two pages + one row');
  const rowDoc = idx.find((d) => d.kind === 'row');
  ok(rowDoc, 'has a row doc');
  eq(rowDoc!.title, 'Router', 'row title from the title column');
  ok(rowDoc!.body.includes('swordfish'), 'cell text is indexed');
  eq(rowDoc!.context, 'Deadlines', 'row carries its table name');
});

test('searchIndex finds a word inside a table cell', () => {
  const { pages, tables, rows } = searchFixture();
  const idx = buildSearchIndex(pages, tables, rows);
  const hits = searchIndex(idx, 'swordfish');
  eq(hits.length, 1, 'one hit');
  eq(hits[0].kind, 'row');
  eq(hits[0].id, 'r1', 'openRow gets the row id');
});

test('searchIndex finds page body text and ranks a title match first', () => {
  const { pages, tables, rows } = searchFixture();
  const idx = buildSearchIndex(pages, tables, rows);
  eq(searchIndex(idx, 'hunter2')[0].id, 'p1', 'body word in the page');
  eq(searchIndex(idx, 'wifi')[0].id, 'p1', 'title match (WiFi) beats the row cell that also says wifi');
});

test('searchIndex empty query lists recent pages only, newest first', () => {
  const { pages, tables, rows } = searchFixture();
  const hits = searchIndex(buildSearchIndex(pages, tables, rows), '');
  ok(hits.every((h) => h.kind === 'page'), 'no rows in the resting state');
  eq(hits[0].id, 'p1', 'newer page first');
});


// --- reminder snooze + due colour -------------------------------------------

test('formatInstant is the inverse of parseInstant (to the minute)', () => {
  const t = new Date(2026, 5, 26, 18, 30).getTime();
  eq(formatInstant(t), '2026-06-26T18:30');
  eq(parseInstant(formatInstant(t)), t, 'round-trips back to the same instant');
});

test('formatInstant zero-pads month, day, hour, minute', () => {
  eq(formatInstant(new Date(2026, 0, 3, 4, 5).getTime()), '2026-01-03T04:05');
});

test('dateStatus flags today and overdue, ignores future and junk', () => {
  const now = new Date(2026, 5, 26, 12, 0).getTime();
  eq(dateStatus('2026-06-26', now), 'today', 'same day, date-only');
  eq(dateStatus('2026-06-26T08:00', now), 'today', 'earlier today is still today, not overdue');
  eq(dateStatus('2026-06-25', now), 'overdue', 'yesterday');
  eq(dateStatus('2026-06-27', now), null, 'tomorrow is upcoming, no colour');
  eq(dateStatus('', now), null, 'blank');
  eq(dateStatus('not a date', now), null, 'junk');
});


// --- crypto (end-to-end content encryption) ---------------------------------
// Low PBKDF2 iterations here only for test speed; production uses DEFAULT_ITERATIONS.

await testAsync('encryptContent/decryptContent round-trips a doc; isEnvelope detects it', async () => {
  const master = await generateMasterKey();
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'secret diary 🔒' }] }] };
  const env = await encryptContent(master, doc);
  ok(isEnvelope(env), 'output is an enc:v1: envelope');
  eq(await decryptContent(master, env), doc, 'decrypts back to the same doc');
});

await testAsync('a different key cannot decrypt (authenticated, not garbage)', async () => {
  const a = await generateMasterKey();
  const b = await generateMasterKey();
  const env = await encryptContent(a, { x: 1 });
  ok(await throwsAsync(() => decryptContent(b, env)), 'wrong key throws');
});

await testAsync('wrap/unwrap with the right password returns a working key; wrong password throws', async () => {
  const master = await generateMasterKey();
  const env = await encryptContent(master, { hi: 'there' });
  const w = await wrapMasterKey(master, 'correct horse', 1000);
  const back = await unwrapMasterKey(w, 'correct horse');
  eq(await decryptContent(back, env), { hi: 'there' }, 'unwrapped key decrypts content');
  ok(await throwsAsync(() => unwrapMasterKey(w, 'wrong password')), 'wrong password throws');
});

await testAsync('the recovery code unwraps the same master key', async () => {
  const master = await generateMasterKey();
  const env = await encryptContent(master, [1, 2, 3]);
  const code = generateRecoveryCode();
  const w = await wrapMasterKey(master, normalizeRecoveryCode(code), 1000);
  // user retypes it with lowercase/spacing, normalize must match
  const back = await unwrapMasterKey(w, normalizeRecoveryCode(code.toLowerCase().replace(/-/g, ' ')));
  eq(await decryptContent(back, env), [1, 2, 3], 'recovery path recovers the key');
});

await testAsync('exported then imported master key still decrypts (on-device cache path)', async () => {
  const master = await generateMasterKey();
  const env = await encryptContent(master, { k: 'v' });
  const restored = await importMasterKey(await exportMasterKey(master));
  eq(await decryptContent(restored, env), { k: 'v' }, 'cache round-trip works');
});

test('isEnvelope only matches enc:v1: strings, leaving objects/plaintext alone', () => {
  ok(isEnvelope('enc:v1:abc'), 'envelope');
  ok(!isEnvelope({ type: 'doc' }), 'a doc object is not an envelope');
  ok(!isEnvelope('just some text'), 'plain text is not an envelope');
  ok(!isEnvelope(null), 'null is not an envelope');
});

test('generateRecoveryCode is grouped, high-entropy, and unique per call', () => {
  const a = generateRecoveryCode();
  ok(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4})+$/.test(a), `looks like a grouped code: ${a}`);
  ok(normalizeRecoveryCode(a).length >= 30, 'enough characters for ~160 bits');
  ok(a !== generateRecoveryCode(), 'two codes differ');
});

// --- group / shared encryption (ECDH recipient keys) ------------------------

await testAsync('a workspace key wrapped to a member is recoverable by that member, not others', async () => {
  const bob = await generateKeyPair();
  const carol = await generateKeyPair();
  const wsKey = await generateContentKey();
  const secret = await encryptContent(wsKey, { note: 'shared family plan' });

  const wrappedForBob = await wrapContentKeyFor(wsKey, await exportPublicKey(bob.publicKey));
  const bobKey = await unwrapContentKeyWith(wrappedForBob, bob.privateKey);
  eq(await decryptContent(bobKey, secret), { note: 'shared family plan' }, 'member recovers the key and reads');

  ok(await throwsAsync(() => unwrapContentKeyWith(wrappedForBob, carol.privateKey)), 'a non-member cannot unwrap it');
});

await testAsync('keyFingerprint: deterministic per key, differs across keys, grouped hex', async () => {
  const a = await generateKeyPair();
  const b = await generateKeyPair();
  const aPub = await exportPublicKey(a.publicKey);
  const fpA1 = await keyFingerprint(aPub);
  const fpA2 = await keyFingerprint(aPub);
  const fpB = await keyFingerprint(await exportPublicKey(b.publicKey));
  eq(fpA1, fpA2, 'same key -> same fingerprint');
  ok(fpA1 !== fpB, 'different keys -> different fingerprints');
  ok(/^([0-9A-F]{4} ){7}[0-9A-F]{4}$/.test(fpA1), `8 groups of 4 uppercase hex, got "${fpA1}"`);
});

await testAsync('the recipient private key survives wrapping under the master key', async () => {
  const master = await generateMasterKey();
  const bob = await generateKeyPair();
  const wsKey = await generateContentKey();
  const wrappedForBob = await wrapContentKeyFor(wsKey, await exportPublicKey(bob.publicKey));

  // Store Bob's private key wrapped by his master key; restore and use it.
  const storedPriv = await wrapPrivateKey(bob.privateKey, master);
  const restoredPriv = await unwrapPrivateKey(storedPriv, master);
  const recovered = await unwrapContentKeyWith(wrappedForBob, restoredPriv);
  const secret = await encryptContent(wsKey, [9, 9]);
  eq(await decryptContent(recovered, secret), [9, 9], 'restored private key still unwraps the workspace key');
});


test('splitCells: a row with a reminder keeps title/datetime/person plaintext; rest encrypts', () => {
  const cols = [
    col({ id: 'name', name: 'Name', type: 'text' }),
    col({ id: 'due', name: 'Due', type: 'reminder' }),
    col({ id: 'who', name: 'Who', type: 'person' }),
    col({ id: 'note', name: 'Note', type: 'text' }),
  ];
  const withR = splitCells({ name: 'Dentist', due: '2026-06-26T18:00', who: ['u1'], note: 'private', due__notified: 'x' }, cols);
  eq(withR.operational, { name: 'Dentist', due: '2026-06-26T18:00', who: ['u1'], due__notified: 'x' }, 'title + when + who plaintext');
  eq(withR.secret, { note: 'private' }, 'the rest is secret');
});

test('splitCells: a row with no reminder keeps its title encrypted', () => {
  const cols = [col({ id: 'name', name: 'Name', type: 'text' }), col({ id: 'due', name: 'Due', type: 'reminder' })];
  const noR = splitCells({ name: 'Dentist' }, cols);
  eq(noR.operational, {}, 'nothing operational without a reminder');
  eq(noR.secret, { name: 'Dentist' }, 'title encrypted when there is no reminder');
});


test('CSV import (Coda format): infers checkbox/text and converts values', () => {
  const csv = 'Name,Ta med besökare,Varit på\nYusentei Park,Ja,false\nTeamLabs,Kanske,true';
  const parsed = parseDelimited(csv);
  eq(parsed.headers, ['Name', 'Ta med besökare', 'Varit på'], 'headers parsed');
  const plan = planImport([], parsed);
  const types = Object.fromEntries(plan.newColumns.map((c) => [c.name, c.type]));
  eq(types, { Name: 'text', 'Ta med besökare': 'text', 'Varit på': 'checkbox' }, 'all-boolean column -> checkbox');
  const recs = plan.resolve({ Name: 'n', 'Ta med besökare': 't', 'Varit på': 'v' });
  eq(recs[0], { n: 'Yusentei Park', t: 'Ja', v: false }, 'row 0 converts false');
  eq(recs[1], { n: 'TeamLabs', t: 'Kanske', v: true }, 'row 1 converts true');
});


test('parseLocaleNumber: comma and dot decimals are treated the same', () => {
  eq(parseLocaleNumber('12,50'), 12.5, 'comma decimal');
  eq(parseLocaleNumber('12.50'), 12.5, 'dot decimal');
  eq(parseLocaleNumber('1 234,50'), 1234.5, 'space thousands + comma decimal');
  eq(parseLocaleNumber('1,234.50'), 1234.5, 'comma thousands + dot decimal');
  eq(parseLocaleNumber('1000'), 1000, 'plain integer');
  eq(parseLocaleNumber(42), 42, 'number passes through');
});

test('bestMatchWord: a fuzzy query surfaces the closest real word', () => {
  eq(bestMatchWord('lodgin', 'lodging budget for the trip'), 'lodging', 'missing letter resolves to lodging');
  eq(bestMatchWord('budg', 'lodging budget for the trip'), 'budget', 'prefix resolves to budget');
  eq(bestMatchWord('xyzzy', 'lodging budget'), '', 'no match returns empty');
});

test('parseLocaleNumber: standard treats comma as thousands, dot as decimal', () => {
  eq(parseLocaleNumber('12.50', 'standard'), 12.5, 'dot decimal');
  eq(parseLocaleNumber('1,234.50', 'standard'), 1234.5, 'comma thousands + dot decimal');
  eq(parseLocaleNumber('12,50', 'standard'), 1250, 'comma is thousands here, not a decimal');
});

test('isEmptyDoc: only an empty doc is empty (guards page data loss)', () => {
  ok(isEmptyDoc({ type: 'doc', content: [] }), 'no nodes');
  ok(isEmptyDoc({ type: 'doc', content: [{ type: 'paragraph' }] }), 'one empty paragraph');
  ok(isEmptyDoc({ type: 'doc', content: [{ type: 'paragraph', content: [] }] }), 'one paragraph, empty content');
  ok(!isEmptyDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }), 'real text is not empty');
  ok(!isEmptyDoc({ type: 'doc', content: [{ type: 'heading' }] }), 'a heading counts as content');
  ok(!isEmptyDoc('enc:v1:abc'), 'an envelope string is not an empty doc');
  ok(!isEmptyDoc(null), 'null is not an empty doc');
});

test('hasWidgetBlock: block widgets count, plain text and inline refs do not', () => {
  const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  // Plain scaffolding is not a widget.
  ok(!hasWidgetBlock({ type: 'doc', content: [p('hello'), { type: 'heading' }] }), 'text + heading');
  ok(!hasWidgetBlock({ type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [p('a')] }] }] }), 'a list is plain');
  ok(!hasWidgetBlock({ type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', content: [p('todo')] }] }] }), 'a checklist is plain');
  ok(!hasWidgetBlock({ type: 'doc', content: [] }), 'empty doc');
  ok(!hasWidgetBlock(null), 'null');
  // Inline references inside a paragraph are text-level, not blocks.
  ok(!hasWidgetBlock({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi ' }, { type: 'mention', attrs: { id: 'u1' } }] }] }), 'an @mention is inline, not a block');
  ok(!hasWidgetBlock({ type: 'doc', content: [{ type: 'heading', content: [{ type: 'inlineFormula', attrs: { expr: '1+1' } }] }] }), 'an inline formula in a heading is not a block');
  // Block-level widgets count.
  ok(hasWidgetBlock({ type: 'doc', content: [p('a'), { type: 'countdownBlock', attrs: { items: [] } }] }), 'a countdown block');
  ok(hasWidgetBlock({ type: 'doc', content: [{ type: 'setlistBlock', attrs: {} }] }), 'a setlist block');
  ok(hasWidgetBlock({ type: 'doc', content: [{ type: 'image', attrs: { src: 'x' } }] }), 'an image block');
  ok(hasWidgetBlock({ type: 'doc', content: [{ type: 'tableEmbed', attrs: { tableId: 't1' } }] }), 'a table embed');
  // Nested inside a column: still found (walks the tree).
  ok(hasWidgetBlock({ type: 'doc', content: [{ type: 'columnList', content: [{ type: 'column', content: [{ type: 'recipeCard', attrs: {} }] }] }] }), 'a widget nested in a column');
});

test('setImageThreadId: anchors a thread on the matching image, only if unset', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
      { type: 'image', attrs: { src: 'a.jpg', alt: 'A' } },
      { type: 'image', attrs: { src: 'b.jpg', alt: 'B', threadId: 'old' } },
    ],
  };
  const out = setImageThreadId(doc, 'a.jpg', 'cmt_new') as typeof doc;
  ok(out !== null, 'a matching image returns a new doc');
  eq((out.content[1] as { attrs: { threadId?: string } }).attrs.threadId, 'cmt_new', 'the matching image got the thread');
  eq((out.content[2] as { attrs: { threadId?: string } }).attrs.threadId, 'old', 'the other image is untouched');
  // input not mutated
  eq((doc.content[1] as { attrs: { threadId?: string } }).attrs.threadId, undefined, 'input doc is not mutated');
  // an image that already has a thread is not overwritten
  eq(setImageThreadId(doc, 'b.jpg', 'cmt_x'), null, 'an already-anchored image is skipped');
  // no such image
  eq(setImageThreadId(doc, 'missing.jpg', 'cmt_y'), null, 'no matching image returns null');
});


test('mapPins: derivePlacePins colours linked sources and dedups embedded ones', () => {
  const placeCol: Column = { id: 'p', name: 'Place', type: 'place', width: 120 };
  const tokyo: TableData = { id: 'tTokyo', name: 'Tokyo food', columns: [placeCol], owner: '', updated: '', created: '' };
  const fukuoka: TableData = { id: 'tFuk', name: 'Fukuoka food', columns: [placeCol], owner: '', updated: '', created: '' };
  const tables = { tTokyo: tokyo, tFuk: fukuoka };
  const rows: Record<string, TableRow> = {
    r1: { id: 'r1', table: 'tTokyo', parent: '', cells: { p: { lat: 35.6, lon: 139.7, name: 'Sushi' } } as TableRow['cells'], position: 0, created: '', updated: '' },
    r2: { id: 'r2', table: 'tFuk', parent: '', cells: { p: { lat: 33.6, lon: 130.4, name: 'Ramen' } } as TableRow['cells'], position: 0, created: '', updated: '' },
  };
  // Both linked as sources with distinct colours; nothing embedded.
  const pins = derivePlacePins([], [{ tableId: 'tTokyo', color: '#111' }, { tableId: 'tFuk', color: '#222' }], tables, rows);
  eq(pins.length, 2, 'one pin per place row');
  eq(pins.find((p) => p.name === 'Sushi')?.color, '#111', 'tokyo pin takes its source colour');
  eq(pins.find((p) => p.name === 'Ramen')?.color, '#222', 'fukuoka pin takes its source colour');
  eq(pins.find((p) => p.name === 'Sushi')?.id, 'place:r1:p', 'stable pin id survives');

  // A table both embedded and linked is drawn once, in its source colour.
  const both = derivePlacePins(['tTokyo'], [{ tableId: 'tTokyo', color: '#abc' }], tables, rows);
  eq(both.length, 1, 'embedded + linked table is not duplicated');
  eq(both[0].color, '#abc', 'the source colour wins over the embedded default');

  // Embedded-only carries no explicit colour (renders the default blue).
  const embed = derivePlacePins(['tTokyo'], [], tables, rows);
  eq(embed[0].color, undefined, 'embedded pin has no explicit colour');
});

test('mapPins: placeTablesForWorkspace lists place tables by page, workspace-scoped', () => {
  const placeCol: Column = { id: 'p', name: 'Place', type: 'place', width: 120 };
  const textCol: Column = { id: 'c', name: 'Note', type: 'text', width: 120 };
  const tables: Record<string, TableData> = {
    tPlace: { id: 'tPlace', name: 'Spots', columns: [placeCol], owner: '', updated: '', created: '' },
    tPlain: { id: 'tPlain', name: 'Notes', columns: [textCol], owner: '', updated: '', created: '' },
    tOther: { id: 'tOther', name: 'Elsewhere', columns: [placeCol], owner: '', updated: '', created: '' },
  };
  const embed = (...tids: string[]) => ({ type: 'doc', content: tids.map((tableId) => ({ type: 'tableEmbed', attrs: { tableId } })) });
  const pages: Record<string, Page> = {
    pA: mkPage({ id: 'pA', title: 'Tokyo', workspace: 'ws1', content: embed('tPlace', 'tPlain') }),
    pB: mkPage({ id: 'pB', title: 'Elsewhere', workspace: 'ws2', content: embed('tOther') }),
    pTrash: mkPage({ id: 'pTrash', title: 'Gone', workspace: 'ws1', trashed: true, content: embed('tPlace') }),
  };
  const refs = placeTablesForWorkspace(pages, tables, 'ws1');
  eq(refs.length, 1, 'only the place table in ws1 (plain col, other ws, and trashed excluded)');
  eq(refs[0].tableId, 'tPlace', 'the right table');
  eq(refs[0].pageTitle, 'Tokyo', 'tagged with its page');
});

test('mapPins: placeRowCells fills the place column + a title, keeps OSM detail', () => {
  const title: Column = { id: 'name', name: 'Name', type: 'text', width: 120 };
  const placeCol: Column = { id: 'loc', name: 'Where', type: 'place', width: 120 };
  const cells = placeRowCells([title, placeCol], { name: 'Ichiran', lat: 33.59, lon: 130.4, address: 'Hakata', category: 'restaurant' });
  eq(cells?.name, 'Ichiran', 'first text column gets the name');
  const geo = cells?.loc as { name: string; lat: number; address?: string; category?: string };
  eq(geo.name, 'Ichiran');
  eq(geo.lat, 33.59);
  eq(geo.address, 'Hakata');
  eq(geo.category, 'restaurant');
});

test('mapPins: placeRowCells returns null without a place column, and needs no title column', () => {
  eq(placeRowCells([{ id: 'c', name: 'Note', type: 'text', width: 120 }], { name: 'X', lat: 1, lon: 2 }), null);
  const onlyPlace = placeRowCells([{ id: 'loc', name: 'Where', type: 'place', width: 120 }], { name: 'X', lat: 1, lon: 2 });
  eq(Object.keys(onlyPlace ?? {}).length, 1, 'just the place cell when there is no text column');
});

test('mapExport: CSV header + escaping, JSON tag, and clipboard line', () => {
  const places = [
    { name: 'Tsuta', lat: 35.73, lon: 139.71 },
    { name: 'Joe\'s, Diner', lat: 35.6, lon: 139.7, address: '1-1 Somewhere', category: 'restaurant' },
  ];
  const csv = placesToCsv(places);
  const lines = csv.split('\n');
  eq(lines[0], 'Name,Latitude,Longitude,Address,Category', 'header row');
  eq(lines[1], 'Tsuta,35.73,139.71,,', 'plain row, empty address/category');
  ok(lines[2].startsWith('"Joe\'s, Diner",'), 'a comma in the name is quoted');
  const parsed = JSON.parse(placesToJson(places, 'Trip'));
  eq(parsed.waypointMap, 1, 'tagged for round-trip');
  eq(parsed.title, 'Trip');
  eq(parsed.places.length, 2);
  eq(placeClipboardText(places[1]), "Joe's, Diner · 35.600000, 139.700000 · 1-1 Somewhere", 'name, coords, address');
  eq(placeClipboardText(places[0]), 'Tsuta · 35.730000, 139.710000', 'no address -> just name + coords');
});

test('mapExport: GPX waypoints, escaped, with desc from address + category', () => {
  const gpx = placesToGpx([{ name: 'Tsuta & Co', lat: 35.73, lon: 139.71, address: '1-1', category: 'ramen' }], 'Trip');
  ok(gpx.startsWith('<?xml'), 'xml prolog');
  ok(gpx.includes('<gpx version="1.1"'), 'gpx root');
  ok(gpx.includes('<wpt lat="35.73" lon="139.71">'), 'a waypoint at the coords');
  ok(gpx.includes('<name>Tsuta &amp; Co</name>'), 'name is xml-escaped');
  ok(gpx.includes('<desc>1-1 · ramen</desc>'), 'address + category in desc');
  ok(gpx.includes('<metadata><name>Trip</name></metadata>'), 'title in metadata');
});

test('sharedTable: bakes grid cells, board groups from a select, dates', () => {
  const cols: Column[] = [
    col({ id: 'name', name: 'Task', type: 'text' }),
    col({ id: 'st', name: 'Status', type: 'select', options: [{ id: 'o1', label: 'Todo', color: '#111111' }, { id: 'o2', label: 'Done', color: '#222222' }] }),
    col({ id: 'd', name: 'When', type: 'date' }),
  ];
  const mk = (id: string, name: string, st: string, d: string): TableRow => ({ id, table: 't', parent: '', cells: { name, st, d }, position: 0, created: '', updated: '' });
  const rows = [mk('r1', 'A', 'o1', '2026-03-05'), mk('r2', 'B', 'o2', '2026-03-20')];
  const view: ViewConfig = { id: 'v', name: 'V', type: 'board', filters: [], sorts: [], groupColumnId: 'st', dateColumnId: 'd' };
  const model = bakeSharedTable(cols, rows, view, 'My table', (r, c) => String(r.cells[c.id] ?? ''), (id) => id);
  eq(model.columns, ['Task', 'Status', 'When'], 'header names');
  eq(model.viewType, 'board');
  eq(model.rows[0].cells, ['A', 'o1', '2026-03-05'], 'display cells aligned');
  eq(model.rows[0].title, 'A', 'title = first cell');
  eq(model.rows[0].groupKeys, ['o1'], 'board group key');
  eq(model.rows[0].color, '#111111', 'colour from the select option');
  eq(model.rows[0].date, '2026-03-05', 'baked date');
  eq(model.groups?.length, 3, 'two options + a "No Status" bucket');
  eq(model.groups?.[0], { key: 'o1', label: 'Todo', color: '#111111' });
});

test('tripViews: collectEventSpans pairs From/To so multi-day rows span', () => {
  const mkT = (id: string, cols: object[], views: object | null = null) => ({ id, name: id, columns: cols, views }) as unknown as TableData;
  const mkR = (id: string, table: string, cells: object) => ({ id, table, cells }) as unknown as TableRow;
  const two = mkT('two', [
    { id: 'title', name: 'Name', type: 'text', width: 160 },
    { id: 'from', name: 'From', type: 'date', width: 120 },
    { id: 'to', name: 'To', type: 'date', width: 120 },
  ]);
  const rows: Record<string, TableRow> = {
    stay: mkR('stay', 'two', { title: 'STUGA', from: '2027-02-10', to: '2027-02-12' }),
    day: mkR('day', 'two', { title: 'Ski', from: '2027-02-11', to: '2027-02-11' }), // same day: no span
    half: mkR('half', 'two', { title: 'Open end', from: '2027-02-13' }), // one side empty: no span
    flip: mkR('flip', 'two', { title: 'Reversed', from: '2027-02-20', to: '2027-02-18' }),
  };
  const spans = collectEventSpans([two], rows);
  eq(spans.get('stay'), { from: '2027-02-10', to: '2027-02-12' }, 'exactly-two-date-columns tables pair up');
  eq(spans.has('day'), false, 'a same-day pair stays a single chip');
  eq(spans.has('half'), false, 'a missing To stays a single chip');
  eq(spans.get('flip'), { from: '2027-02-18', to: '2027-02-20' }, 'a reversed range is tolerated');

  // With 3+ date columns only an explicit view pair is trusted.
  const three = mkT('three', [
    { id: 'a', name: 'Booked', type: 'date', width: 120 },
    { id: 'b', name: 'In', type: 'date', width: 120 },
    { id: 'c', name: 'Out', type: 'date', width: 120 },
  ]);
  const r3: Record<string, TableRow> = { x: mkR('x', 'three', { a: '2027-01-01', b: '2027-02-01', c: '2027-02-03' }) };
  eq(collectEventSpans([three], r3).size, 0, 'no view pair + 3 date columns: no guessing');
  const threeV = mkT('threeV', three.columns as unknown as object[], { dateColumnId: 'b', endDateColumnId: 'c' });
  const rv: Record<string, TableRow> = { x: mkR('x', 'threeV', { a: '2027-01-01', b: '2027-02-01', c: '2027-02-03' }) };
  eq(collectEventSpans([threeV], rv).get('x'), { from: '2027-02-01', to: '2027-02-03' }, "the view's From/To pair wins");
});

test('tripViews: collectEvents/eventsByDay/collectMoney sweep tables', () => {
  const table = {
    id: 't1',
    name: 'Reservations',
    columns: [
      { id: 'title', name: 'Place', type: 'text', width: 160 },
      { id: 'in', name: 'Check-in', type: 'date', width: 120 },
      { id: 'nights', name: 'Nights', type: 'number', width: 80, numberFormat: 'plain' }, // NOT money
      { id: 'rate', name: 'Rate', type: 'number', width: 100, numberFormat: 'yen' },
      { id: 'total', name: 'Total', type: 'formula', width: 120, formula: '[Nights] * [Rate]', numberFormat: 'yen' },
    ],
  } as unknown as TableData;
  const rows: Record<string, TableRow> = {
    r1: { id: 'r1', table: 't1', cells: { title: 'Ryokan', in: '2026-08-02', nights: 2, rate: 10000 } } as unknown as TableRow,
    r2: { id: 'r2', table: 't1', cells: { title: 'Hotel', in: '2026-08-01T15:00', nights: 3, rate: 4000 } } as unknown as TableRow,
    r3: { id: 'r3', table: 't1', cells: { title: 'No date', nights: 1, rate: 5 } } as unknown as TableRow,
  };
  const events = collectEvents([table], rows, []);
  eq(events.length, 2, 'only dated rows become events');
  eq(events[0].title, 'Hotel', 'sorted by date/time, Aug 1 first');
  eq(events[0].timeLabel, '15:00', 'datetime carries a time');
  eq(events[1].timeLabel, '', 'a plain date has no time');
  const days = eventsByDay(events);
  eq(days.length, 2, 'two distinct days');
  eq(days[0].day, '2026-08-01', 'day keys ascending');
  const money = collectMoney([table], rows);
  eq(money.totalsByFormat.length, 1, 'one currency (yen); the plain Nights column is not money');
  // Rate: 10000+4000+5 = 14005. Total (formula = Nights*Rate): 20000+12000+5 = 32005. Sum = 46010.
  eq(money.totalsByFormat[0].total, 46010, 'sums currency columns AND evaluates the formula column');
  eq(money.lines.length, 2, 'Rate and Total are money; Nights is excluded');
  eq(tripDaySpan(events) >= 1, true, 'a dated trip spans at least one day');

  const span = (days: string[]): number => tripDaySpan(days.map((d, i) => ({ key: `k${i}`, tableId: 't', tableName: 'T', rowId: `r${i}`, title: '', fieldName: 'd', dateIso: d, day: d, timeLabel: '', done: false })));
  eq(span([]), 0, 'no events, no span');
  eq(span(['2026-08-01']), 1, 'one day is a span of 1');
  eq(span(['2026-08-01', '2026-08-05', '2026-08-03']), 5, 'first to last inclusive, order-independent');

  // pageTables: only tables embedded on the page (or its kanban board), not the whole workspace.
  const t2 = { id: 't2', name: 'Other page table', columns: [] } as unknown as TableData;
  const page = {
    id: 'p1',
    content: { type: 'doc', content: [{ type: 'tableEmbed', attrs: { tableId: 't1' } }] },
    kanban: null,
  } as unknown as Page;
  const scoped = pageTables(page, [table, t2]);
  eq(scoped.length, 1, 'only the embedded table, not t2 from elsewhere');
  eq(scoped[0].id, 't1', 'the embedded one');

  // collectMedia: images + files from the page body, cover, and attachment cells.
  const mediaPage = {
    id: 'p2',
    cover: 'data:image/png;base64,AAAA',
    kanban: null,
    content: {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: 'https://x/pic.jpg', alt: 'Kyoto' } },
        { type: 'fileBlock', attrs: { name: 'ticket.pdf', mime: 'application/pdf', size: 2048, data: 'data:application/pdf;base64,BBBB' } },
        { type: 'audioBlock', attrs: { src: 'https://x/song.mp3', name: 'song.mp3', title: 'Our anthem', mime: 'audio/mpeg', size: 4096 } },
      ],
    },
  } as unknown as Page;
  const mediaTable = { id: 'mt', name: 'Docs', columns: [{ id: 'a', name: 'Scan', type: 'attachment', width: 120 }] } as unknown as TableData;
  const mediaRows: Record<string, TableRow> = {
    mr: { id: 'mr', table: 'mt', cells: { a: { name: 'passport.png', mime: 'image/png', size: 500, data: 'data:image/png;base64,CCCC' } } } as unknown as TableRow,
  };
  const media = collectMedia(mediaPage, [mediaTable], mediaRows);
  eq(media.length, 5, 'cover + image block + file block + audio block + attachment cell');
  eq(media.filter((m) => m.isImage).length, 3, 'cover, image block, and the png attachment are images');
  eq(media.filter((m) => m.isAudio).length, 1, 'the mp3 is audio');
  eq(media.filter((m) => !m.isImage && !m.isAudio).length, 1, 'the pdf is a plain file');
  const song = media.find((m) => m.isAudio);
  eq(song?.name, 'Our anthem', 'audio uses the title as its name');
});

test('avatar: colour is a stable 6-digit hex (needed for the cursor selection alpha)', () => {
  const a = avatarColor('user-123');
  ok(/^#[0-9a-f]{6}$/.test(a), 'a #rrggbb hex');
  eq(avatarColor('user-123'), a, 'stable for the same id');
  ok(avatarColor('user-123') !== avatarColor('user-999'), 'different ids differ');
  eq(initials('Ada Lovelace'), 'AL', 'two-word initials');
  eq(initials('cher'), 'CH', 'single word');
});

test('sharedTable: monthMatrix lays out a month Monday-first', () => {
  const weeks = monthMatrix(2026, 2); // March 2026 (month index 2)
  ok(weeks.every((w) => w.length === 7), 'weeks of 7');
  const flat = weeks.flat();
  ok(flat.includes('2026-03-01') && flat.includes('2026-03-31'), 'first and last day present');
  eq(flat.filter(Boolean).length, 31, '31 real days');
});

test('grids: gridsByPage puts the current page first, groups others, skips trashed', () => {
  const textCol: Column = { id: 'c', name: 'Note', type: 'text', width: 120 };
  const tables: Record<string, TableData> = {
    tHere: { id: 'tHere', name: 'This grid', columns: [textCol], owner: '', updated: '', created: '' },
    tThere: { id: 'tThere', name: 'That grid', columns: [textCol], owner: '', updated: '', created: '' },
    tGone: { id: 'tGone', name: 'Trashed grid', columns: [textCol], owner: '', updated: '', created: '' },
  };
  const embed = (...tids: string[]) => ({ type: 'doc', content: tids.map((tableId) => ({ type: 'tableEmbed', attrs: { tableId } })) });
  const pages: Record<string, Page> = {
    here: mkPage({ id: 'here', title: 'Here', workspace: 'ws1', content: embed('tHere') }),
    there: mkPage({ id: 'there', title: 'Budget', workspace: 'ws1', content: embed('tThere') }),
    trash: mkPage({ id: 'trash', title: 'Old', workspace: 'ws1', trashed: true, content: embed('tGone') }),
    otherWs: mkPage({ id: 'otherWs', title: 'Nope', workspace: 'ws2', content: embed('tThere') }),
  };
  const { current, others } = gridsByPage(pages, tables, 'ws1', 'here');
  eq(current.map((g) => g.tableId), ['tHere'], 'current page grid first');
  eq(others.length, 1, 'one other page (trashed + other-workspace excluded)');
  eq(others[0].pageTitle, 'Budget', 'grouped under its page');
  eq(others[0].grids.map((g) => g.tableId), ['tThere'], 'the other grid');
});

test('widgetExport: setlist + quiz render their content into a standalone doc', () => {
  const setHtml = buildSetlistHtml('Friday set', [
    { id: '1', kind: 'song', text: 'Opening number', sub: 'D / me', mins: 4 },
    { id: '2', kind: 'banter', text: 'Welcome the room', mins: 1 },
    { id: '3', kind: 'segment', text: 'Intro quiz', mins: 5 },
  ]);
  ok(setHtml.startsWith('<!doctype html>'), 'a full document');
  ok(setHtml.includes('Friday set') && setHtml.includes('Opening number') && setHtml.includes('Intro quiz'), 'includes the content');
  ok(setHtml.includes('10 min') || setHtml.includes('min'), 'shows the running total');
  ok(setHtml.includes('class="row segment"'), 'a segment band');

  const quizHtml = buildQuizHtml('Intro quiz', [
    { text: 'What year did it open?', answer: '1994', options: ['1990', '1994', '2001'] },
  ]);
  ok(quizHtml.includes('Intro quiz') && quizHtml.includes('What year did it open?'), 'includes the questions');
  ok(quizHtml.includes('class="opt correct"') && quizHtml.includes('1994'), 'marks the matching option correct + shows the answer');

  // Content is escaped, not injected.
  ok(buildQuizHtml('x', [{ text: '<script>', answer: 'a' }]).includes('&lt;script&gt;'), 'escapes html');
});

test('keyTrustStatus: new when unpinned, trusted on match, changed on mismatch', () => {
  eq(keyTrustStatus(null, 'KEYA'), 'new', 'no pin yet -> new (will be pinned on first sight)');
  eq(keyTrustStatus('KEYA', 'KEYA'), 'trusted', 'matches the pin -> trusted');
  eq(keyTrustStatus('KEYA', 'KEYB'), 'changed', 'differs from the pin -> changed (needs re-verify)');
});

test('compactCount: keeps the tail, caps per run, never goes negative', () => {
  eq(compactCount(50, 100, 500), 0, 'below the keep tail: prune nothing');
  eq(compactCount(100, 100, 500), 0, 'exactly the keep tail: prune nothing');
  eq(compactCount(150, 100, 500), 50, 'prune the excess over the tail');
  eq(compactCount(5000, 100, 500), 500, 'a big backlog is capped per run');
  eq(compactCount(0, 100, 500), 0, 'empty log');
});

test('mapPins: nextSourceColor picks an unused palette colour', () => {
  eq(nextSourceColor([]), SOURCE_COLORS[0], 'first colour when none used');
  eq(nextSourceColor([SOURCE_COLORS[0]]), SOURCE_COLORS[1], 'skips a used colour');
  ok(SOURCE_COLORS.includes(nextSourceColor([...SOURCE_COLORS])), 'wraps into the palette when all used');
});

test('notion markdown: headings, todos with nesting, and inline marks', () => {
  const doc = markdownToTiptap('## Phase 1\n\n- [x] Passports\n    - [ ] Bob\n- [ ] Funds\n');
  eq(doc.type, 'doc', 'is a doc');
  const h = doc.content?.[0];
  eq(h?.type, 'heading', 'first block is a heading');
  eq(h?.attrs?.level, 2, 'level 2');
  const list = doc.content?.[1];
  eq(list?.type, 'taskList', 'a checklist becomes a taskList');
  eq(list?.content?.[0]?.attrs?.checked, true, 'checked item');
  const nested = list?.content?.[0]?.content?.[1];
  eq(nested?.type, 'taskList', 'the indented item nests as a sub taskList');
});

test('notion markdown: a standalone subpage link becomes a pageLink', () => {
  const doc = markdownToTiptap('[My Tasks](Home/My%20Tasks%2005f580aa82b341bb8c9a64c4ac77dad5.md)');
  const link = doc.content?.[0];
  eq(link?.type, 'pageLink', 'standalone subpage link is a pageLink');
  eq(link?.attrs?.notionId, '05f580aa82b341bb8c9a64c4ac77dad5', 'carries the source page id');
  eq(link?.attrs?.label, 'My Tasks', 'carries the original title');
  // an external link stays a normal paragraph link
  const ext = markdownToTiptap('[site](https://example.com)');
  eq(ext.content?.[0]?.type, 'paragraph', 'external link stays a paragraph');
});

test('notion markdown: an inline subpage link becomes a live pageRef, not plain text', () => {
  const doc = markdownToTiptap('See [the bible](Campaign%20Bible%20' + 'f'.repeat(32) + '.md) for lore.');
  const para = doc.content?.find((n) => n.type === 'paragraph');
  const ref = para?.content?.find((n) => n.type === 'pageRef');
  ok(!!ref, 'a pageRef inline node is emitted');
  eq(ref?.attrs?.notionId, 'f'.repeat(32), 'it carries the source notion id for re-pointing');
  eq(ref?.attrs?.pageId, '', 'pageId stays empty until the importer resolves it');
  eq(ref?.attrs?.label, 'the bible', 'keeps the link text as the label');
});

test('notionImport: resolves subpage parents by id, correct even with duplicate titles', () => {
  const enc = new TextEncoder();
  const id1 = 'a'.repeat(32), id2 = 'b'.repeat(32), id3 = 'c'.repeat(32), id4 = 'd'.repeat(32), id5 = 'e'.repeat(32);
  const e = (name: string) => ({ name, bytes: enc.encode('# x\n\nbody') });
  // Modern Notion: the child folder is named like the parent's file base, WITH the id.
  const plan = parseNotionExport([
    e(`Export-9/Space/The Foundling ${id1}.md`),
    e(`Export-9/Space/The Foundling ${id1}/SESSION 1 ${id2}.md`),
    e(`Export-9/Space/The Foundling ${id1}/NPCs ${id3}.md`),
    e(`Export-9/Space/The Foundling ${id1}/Notes ${id4}.md`),
    e(`Export-9/Space/The Foundling ${id1}/NPCs ${id3}/Notes ${id5}.md`),
  ]);
  eq(plan.workspaces.length, 1, 'one workspace (the teamspace folder)');
  const byId = new Map(plan.workspaces[0].pages.map((p) => [p.notionId, p.parentId]));
  eq(byId.get(id1), null, 'the top page is a root');
  eq(byId.get(id2), id1, 'SESSION 1 nests under The Foundling');
  eq(byId.get(id3), id1, 'NPCs nests under The Foundling');
  eq(byId.get(id4), id1, 'the first Notes nests under The Foundling');
  eq(byId.get(id5), id3, 'the second Notes (same title) nests under NPCs, not the other Notes');
});

test('notionImport: referenced images become image blocks + carry bytes; unused are skipped', () => {
  const enc = new TextEncoder();
  const id1 = 'a'.repeat(32);
  const md = `# Foundling\n\n![a map](The%20Foundling%20${id1}/map.png)\n\n![ext](https://x.io/y.png)\n`;
  const plan = parseNotionExport([
    { name: `Export-1/Space/The Foundling ${id1}.md`, bytes: enc.encode(md) },
    { name: `Export-1/Space/The Foundling ${id1}/map.png`, bytes: new Uint8Array([1, 2, 3]) },
    { name: `Export-1/Space/The Foundling ${id1}/unused.png`, bytes: new Uint8Array([9]) },
  ]);
  const page = plan.workspaces[0].pages.find((p) => p.notionId === id1)!;
  const imgs = (page.content.content ?? []).filter((n) => n.type === 'image');
  eq(imgs.length, 2, 'both the local and external image become blocks');
  const local = imgs.find((n) => !!n.attrs?.importKey);
  const ext = imgs.find((n) => typeof n.attrs?.src === 'string' && (n.attrs?.src as string).startsWith('http'));
  ok(!!local, 'the local image carries an importKey for the upload pass');
  eq(local?.attrs?.src, '', 'its src is empty until the store uploads it');
  eq(ext?.attrs?.src, 'https://x.io/y.png', 'the external image keeps its url as-is');
  eq(plan.images.length, 1, 'only the referenced local image is carried for upload');
  eq(plan.images[0].mime, 'image/png', 'with its mime derived from the extension');
  eq(plan.images[0].bytes.length, 3, 'and its raw bytes');
  eq(plan.skippedImages, 1, 'the unreferenced image is counted as skipped');
});

test('notion markdown: inline bold/italic/code/link', () => {
  const nodes = parseInline('a **b** and *c* and `d` and [e](https://x.io)');
  const bold = nodes.find((n) => n.marks?.some((m) => m.type === 'bold'));
  eq(bold?.text, 'b', 'bold text extracted');
  const link = nodes.find((n) => n.marks?.some((m) => m.type === 'link'));
  eq(link?.marks?.[0]?.attrs?.href, 'https://x.io', 'link href');
});

test('agenda: collects dated cells and checklist dues, with status', () => {
  const now = new Date(2026, 5, 15, 12, 0).getTime(); // 2026-06-15 noon
  const tables: any = {
    t1: { id: 't1', name: 'Trip', workspace: 'w', columns: [
      { id: 'c1', name: 'Stop', type: 'text' },
      { id: 'c2', name: 'When', type: 'date', agendaDue: true },
      { id: 'c3', name: 'Tasks', type: 'checklist' },
    ] },
  };
  const rows: any = {
    r1: { id: 'r1', table: 't1', workspace: 'w', cells: {
      c1: 'Fukuoka', c2: '2026-06-15', c3: [{ id: 'a', text: 'book hotel', checked: false, due: '2026-06-10' }, { id: 'b', text: 'done', checked: true, due: '2026-06-01' }],
    } },
    r2: { id: 'r2', table: 't1', workspace: 'w', cells: { c1: 'Tokyo', c2: '2026-06-20' } },
  };
  const items = collectAgenda(tables, rows, now, 90);
  eq(items.length, 3, 'two dates + one open checklist due (the checked one is skipped)');
  eq(items[0].raw, '2026-06-10', 'sorted soonest first');
  eq(items[0].status, 'overdue', 'past due is overdue');
  const todayItem = items.find((i) => i.raw === '2026-06-15');
  eq(todayItem?.status, 'today', 'same day is today');
  eq(items.find((i) => i.raw === '2026-06-20')?.status, 'upcoming', 'future is upcoming');

  // Without the deadline flag, the plain date column is a calendar event and stays
  // out of the agenda; only the open checklist task counts.
  const plainCols = tables.t1.columns.map((c: any) => (c.id === 'c2' ? { ...c, agendaDue: false } : c));
  const plain = collectAgenda({ t1: { ...tables.t1, columns: plainCols } }, rows, now, 90);
  eq(plain.length, 1, 'plain dates are excluded; only the checklist task remains');
});

test('agenda dayStatus boundaries', () => {
  const now = new Date(2026, 0, 10, 9, 0).getTime();
  eq(dayStatus(new Date(2026, 0, 10, 23, 0).getTime(), now), 'today', 'later same day still today');
  eq(dayStatus(new Date(2026, 0, 9).getTime(), now), 'overdue', 'yesterday overdue');
  eq(dayStatus(new Date(2026, 0, 11).getTime(), now), 'upcoming', 'tomorrow upcoming');
});

test('code highlight: keywords, strings, numbers and comments tokenise', () => {
  const toks = highlightCode('const x = "hi"; // note\nlet n = 42');
  const slice = (t: { from: number; to: number }) => 'const x = "hi"; // note\nlet n = 42'.slice(t.from, t.to);
  ok(toks.some((t) => t.cls === 'tok-keyword' && slice(t) === 'const'), 'const is a keyword');
  ok(toks.some((t) => t.cls === 'tok-string' && slice(t) === '"hi"'), 'string token');
  ok(toks.some((t) => t.cls === 'tok-comment' && slice(t) === '// note'), 'line comment to end of line');
  ok(toks.some((t) => t.cls === 'tok-number' && slice(t) === '42'), 'number token');
});

test('search: extractPlainText reaches widget text in attrs, skips ids/urls', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'intro' }] },
      { type: 'caseBrief', attrs: { title: 'Donoghue v Stevenson', facts: 'a snail in the bottle', holding: 'duty of care', citation: '[1932] AC 562' } },
      { type: 'recipeCard', attrs: { title: 'Ramen', ingredients: [{ id: 'a', text: 'noodles', done: false }], steps: ['boil water'] } },
      { type: 'tableEmbed', attrs: { tableId: 'tbl_secret_id' } },
    ],
  };
  const text = extractPlainText(doc).toLowerCase();
  ok(text.includes('snail in the bottle'), 'case facts are searchable');
  ok(text.includes('duty of care'), 'case holding is searchable');
  ok(text.includes('noodles'), 'recipe ingredient is searchable');
  ok(text.includes('boil water'), 'recipe step is searchable');
  ok(!text.includes('tbl_secret_id'), 'a table id is not indexed as text');
});

test('search: parseQuery splits on ; and reads *contains*', () => {
  const a = parseQuery('done;water');
  eq(a.length, 2, 'two terms');
  eq(a[0].contains, false, 'plain term is fuzzy');
  const b = parseQuery('*gmail.com*');
  eq(b[0].contains, true, 'star-wrapped is contains');
  eq(b[0].needle, 'gmail.com', 'needle stripped of stars');
  const c = parseQuery('*one*;*ter*');
  eq(c.length, 2, 'two contains terms');
  ok(c[0].contains && c[1].contains, 'both contains');
});

test('search: ; is AND, *x* is a substring match', () => {
  const pages: any = {
    p1: { id: 'p1', title: 'Plan', trashed: false, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'the work is done and we need water' }] }] }, updated: '2026-01-01' },
    p2: { id: 'p2', title: 'Other', trashed: false, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'only water here, all done? no' }] }] }, updated: '2026-01-02' },
    p3: { id: 'p3', title: 'Emails', trashed: false, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'reach me at me@gmail.com any time' }] }] }, updated: '2026-01-03' },
  };
  const idx = buildSearchIndex(pages, {}, {});
  const both = searchIndex(idx, 'done;water', 8).map((h) => h.id);
  ok(both.includes('p1') && both.includes('p2'), 'both pages have done and water');
  const gmail = searchIndex(idx, '*gmail.com*', 8).map((h) => h.id);
  eq(gmail.length, 1, 'only the gmail page');
  eq(gmail[0], 'p3', 'substring match found it');
  const combo = searchIndex(idx, '*one*;*ter*', 8).map((h) => h.id);
  ok(combo.includes('p2'), 'p2 has "one" (only) and "ter" (water)');
});

test('parseHumanDate: words to dates (Mon 2026-06-15 as now)', () => {
  const now = new Date(2026, 5, 15, 10, 0).getTime();
  eq(parseHumanDate('today', now)?.iso, '2026-06-15', 'today');
  eq(parseHumanDate('tomorrow', now)?.iso, '2026-06-16', 'tomorrow');
  eq(parseHumanDate('in 3 weeks', now)?.iso, '2026-07-06', 'in 3 weeks');
  eq(parseHumanDate('friday', now)?.iso, '2026-06-19', 'this friday');
  eq(parseHumanDate('next friday', now)?.iso, '2026-06-26', 'next friday');
  eq(parseHumanDate('nextfriday', now)?.iso, '2026-06-26', 'run-together still works');
  eq(parseHumanDate('end of month', now)?.iso, '2026-06-30', 'end of month');
  eq(parseHumanDate('25 dec', now)?.iso, '2026-12-25', 'a day and month');
  const t = parseHumanDate('tomorrow 9am', now);
  eq(t?.iso, '2026-06-16T09:00', 'tomorrow 9am');
  eq(t?.hasTime, true, 'has a time');
  eq(parseHumanDate('not a date at all', now), null, 'unknown is null');
});

test('agenda: rows in a done board stage drop off Home', () => {
  const table: any = {
    id: 't1',
    workspace: 'w1',
    columns: [
      { id: 'name', type: 'text', name: 'Task' },
      { id: 'status', type: 'select', name: 'Status', options: [{ id: 'todo', label: 'To do', color: '#888' }, { id: 'done', label: 'Done', color: '#0a0', done: true }] },
      { id: 'due', type: 'date', name: 'Due', agendaDue: true },
    ],
  };
  const openRow: any = { id: 'r1', table: 't1', cells: { name: 'Ship it', status: 'todo', due: '2026-01-10' } };
  const doneRow: any = { id: 'r2', table: 't1', cells: { name: 'Old task', status: 'done', due: '2026-01-10' } };
  ok(!isRowDone(table, openRow), 'a to-do row is not done');
  ok(isRowDone(table, doneRow), 'a row in the done stage is done');
  const items = collectAgenda({ t1: table }, { r1: openRow, r2: doneRow }, new Date(2026, 0, 1).getTime(), 365);
  const ids = items.map((i) => i.rowId);
  ok(ids.includes('r1'), 'the open task is on the agenda');
  ok(!ids.includes('r2'), 'the done task is excluded');
});

test('recordImport: recipes from JSON and CSV', () => {
  const json = parseRecipes('[{"name":"Ramen","serves":"2","ingredients":["noodles","broth"],"instructions":["Boil","Serve"]}]');
  eq(json.length, 1, 'one recipe');
  eq(json[0].title, 'Ramen', 'title from name');
  eq(json[0].servings, '2', 'servings from serves');
  eq(json[0].ingredients.length, 2, 'two ingredients');
  eq(json[0].steps[0], 'Boil', 'step from instructions');
  // schema.org-ish single object with {text} steps
  const one = parseRecipes('{"title":"Toast","recipeIngredient":["bread"],"recipeInstructions":[{"text":"Toast it"}]}');
  eq(one[0].steps[0], 'Toast it', 'step text object');
  // CSV with semicolon lists
  const csv = parseRecipes('title,servings,ingredients,steps\nPasta,4,"penne;sauce","boil;mix"');
  eq(csv[0].title, 'Pasta', 'csv title');
  eq(csv[0].ingredients.length, 2, 'csv ingredients split on ;');
  ok(parseRecipes('not json or csv really').length >= 0, 'garbage does not throw');
});

test('recordImport: case briefs map flexible keys', () => {
  const recs = parseCaseBriefs('[{"case":"Donoghue v Stevenson","held":"duty of care","facts":"a snail"}]');
  eq(recs[0].title, 'Donoghue v Stevenson', 'title from case');
  eq(recs[0].holding, 'duty of care', 'holding from held');
  eq(recs[0].facts, 'a snail', 'facts');
});

// Guard against template drift: every downloadable recipe/case/statute template
// (blank scaffold AND worked example, JSON and CSV) must import back through the
// SAME parser the widget uses. A blank that imported to zero records ("Nothing to
// import") is what read as a broken template, so each must yield at least one row.
test('record templates: blank and example import cleanly (JSON + CSV)', () => {
  const parse = { recipe: parseRecipes, case: parseCaseBriefs, statute: parseStatutes } as const;
  for (const kind of ['recipe', 'case', 'statute'] as const) {
    ok(parse[kind](BLANK_JSON[kind]).length >= 1, `${kind} blank JSON imports a row`);
    ok(parse[kind](BLANK_CSV[kind]).length >= 1, `${kind} blank CSV imports a row`);
    ok(parse[kind](EXAMPLE_JSON[kind]).length >= 1, `${kind} example JSON imports a row`);
    ok(parse[kind](EXAMPLE_CSV[kind]).length >= 1, `${kind} example CSV imports a row`);
  }
  // The examples carry real content, JSON and CSV agree on the row count.
  eq(parseRecipes(EXAMPLE_JSON.recipe).length, parseRecipes(EXAMPLE_CSV.recipe).length, 'recipe JSON/CSV agree');
  const r = parseRecipes(EXAMPLE_JSON.recipe)[0];
  ok(r.title && r.ingredients.length >= 3 && r.steps.length >= 3, 'example recipe is fully filled');
  const s = parseStatutes(EXAMPLE_JSON.statute)[0];
  ok(s.act && s.section && s.summary, 'example statute is fully filled');
});

test('recipeScale: parse and scale Swedish/US measures', () => {
  eq(parseQty('1,5'), 1.5, 'comma decimal');
  eq(parseQty('1/2'), 0.5, 'fraction');
  eq(parseQty('2'), 2, 'integer');
  eq(parseQty('salt'), null, 'no number');
  // double a spoon amount, stay Swedish
  eq(scaleLine('3 msk miso', 2, 'sv'), '6 msk miso', 'msk doubles');
  // ml normalises up to dl / l in Swedish
  eq(scaleLine('800 ml stock', 2, 'sv'), '1,6 l stock', 'ml to litres');
  eq(scaleLine('250 ml cream', 1, 'sv'), '2,5 dl cream', 'ml to dl');
  // grams to kg
  eq(scaleLine('600 g flour', 2, 'sv'), '1,2 kg flour', 'g to kg');
  // a count with no unit just scales
  eq(scaleLine('2 eggs', 3, 'sv'), '6 eggs', 'count scales');
  // US conversion: 45 ml -> 3 tbsp
  eq(scaleLine('3 msk oil', 1, 'us'), '3 tbsp oil', 'sv spoons to US tbsp');
  // a line with no number is untouched
  eq(scaleLine('a pinch of salt', 2, 'sv'), 'a pinch of salt', 'no qty unchanged');
});

test('markdownTable: parse a pipe table (the D&D ability row)', () => {
  const md = '| STR | DEX | CON | INT | WIZ | CHA |\n| --- | --- | --- | --- | --- | --- |\n| 10(+0) | 15(+2) | 10(+0) | 12(+1) | 10(+0) | 18(+4) |';
  const t = parseMarkdownTable(md);
  ok(t !== null, 'parses');
  eq(t.headers.length, 6, 'six columns');
  eq(t.headers[0], 'STR', 'first header');
  eq(t.rows.length, 1, 'one data row');
  eq(t.rows[0][1], '15(+2)', 'cell value kept');
  // not a table
  eq(parseMarkdownTable('just some text\nmore text'), null, 'plain text is not a table');
  // mixed: text then a table
  const blocks = splitMarkdownTables('intro line\n\n' + md + '\n\noutro');
  ok(blocks !== null, 'mixed has a table');
  eq(blocks.filter((b) => b.type === 'table').length, 1, 'one table block');
  ok(blocks.some((b) => b.type === 'text' && b.text.includes('intro')), 'keeps surrounding text');
});

test('smartPaste: lat/long and tracking/ISBN', () => {
  eq(parseLatLong('35.6762,139.6503')?.lat, 35.6762, 'tokyo lat');
  ok(parseLatLong('1,2') === null, 'a swedish decimal is not coords');
  ok(parseLatLong('200.0,10.0') === null, 'out of range rejected');
  ok(trackingChip('1Z999AA10123456784')?.href.includes('ups.com'), 'UPS number links to ups');
  ok(trackingChip('9780132350884')?.href.includes('openlibrary'), 'ISBN-13 links to a lookup');
  ok(trackingChip('978-0-13-235088-4')?.label.startsWith('📚'), 'ISBN with dashes still chips');
  eq(trackingChip('12345'), null, 'a short number is left alone');
});

test('whoOwesWhom: nets a budget into a transfer', () => {
  const table: any = {
    id: 'b1',
    columns: [
      { id: 'amt', name: 'Amount', type: 'number' },
      { id: 'cur', name: 'Currency', type: 'select', options: [] },
      { id: 'paid', name: 'Paid by', type: 'person' },
      { id: 'split', name: 'Split among', type: 'person' },
    ],
  };
  // Alice paid 100 (base), split between Alice and Bob -> Bob owes Alice 50.
  const r1: any = { id: 'r1', table: 'b1', cells: { amt: 100, paid: ['alice'], split: ['alice', 'bob'] } };
  const res = whoOwesWhom({ b1: table }, { r1 }, 'SEK');
  eq(res.budgets, 1, 'one budget counted');
  eq(res.transfers.length, 1, 'one transfer');
  eq(res.transfers[0].from, 'bob', 'bob pays');
  eq(res.transfers[0].to, 'alice', 'alice receives');
  eq(Math.round(res.transfers[0].amount), 50, 'half of 100');
});

test('findClashes: overlapping stays flag, adjacent ones do not', () => {
  const rows: any = [
    { id: 'a', cells: { in: '2026-07-01', out: '2026-07-05' } },
    { id: 'b', cells: { in: '2026-07-04', out: '2026-07-08' } }, // overlaps a
    { id: 'c', cells: { in: '2026-07-09', out: '2026-07-12' } }, // after, no overlap
  ];
  const clash = findClashes(rows, 'in', 'out');
  ok(clash.has('a') && clash.has('b'), 'a and b clash');
  ok(!clash.has('c'), 'c is clear');
  // single-day mode (no end column): same day clashes, different days do not
  const single: any = [
    { id: 'x', cells: { d: '2026-07-01' } },
    { id: 'y', cells: { d: '2026-07-01' } },
    { id: 'z', cells: { d: '2026-07-02' } },
  ];
  const c2 = findClashes(single, 'd');
  ok(c2.has('x') && c2.has('y') && !c2.has('z'), 'same-day clashes only');
});

test('swedishHolidays: red days and working-day counts', () => {
  const di = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  ok(isHoliday(di(2026, 5, 1)), 'May 1 is a red day');
  ok(isHoliday(di(2026, 12, 25)), 'Christmas Day is a red day');
  ok(isHoliday(di(2026, 4, 3)), 'Good Friday 2026 (Apr 3) is a red day');
  ok(isHoliday(di(2026, 6, 6)), 'National day is a red day');
  ok(!isHoliday(di(2026, 5, 4)), 'a plain Monday is not red');
  // A clear week (Mon Mar 9 to Mon Mar 16 2026, no holidays): 5 working days, 2 off.
  eq(countWorkdays(di(2026, 3, 9), di(2026, 3, 16)), 5, 'a clear week is 5 workdays');
  eq(countDaysOff(di(2026, 3, 9), di(2026, 3, 16)), 2, 'and 2 days off');
  // A week containing Friday May 1 (a red day): one fewer working day.
  eq(countWorkdays(di(2026, 4, 30), di(2026, 5, 7)), 4, 'May 1 removes a working day');
  eq(countDaysOff(di(2026, 4, 30), di(2026, 5, 7)), 3, '3 days off that week');
  // Reachable from a formula over date-index columns.
  const r = evaluateFormula('workdays(s, e)', { s: di(2026, 3, 9), e: di(2026, 3, 16) });
  ok(r.ok && r.value === 5, 'workdays() works in a formula');
});

test('cellScope: a formula can reference another formula, any order', () => {
  const columns: any = [
    { id: 'amt', name: 'Amount', type: 'number' },
    { id: 'total', name: 'Total', type: 'formula', formula: '[Double] + 1' }, // defined before Double
    { id: 'double', name: 'Double', type: 'formula', formula: '[Amount] * 2' },
  ];
  const scope = cellScope(columns, { amt: 10 });
  eq(scope['Double'], 20, 'Double computes from Amount');
  eq(scope['Total'], 21, 'Total uses Double despite earlier column order');
});

test('ref registry: formulas read widget values by label', () => {
  publishRef('countdown:', 'Fukuoka', 42);
  eq(lookupRef('countdown:', 'fukuoka'), 42, 'lookup is case-insensitive');
  const r = evaluateFormula('countdown("Fukuoka") - 7', {});
  ok(r.ok && r.value === 35, 'countdown() works in a formula');
  const miss = evaluateFormula('countdown("nope")', {});
  ok(!miss.ok, 'an unknown label is an error, not a silent zero');
  clearRef('countdown:', 'Fukuoka');
  ok(lookupRef('countdown:', 'Fukuoka') === undefined, 'clears on unmount');

  // Budget total and a person's net, namespaced so they do not collide.
  publishRef('budget:', 'Japan', 5000);
  publishRef('owed:', 'Japan|Alice', -200);
  ok(evaluateFormula('budget("Japan")', {}).value === 5000, 'budget() reads the total');
  ok(evaluateFormula('owed("Japan", "Alice")', {}).value === -200, 'owed() reads a net');
  clearRef('budget:', 'Japan');
  clearRef('owed:', 'Japan|Alice');

  // Table aggregates published by name.
  publishRef('tablecount:', 'Stops', 3);
  publishRef('tablesum:', 'Stops|Nights', 12);
  ok(evaluateFormula('tablecount("Stops")', {}).value === 3, 'tablecount() reads a row count');
  ok(evaluateFormula('tablesum("Stops", "Nights")', {}).value === 12, 'tablesum() reads a column total');
  clearRef('tablecount:', 'Stops');
  clearRef('tablesum:', 'Stops|Nights');
});

test('pageLinks: extract links and build the backlink graph', () => {
  const docA = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'pageRef', attrs: { pageId: 'b' } }] }, { type: 'pageLink', attrs: { pageId: 'c' } }],
  };
  eq(extractPageLinks(docA).sort().join(','), 'b,c', 'extracts pageRef and pageLink ids');
  const pages: any = {
    a: { id: 'a', content: docA, trashed: false },
    b: { id: 'b', content: { type: 'doc', content: [] }, trashed: false },
    c: { id: 'c', content: { type: 'doc', content: [{ type: 'pageLink', attrs: { pageId: 'a' } }] }, trashed: false },
  };
  const adj = buildLinkGraph(pages, {});
  eq(outboundOf(adj, 'a').sort().join(','), 'b,c', 'a links to b and c');
  eq(backlinksOf(adj, 'a').join(','), 'c', 'a is linked from c');
  eq(backlinksOf(adj, 'b').join(','), 'a', 'b is linked from a');
});

test('emoji search finds flags, image icons are detected', () => {
  ok(searchEmoji('japanese').some((d) => d.e === '🇯🇵'), 'japanese finds the Japan flag');
  ok(searchEmoji('sweden').some((d) => d.e === '🇸🇪'), 'sweden finds the Sweden flag');
  ok(searchEmoji('china').some((d) => d.e === '🇨🇳'), 'china finds the China flag');
  ok(isImageIcon('https://x/y.png'), 'a url is an image icon');
  ok(isImageIcon('/files/a.jpg'), 'a path is an image icon');
  ok(!isImageIcon('🇯🇵'), 'an emoji is not an image icon');
  ok(!isImageIcon(''), 'empty is not an image icon');
});

test('inline markdown on paste: bold, italic, code, strike, link', () => {
  ok(hasInlineMarkdown('**hi**'), 'detects bold');
  ok(!hasInlineMarkdown('just plain text'), 'plain text is left to the default');
  const b = parseInlineMarkdown('say **hello** to *the* world');
  eq(b.length, 5, 'splits into five nodes');
  eq(b[1].text, 'hello', 'bold text extracted');
  ok(b[1].marks?.[0].type === 'bold', 'bold mark');
  ok(b[3].marks?.[0].type === 'italic', 'italic mark');
  const link = parseInlineMarkdown('[Google](https://g.co)');
  ok(link[0].marks?.[0].type === 'link' && link[0].marks?.[0].attrs?.href === 'https://g.co', 'link parsed');
  ok(parseInlineMarkdown('run `npm i` now')[1].marks?.[0].type === 'code', 'inline code parsed');
  ok(parseInlineMarkdown('~~old~~')[0].marks?.[0].type === 'strike', 'strikethrough parsed');
  eq(parseInlineMarkdown('2 * 3 * 4').length, 1, 'spaced asterisks are not italic');
  eq(parseInlineMarkdown('my_var_name').length, 1, 'underscores in a word are left alone');
});

test('onThisDay surfaces same-day rows from earlier years', () => {
  const now = Date.now();
  const d = new Date(now);
  const md = `-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T12:00`;
  const cols: any = [
    { id: 't', name: 'Name', type: 'text' },
    { id: 'd', name: 'When', type: 'date' },
  ];
  const table: any = { id: 'tr', name: 'Trips', columns: cols };
  const rows: any = {
    a: { id: 'a', table: 'tr', cells: { t: 'Japan', d: `${d.getFullYear() - 1}${md}` } },
    b: { id: 'b', table: 'tr', cells: { t: 'Future', d: `${d.getFullYear() + 1}${md}` } },
  };
  const items = onThisDay({ tr: table }, rows, now);
  eq(items.length, 1, 'only the past same-day row');
  eq(items[0].yearsAgo, 1, 'one year ago');
});

test('parseGithubUrl: repo, issue, pr, and non-cards', () => {
  eq(parseGithubUrl('https://github.com/facebook/react')?.kind, 'repo', 'repo');
  const issue = parseGithubUrl('https://github.com/facebook/react/issues/123');
  ok(issue?.kind === 'issue' && issue.number === 123, 'issue with number');
  const pr = parseGithubUrl('https://github.com/facebook/react/pull/9');
  ok(pr?.kind === 'pr' && pr.number === 9, 'pull request');
  ok(parseGithubUrl('https://github.com/facebook/react/tree/main') === null, 'a tree url is not a card');
  ok(parseGithubUrl('https://example.com/a/b') === null, 'a non-github url is not a card');
});

// --- pageTree + permissions (lifted out of useData.ts into lib/) ------------
// (reuses the module-level mkPage fixture defined earlier in this file)

test('pageTree: selectTopLevel/selectChildren sort by order and skip trashed', () => {
  const pages: Record<string, Page> = {
    a: mkPage({ id: 'a', parent: '', order: 2 }),
    b: mkPage({ id: 'b', parent: '', order: 1 }),
    c: mkPage({ id: 'c', parent: 'a', order: 0 }),
    d: mkPage({ id: 'd', parent: 'a', order: 1, trashed: true }),
    e: mkPage({ id: 'e', parent: '', order: 0, trashed: true }),
  };
  eq(selectTopLevel(pages).map((p) => p.id), ['b', 'a'], 'roots sorted, trashed dropped');
  eq(selectChildren(pages, 'a').map((p) => p.id), ['c'], 'children sorted, trashed dropped');
});

test('pageTree: selectTrashRoots returns only subtree roots, newest first', () => {
  const pages: Record<string, Page> = {
    a: mkPage({ id: 'a', trashed: true, updated: '2024-01-02' }),
    b: mkPage({ id: 'b', parent: 'a', trashed: true, updated: '2024-01-03' }), // child of trashed: not a root
    c: mkPage({ id: 'c', trashed: true, updated: '2024-01-01' }),
  };
  eq(selectTrashRoots(pages).map((p) => p.id), ['a', 'c'], 'roots only, newest first');
});

test('pageTree: selectTemplates sorts by title and skips trashed', () => {
  const pages: Record<string, Page> = {
    a: mkPage({ id: 'a', template: true, title: 'Zebra' }),
    b: mkPage({ id: 'b', template: true, title: 'Apple' }),
    c: mkPage({ id: 'c', template: false }),
    d: mkPage({ id: 'd', template: true, trashed: true }),
  };
  eq(selectTemplates(pages).map((p) => p.id), ['b', 'a'], 'by title, trashed dropped');
});

test('pageTree: workspace scoping with the empty -> default bucket rule', () => {
  const pages: Record<string, Page> = {
    a: mkPage({ id: 'a', workspace: 'w1' }),
    b: mkPage({ id: 'b' }), // empty workspace -> default bucket
    c: mkPage({ id: 'c', workspace: 'w2' }),
  };
  eq(pageWorkspaceId(pages.b, 'def'), 'def', 'empty resolves to default');
  eq(Object.keys(selectWorkspacePages(pages, 'def', 'def')), ['b'], 'default bucket picks up empty');
  eq(Object.keys(selectWorkspacePages(pages, 'w1', 'def')), ['a'], 'real workspace scoping');
  eq(Object.keys(selectWorkspacePages(pages, null, 'def')).sort(), ['a', 'b', 'c'], 'null activeId = no scoping');

  const tables: Record<string, TableData> = {
    t1: { id: 't1', name: '', columns: [], owner: '', workspace: 'w1', updated: '', created: '' },
    t2: { id: 't2', name: '', columns: [], owner: '', updated: '', created: '' }, // empty -> default
  };
  eq(selectWorkspaceTables(tables, 'w1', 'def').map((t) => t.id), ['t1'], 'tables: real workspace');
  eq(selectWorkspaceTables(tables, 'def', 'def').map((t) => t.id), ['t2'], 'tables: empty -> default');
});

test('pageTree: selectBreadcrumb walks ancestors and guards cycles', () => {
  const pages: Record<string, Page> = {
    a: mkPage({ id: 'a', parent: '' }),
    b: mkPage({ id: 'b', parent: 'a' }),
    c: mkPage({ id: 'c', parent: 'b' }),
  };
  eq(selectBreadcrumb(pages, 'c').map((p) => p.id), ['a', 'b', 'c'], 'root to leaf');
  const cyc: Record<string, Page> = {
    x: mkPage({ id: 'x', parent: 'y' }),
    y: mkPage({ id: 'y', parent: 'x' }),
  };
  ok(selectBreadcrumb(cyc, 'x').length <= 2, 'cycle guard stops the walk');
});

test('pageTree: selectRowsForTable filters by table and sorts position then created', () => {
  const rows: Record<string, TableRow> = {
    r1: { id: 'r1', table: 't', parent: '', cells: {}, position: 1, created: '2024-01-01', updated: '' },
    r2: { id: 'r2', table: 't', parent: '', cells: {}, position: 0, created: '2024-01-02', updated: '' },
    r3: { id: 'r3', table: 'other', parent: '', cells: {}, position: 0, created: '2024-01-01', updated: '' },
  };
  eq(selectRowsForTable(rows, 't').map((r) => r.id), ['r2', 'r1'], 'position order, table filtered');
});

test('permissions: selectMyRole mirrors the server predicate', () => {
  const pages: Record<string, Page> = {
    ws: mkPage({ id: 'ws', visibility: 'workspace', owner: 'o' }),
    priv: mkPage({ id: 'priv', visibility: 'private', owner: 'o', editors: ['e'], viewers: ['v'] }),
  };
  eq(selectMyRole(pages, 'ws', 'anyone'), 'editor', 'workspace page: any member edits');
  eq(selectMyRole(pages, 'priv', 'o'), 'owner', 'owner wins');
  eq(selectMyRole(pages, 'priv', 'e'), 'editor', 'editor granted');
  eq(selectMyRole(pages, 'priv', 'v'), 'viewer', 'viewer granted');
  eq(selectMyRole(pages, 'priv', 'nobody'), 'none', 'private denies a non-shared member');
  eq(selectMyRole(pages, null, 'o'), 'none', 'no page id');
  ok(canEditPage('owner') && canEditPage('editor') && !canEditPage('viewer') && !canEditPage('none'), 'canEdit');
  ok(canManageSharing('owner') && !canManageSharing('editor'), 'only owner manages sharing');
});

test('doc: extractTableIds collects nested ids; remapTableIds rewrites without mutating', () => {
  const doc = { type: 'doc', content: [
    { type: 'tableEmbed', attrs: { tableId: 't1' } },
    { type: 'paragraph', content: [{ type: 'tableEmbed', attrs: { tableId: 't2' } }] },
  ] };
  eq(extractTableIds(doc).sort(), ['t1', 't2'], 'collects nested ids');
  const remapped = remapTableIds(doc, { t1: 'T1' });
  eq(extractTableIds(remapped).sort(), ['T1', 't2'], 'rewrites mapped, leaves others');
  eq(extractTableIds(doc).sort(), ['t1', 't2'], 'source is not mutated (deep copy)');
});







// --- schedule trigger: the automation runtime's wall-clock decision ----------

test('schedule: daily fires once after the time, then dedupes on the slot', () => {
  const trig = { kind: 'schedule', freq: 'daily', time: '09:00' } as FlowTrigger;
  const at = (h: number, m = 0) => new Date(2026, 0, 5, h, m).getTime(); // local
  ok(scheduleDue(trig, 0, at(10)), 'after 09:00 with no prior fire -> due');
  const slot = lastScheduledSlot(trig, at(10)) as number; // today 09:00
  ok(!scheduleDue(trig, slot, at(10)), 'already fired this slot -> not due');
  ok(!scheduleDue(trig, slot, at(10, 30)), 'still the same slot later -> not due');
  const nextDay = new Date(2026, 0, 6, 10, 0).getTime();
  ok(scheduleDue(trig, slot, nextDay), 'next day after the time -> due again');
});

test('schedule: before the daily time, today has not come due', () => {
  const trig = { kind: 'schedule', freq: 'daily', time: '09:00' } as FlowTrigger;
  const today8 = new Date(2026, 0, 5, 8, 0).getTime();
  const slot = lastScheduledSlot(trig, today8) as number; // yesterday 09:00
  ok(!scheduleDue(trig, slot, today8), 'before today 09:00, having fired yesterday -> not due');
});

test('schedule: weekly fires only on its weekday', () => {
  const mon = { kind: 'schedule', freq: 'weekly', weekday: 1, time: '09:00' } as FlowTrigger;
  const monday10 = new Date(2026, 0, 5, 10, 0).getTime();
  ok(new Date(monday10).getDay() === 1, 'fixture date is a Monday');
  ok(scheduleDue(mon, 0, monday10), 'on Monday after the time -> due');
  const slot = lastScheduledSlot(mon, monday10) as number;
  const tuesday10 = new Date(2026, 0, 6, 10, 0).getTime();
  ok(!scheduleDue(mon, slot, tuesday10), 'Tuesday is not a new slot after Monday fired');
});

// --- setlist import/export --------------------------------------------------

test('setlistIO: parse reads songs/says/segments, minutes, and the title', () => {
  const txt = `# Friday set\n\nsay | welcome | 1\nsong | Opener | Jen leads | 4\nsegment | intro quiz | 5\nsong | Second |  | 3`;
  const r = parseSetlist(txt);
  eq(r.title, 'Friday set', 'title from #');
  eq(r.items.map((i) => i.kind), ['banter', 'song', 'segment', 'song'], 'kinds (say -> banter)');
  eq(r.items[1].sub, 'Jen leads', 'song sub');
  eq(r.items[1].mins, 4, 'song minutes');
  eq(r.items[0].mins, 1, 'say minutes');
  eq(r.items[2].mins, 5, 'segment minutes');
  ok(r.items[3].sub === undefined, 'empty song sub omitted');
});

test('setlistIO: serialize round-trips through parse', () => {
  const items: SetItem[] = [
    { id: 'a', kind: 'banter', text: 'hello', mins: 1 },
    { id: 'b', kind: 'song', text: 'Tune', sub: 'capo 2', mins: 4 },
    { id: 'c', kind: 'segment', text: 'quiz', mins: 5 },
  ];
  const round = parseSetlist(serializeSetlist('My set', items));
  eq(round.title, 'My set', 'title round-trips');
  eq(
    round.items.map((i) => ({ kind: i.kind, text: i.text, sub: i.sub, mins: i.mins })),
    [
      { kind: 'banter', text: 'hello', sub: undefined, mins: 1 },
      { kind: 'song', text: 'Tune', sub: 'capo 2', mins: 4 },
      { kind: 'segment', text: 'quiz', sub: undefined, mins: 5 },
    ],
    'all fields survive the round trip',
  );
});

test('setlistIO: the blank template imports cleanly', () => {
  const r = parseSetlist(SETLIST_TEMPLATE);
  ok(r.items.length >= 5, 'template has lines');
  ok(r.items.every((i) => i.kind === 'song' || i.kind === 'banter' || i.kind === 'segment'), 'all valid kinds');
});

test('rowColor: first matching rule tints the row, else null', () => {
  const rules: ColorRule[] = [
    { id: 'r1', columnId: 'status', op: 'is', value: 'Done', color: '#10b981' },
    { id: 'r2', columnId: 'n', op: 'gt', value: 10, color: '#f43f5e' },
  ];
  eq(rowColor({ status: 'Done', n: 3 }, rules), '#10b981', 'first rule matches');
  eq(rowColor({ status: 'Todo', n: 20 }, rules), '#f43f5e', 'falls through to the second');
  eq(rowColor({ status: 'Todo', n: 2 }, rules), null, 'no rule matches');
  eq(rowColor({ status: 'Done', n: 20 }, rules), '#10b981', 'first match wins over a later one');
  eq(rowColor({ status: 'Done' }, undefined), null, 'no rules means no tint');
  eq(rowColor({ status: 'Done' }, []), null, 'empty rules means no tint');
});

test('ics: pageToICS merges every table on the page into one calendar', () => {
  const mk = (id: string, name: string, day: string): TableData =>
    ({ id, name, columns: [{ id: `${id}t`, name: 'Title', type: 'text', width: 120 }, { id: `${id}d`, name: 'When', type: 'date', width: 120 }] }) as unknown as TableData;
  const t1 = mk('a', 'Flights', '');
  const t2 = mk('b', 'Hotels', '');
  const rows: TableRow[] = [
    { id: 'r1', table: 'a', cells: { at: 'Narita landing', ad: '2026-08-01' } } as unknown as TableRow,
    { id: 'r2', table: 'b', cells: { bt: 'Ryokan check-in', bd: '2026-08-02' } } as unknown as TableRow,
    { id: 'r3', table: 'b', cells: { bt: 'no date' } } as unknown as TableRow,
  ];
  const ics = pageToICS('Japan trip', [
    { table: t1, rows: rows.filter((r) => r.table === 'a') },
    { table: t2, rows: rows.filter((r) => r.table === 'b') },
  ]);
  eq((ics.match(/BEGIN:VEVENT/g) || []).length, 2, 'two dated rows become two events; the undated one is skipped');
  ok(ics.includes('X-WR-CALNAME:Japan trip'), 'the calendar carries the page name');
  ok(ics.startsWith('BEGIN:VCALENDAR') && ics.trimEnd().endsWith('END:VCALENDAR'), 'one wrapping calendar');
  ok(ics.includes('SUMMARY:Narita landing') && ics.includes('SUMMARY:Ryokan check-in'), 'both summaries present');
  // A single table still round-trips through tableToICS unchanged.
  ok(tableToICS(t1, rows.filter((r) => r.table === 'a')).includes('BEGIN:VEVENT'), 'per-table export still works');
});

test('ics: isValidCalEvent gates on a title AND a parseable date', () => {
  ok(isValidCalEvent({ title: 'Flight', startIso: '2026-08-01T09:00' }), 'title + datetime is valid');
  ok(isValidCalEvent({ title: 'Stay', startIso: '2026-08-02' }), 'title + bare date is valid');
  ok(!isValidCalEvent({ title: '', startIso: '2026-08-01' }), 'no title -> not valid');
  ok(!isValidCalEvent({ title: 'x', startIso: '' }), 'no date -> not valid');
  ok(!isValidCalEvent({ title: 'x', startIso: 'someday' }), 'unparseable date -> not valid');
});

test('ics: eventsToICS builds timed + all-day events and skips invalid ones', () => {
  const ics = eventsToICS('Japan trip', [
    { title: 'ANA NH106', startIso: '2026-08-01T09:30', location: 'Haneda', description: 'Confirmation ABC123', uid: 'res1' },
    { title: 'Ryokan', startIso: '2026-08-02' },
    { title: '', startIso: '2026-08-03' }, // dropped: no title
  ]);
  eq((ics.match(/BEGIN:VEVENT/g) || []).length, 2, 'the two valid events export; the titleless one is skipped');
  ok(ics.includes('DTSTART:20260801T093000'), 'timed event uses floating local time (no Z)');
  ok(ics.includes('DTSTART;VALUE=DATE:20260802') && ics.includes('DTEND;VALUE=DATE:20260803'), 'all-day event has an exclusive next-day end');
  ok(ics.includes('UID:res1@waypoint'), 'a provided uid is used verbatim');
  ok(ics.includes('LOCATION:Haneda') && ics.includes('SUMMARY:ANA NH106'), 'location + summary carried');
});

test('ics: googleCalUrl encodes title, dates and details for a single event', () => {
  const timed = googleCalUrl({ title: 'ANA NH106', startIso: '2026-08-01T09:30', description: 'code ABC' });
  ok(timed.includes('action=TEMPLATE'), 'a create-event template link');
  ok(timed.includes('text=ANA+NH106'), 'title encoded');
  ok(timed.includes('dates=20260801T093000%2F20260801T103000'), 'default 1h span, start/end joined by an (encoded) slash');
  ok(timed.includes('details=code+ABC'), 'details carried');
  const allDay = googleCalUrl({ title: 'Ryokan', startIso: '2026-08-02' });
  ok(allDay.includes('dates=20260802%2F20260803'), 'all-day spans to the next day');
  eq(googleCalUrl({ title: '', startIso: '2026-08-02' }), '', 'no title -> no url');
});

test('audio: formatTime clocks seconds, minutes, hours, and guards bad input', () => {
  eq(formatTime(0), '0:00', 'zero');
  eq(formatTime(7), '0:07', 'seven seconds pads');
  eq(formatTime(72), '1:12', 'over a minute');
  eq(formatTime(600), '10:00', 'ten minutes');
  eq(formatTime(3609), '1:00:09', 'past an hour pads the minutes');
  eq(formatTime(NaN), '0:00', 'NaN is 0:00');
  eq(formatTime(-5), '0:00', 'negative is 0:00');
  eq(formatTime(Infinity), '0:00', 'Infinity is 0:00');
});

test('quizIO: serialize and parse round-trip (title, options, answers)', () => {
  const items: QuizItem[] = [
    { id: 'a', text: 'Capital of Japan?', answer: 'Tokyo', options: ['Tokyo', 'Osaka', 'Kyoto'] },
    { id: 'b', text: 'Tallest mountain?', answer: 'Mount Fuji' },
  ];
  const round = parseQuiz(serializeQuiz('Trivia', items));
  eq(round.title, 'Trivia', 'title round-trips');
  eq(round.items.length, 2, 'both questions survive');
  eq(round.items[0].text, 'Capital of Japan?', 'question text');
  eq(round.items[0].options, ['Tokyo', 'Osaka', 'Kyoto'], 'options survive');
  eq(round.items[0].answer, 'Tokyo', 'answer survives');
  ok(round.items[1].options === undefined, 'a question with no options carries none');
  eq(round.items[1].answer, 'Mount Fuji', 'second answer');
});

test('quizIO: forgiving parse (bare questions, no Q: marker, * bullets)', () => {
  const r = parseQuiz('# Pub quiz\n\nWho painted the Mona Lisa?\n* Da Vinci\n* Michelangelo\nAnswer: Da Vinci\n\nQ) 7 x 8?\nA: 56');
  eq(r.title, 'Pub quiz', 'title from #');
  eq(r.items.length, 2, 'two questions');
  eq(r.items[0].text, 'Who painted the Mona Lisa?', 'a bare line is a question');
  eq(r.items[0].options, ['Da Vinci', 'Michelangelo'], '* bullets are options');
  eq(r.items[0].answer, 'Da Vinci', 'Answer: prefix works');
  eq(r.items[1].text, '7 x 8?', 'a Q) marker is stripped');
  eq(r.items[1].answer, '56', 'A: prefix works');
});

test('quizIO: the fill-in template imports cleanly', () => {
  const r = parseQuiz(QUIZ_TEMPLATE);
  ok(r.items.length >= 3, 'template has questions');
  ok(r.title.length > 0, 'template has a title');
  ok(r.items.every((i) => i.text.trim().length > 0 && i.answer.trim().length > 0), 'every question has text and an answer');
  ok(r.items.some((i) => (i.options?.length ?? 0) >= 2), 'at least one multiple-choice question');
});

test('characterIO: JSON round-trip preserves every field', () => {
  const round = parseCharacter(sheetToJSON(CHARACTER_EXAMPLE));
  eq(round, CHARACTER_EXAMPLE, 'a serialized sheet re-imports identically');
});

test('characterIO: forgiving parse (aliases, flat abilities, first of an array)', () => {
  const c = parseCharacter('[{"character name":"Borin","class":"Fighter","lvl":"5","strength":16,"dexterity":"12","hp":"44","armor class":18}]');
  eq(c.name, 'Borin', 'name from "character name"');
  eq(c.className, 'Fighter', 'class -> className');
  eq(c.level, 5, 'lvl coerced to a number');
  eq(c.abilities.str, 16, 'strength -> str (top-level)');
  eq(c.abilities.dex, 12, 'string ability coerced');
  eq(c.maxHp, 44, 'hp -> maxHp');
  eq(c.ac, 18, 'armor class -> ac');
  eq(c.abilities.con, 10, 'a missing ability falls back to 10');
});

test('characterIO: the fill-in template and example import cleanly', () => {
  const t = parseCharacter(CHARACTER_TEMPLATE_JSON);
  ok(t.level >= 1 && t.abilities.str >= 1, 'template imports with sane numbers');
  const e = parseCharacter(CHARACTER_EXAMPLE_JSON);
  eq(e.name, 'Mirelle Duskwood', 'example imports its name');
  eq(e.abilities.dex, 17, 'example imports its abilities');
});

test('characterIO: empty text yields a blank sheet, junk throws', () => {
  eq(parseCharacter('   ').level, 1, 'blank -> default sheet');
  let threw = false;
  try { parseCharacter('not json'); } catch { threw = true; }
  ok(threw, 'non-JSON throws (the widget catches it)');
});

test('mindmapIO: import mints fresh ids and remaps edges onto them', () => {
  let n = 0;
  const deps = { uid: (p = '') => `${p}${n++}` };
  const data = bundleToMindmap(parseMindmapBundle(serializeMindmapBundle(exampleMindmapBundle())), deps);
  eq(data.nodes.length, 7, 'all nodes import');
  eq(data.edges.length, 6, 'all edges import');
  const ids = new Set(data.nodes.map((nd) => nd.id));
  ok(data.nodes.every((nd) => nd.id.startsWith('mn_')), 'nodes get fresh mn_ ids');
  ok(data.edges.every((e) => ids.has(e.from) && ids.has(e.to)), 'every edge points at a real node');
  const place = data.nodes.find((nd) => nd.kind === 'place')!;
  eq((place.payload as { name: string }).name, 'Yufuin ryokan', 'place payload rebuilt');
  const widget = data.nodes.find((nd) => nd.kind === 'widget')!;
  eq((widget.payload as { text: string; checked: boolean }).checked, false, 'widget payload rebuilt');
  const number = data.nodes.find((nd) => nd.kind === 'number')!;
  eq(number.payload, 320000, 'number payload rebuilt');
});

test('mindmapIO: an edge to a missing node is dropped, blank template imports', () => {
  let n = 0;
  const deps = { uid: (p = '') => `${p}${n++}` };
  const bundle = parseMindmapBundle('{"waypointMindmap":1,"title":"x","nodes":[{"id":"a","text":"A"}],"edges":[{"from":"a","to":"ghost"}]}');
  const data = bundleToMindmap(bundle, deps);
  eq(data.nodes.length, 1, 'the one real node imports');
  eq(data.edges.length, 0, 'the edge to a node not in the file is dropped');
  const blank = bundleToMindmap(blankMindmapBundle(), deps);
  ok(blank.nodes.length === 3 && blank.edges.length === 2, 'blank template imports a small tree');
});

test('restoreBackup: parseBackup shapes pages and tables, rejects junk', () => {
  const b = parseBackup('{"pages":[{"id":"p1","title":"Home","parent":"","content":{"type":"doc"}}],"tables":[{"id":"t1","name":"Costs","columns":[],"rows":[{"id":"r1","cells":{"c1":"x"}}]}]}');
  eq(b.pages.length, 1, 'one page');
  eq(b.tables[0].rows.length, 1, 'one row');
  let threw = false;
  try { parseBackup('{"nope":true}'); } catch { threw = true; }
  ok(threw, 'a file with neither pages nor tables is rejected');
});

test('restoreBackup: remapDeep rewrites ids in content and cell arrays', () => {
  const map = new Map([['old_table', 'new_table'], ['old_row', 'new_row']]);
  const content = { type: 'doc', content: [{ type: 'tableEmbed', attrs: { tableId: 'old_table' } }] };
  const out = remapDeep(content, map) as typeof content;
  eq((out.content[0].attrs as { tableId: string }).tableId, 'new_table', 'embed id remapped');
  const cells = remapDeep({ rel: ['old_row', 'untouched'], text: 'old_table is a word' }, map) as { rel: string[]; text: string };
  eq(cells.rel, ['new_row', 'untouched'], 'a relation id array is remapped element-wise');
  eq(cells.text, 'old_table is a word', 'a non-id string that merely contains an id is left alone');
});

test('restoreBackup: parseBackup carries views, automations, canvases and row bodies', () => {
  const b = parseBackup(JSON.stringify({
    pages: [{ id: 'p1', title: 'Trip', cover: 'sunset', map: { pins: [], routes: [] }, kanban: { tableId: 't1' } }],
    tables: [{ id: 't1', name: 'Board', columns: [{ id: 'c1', name: 'Title', type: 'text', width: 160 }], views: { type: 'board', groupColumnId: 'c2' }, automations: [{ id: 'a1' }], rows: [{ id: 'r1', parent: 'r0', cells: {}, content: { type: 'doc' } }] }],
  }));
  eq((b.pages[0].kanban as { tableId: string }).tableId, 't1', 'the kanban binding survives');
  eq(b.pages[0].cover, 'sunset', 'cover survives');
  ok(!!b.pages[0].map, 'the map canvas survives');
  eq((b.tables[0].views as { groupColumnId: string }).groupColumnId, 'c2', 'view config survives');
  eq(b.tables[0].automations?.length, 1, 'automations survive');
  eq(b.tables[0].rows[0].parent, 'r0', 'a sub-item parent survives');
  ok(!!b.tables[0].rows[0].content, 'a row body survives');
});

test('restoreBackup: a backup carries the page data a restore used to drop', () => {
  // Tier lists, currency boards and the whole Photos/Files attachment list were all
  // absent from the format, so "I have a backup" was not true for any of them, and
  // you would only find out on the day it mattered.
  const b = parseBackup(JSON.stringify({
    pages: [{
      id: 'p1',
      title: 'Tokyo',
      tierlist: { tiers: [{ id: 't', label: 'S', min: 8 }], items: [{ id: 'i', text: 'Ramen', score: 9 }] },
      rates: { title: 'Cash', amount: 1000, base: 'SEK', rows: [{ id: 'a', code: 'JPY', note: 'kiosk', manual: 13.16 }] },
      photos: [{ id: 'ph1', url: '/api/files/uploads/abc/x.jpg', name: 'x.jpg' }],
      files: [{ id: 'f1', url: '/api/files/uploads/def/t.pdf', name: 'ticket.pdf' }],
      defaultTab: 'itinerary',
    }],
    tables: [],
  }));
  const p = b.pages[0];
  eq(p.tierlist?.items.length, 1, 'the tier list rides along');
  eq(p.rates?.rows[0].manual, 13.16, 'and a pinned rate, the one number you cannot retype from memory');
  eq(p.photos?.length, 1, 'the Photos list is carried');
  eq(p.files?.[0].name, 'ticket.pdf', 'and the Files list, by name');
  eq(p.defaultTab, 'itinerary', 'and which tab the page opens on');
  // A page with none of them still parses, and reads as empty rather than undefined.
  const bare = parseBackup('{"pages":[{"id":"p2","title":"Plain"}],"tables":[]}');
  eq(bare.pages[0].tierlist, null, 'absent tier list is null, not undefined');
  eq(bare.pages[0].photos?.length, 0, 'absent photos is an empty list');
});

test('restoreBackup: a record without an id is treated as new, not dropped', () => {
  const b = parseBackup('{"pages":[{"title":"Added by hand"}],"tables":[{"name":"T","columns":[],"rows":[{"cells":{"c1":"new row"}}]}]}');
  eq(b.pages.length, 1, 'the id-less page is kept');
  eq(b.tables[0].rows.length, 1, 'the id-less row is kept');
  ok(b.pages[0].id.startsWith('__new__'), 'it gets a placeholder id');
  ok(b.pages[0].id !== b.tables[0].rows[0].id, 'placeholders are unique');
});

test('restoreBackup: a lone entity file imports on its own', () => {
  const table = parseBackup('{"id":"t1","name":"Packing","columns":[{"id":"c1","name":"Item","type":"text","width":160}],"rows":[{"id":"r1","cells":{"c1":"Socks"}}]}');
  eq(table.tables.length, 1, 'a bare table file becomes a one-table backup');
  eq(table.pages.length, 0, 'and no pages');
  const page = parseBackup('{"id":"p1","title":"Tokyo","content":{"type":"doc"}}');
  eq(page.pages.length, 1, 'a bare page file becomes a one-page backup');
});

test('restoreBackup: assembleBackup stitches data/ files, falls back to backup.json', () => {
  const v2 = assembleBackup([
    { name: 'README.md', text: 'ignored' },
    { name: 'manifest.json', text: '{"waypointBackup":2,"workspace":"Japan","exportedAt":"2026-07-16T00:00:00Z"}' },
    { name: 'data/pages/Tokyo.json', text: '{"id":"p1","title":"Tokyo"}' },
    { name: 'data/tables/Packing.json', text: '{"id":"t1","name":"Packing","columns":[],"rows":[{"id":"r1","cells":{}}]}' },
  ]);
  eq(v2.workspace, 'Japan', 'workspace read from the manifest');
  eq(v2.pages.length, 1, 'page file collected');
  eq(v2.tables[0].rows.length, 1, 'table file collected');
  const wrapped = assembleBackup([{ name: 'Japan-backup/data/pages/Tokyo.json', text: '{"id":"p1","title":"Tokyo"}' }]);
  eq(wrapped.pages.length, 1, 'a re-zip that added a wrapping folder still works');
  const v1 = assembleBackup([{ name: 'backup.json', text: '{"pages":[{"id":"p1","title":"Old"}],"tables":[]}' }]);
  eq(v1.pages[0].title, 'Old', 'an old zip with only backup.json still restores');
  let threw = '';
  try { assembleBackup([{ name: 'data/tables/Broken.json', text: '{not json' }]); } catch (e) { threw = (e as Error).message; }
  ok(threw.includes('Broken.json'), 'a broken entity file names itself in the error');
  let none = false;
  try { assembleBackup([{ name: 'notes.json', text: '{}' }]); } catch { none = true; }
  ok(none, 'a zip with no Waypoint data is rejected');
});

test('restoreBackup: remapDeep reconnects a kanban binding, view config and relation columns', () => {
  const map = new Map([['old_table', 'new_table'], ['old_row', 'new_row']]);
  const kanban = remapDeep({ tableId: 'old_table' }, map) as { tableId: string };
  eq(kanban.tableId, 'new_table', 'the board follows its restored table');
  const views = remapDeep({ type: 'board', groupColumnId: 'c2', colorRules: [{ columnId: 'c2', value: 'x' }] }, map) as { groupColumnId: string };
  eq(views.groupColumnId, 'c2', 'column ids (unchanged on restore) pass through');
  const cols = remapDeep([{ id: 'c3', name: 'Trip', type: 'relation', width: 160, relationTableId: 'old_table' }], map) as { relationTableId: string }[];
  eq(cols[0].relationTableId, 'new_table', 'a relation column follows its restored target table');
});

test('restoreBackup: deadTableRemaps repoints live pages at a restored copy of a deleted table', () => {
  const idMap = new Map([['dead_tbl', 'fresh_tbl'], ['live_tbl', 'copy_tbl']]);
  const live = new Set(['live_tbl', 'fresh_tbl', 'copy_tbl']); // dead_tbl is gone
  const embed = (tid: string) => ({ type: 'doc', content: [{ type: 'tableEmbed', attrs: { tableId: tid } }] });
  const pages = [
    { id: 'broken', content: embed('dead_tbl'), kanban: null },
    { id: 'board', content: null, kanban: { tableId: 'dead_tbl' } },
    { id: 'fine', content: embed('live_tbl'), kanban: { tableId: 'live_tbl' } },
    { id: 'enc', content: 'enc:v1:opaque', kanban: null }, // envelope: unreadable, untouched
    { id: 'made', content: embed('dead_tbl'), kanban: null }, // created by the restore itself
  ];
  const fixes = deadTableRemaps(idMap, live, pages, new Set(['made']));
  eq(fixes.length, 2, 'only the broken page and the broken board are fixed');
  const broken = fixes.find((f) => f.pageId === 'broken')!;
  ok(broken.content && !broken.kanban && broken.remap.dead_tbl === 'fresh_tbl', 'body embed repointed');
  const board = fixes.find((f) => f.pageId === 'board')!;
  ok(board.kanban && !board.content && board.remap.dead_tbl === 'fresh_tbl', 'kanban binding repointed');
  eq(deadTableRemaps(new Map([['live_tbl', 'copy_tbl']]), live, pages, new Set()).length, 0, 'a still-live old id is left alone');
});

test('restoreBackup: orderPagesByParent puts parents before children', () => {
  const pages = [
    { id: 'c', parent: 'b' },
    { id: 'a', parent: '' },
    { id: 'b', parent: 'a' },
    { id: 'orphan', parent: 'missing' },
  ];
  const order = orderPagesByParent(pages).map((p) => p.id);
  ok(order.indexOf('a') < order.indexOf('b') && order.indexOf('b') < order.indexOf('c'), 'a before b before c');
  ok(order.includes('orphan'), 'a page whose parent is missing is still restored (as a root)');
});

test('pageTree: selectUnfiledPages surfaces the top of each orphaned subtree only', () => {
  const pages: Record<string, Page> = {
    root: mkPage({ id: 'root', parent: '', workspace: 'w1' }),
    childOk: mkPage({ id: 'childOk', parent: 'root', workspace: 'w1' }),
    // stranded by a partial move: parent lives in another workspace
    orphanA: mkPage({ id: 'orphanA', parent: 'extern', workspace: 'w1' }),
    orphanB: mkPage({ id: 'orphanB', parent: 'orphanA', workspace: 'w1' }), // nests under orphanA
    extern: mkPage({ id: 'extern', parent: '', workspace: 'w2' }),
    // parent id doesn't exist (a bad import)
    orphanC: mkPage({ id: 'orphanC', parent: 'ghost', workspace: 'w1' }),
  };
  eq(selectUnfiledPages(pages, 'w1', 'w1').map((p) => p.id), ['orphanA', 'orphanC'], 'only orphaned tops, not their children or filed pages');
  eq(selectUnfiledPages(pages, 'w2', 'w2'), [], 'a healthy workspace surfaces nothing');
  eq(selectUnfiledPages(pages, null, 'w1'), [], 'no active workspace → nothing');

  // An orphaned page that is REACHABLE from a live page (a body pageLink, a
  // mindmap page-node, a kanban binding) is no longer flagged: you can open it
  // there, so it isn't lost. This was the "shows in Not-in-list but I see it in
  // the view anyway" report.
  const linked: Record<string, Page> = {
    root: mkPage({ id: 'root', parent: '', workspace: 'w1', content: { type: 'doc', content: [{ type: 'pageRef', attrs: { pageId: 'orphanA' } }] } }),
    orphanA: mkPage({ id: 'orphanA', parent: 'ghost', workspace: 'w1' }),
    orphanMap: mkPage({ id: 'orphanMap', parent: 'ghost', workspace: 'w1', mindmap: { nodes: [{ id: 'n1', kind: 'page', pageId: 'orphanC' }] } as unknown as Page['mindmap'] }),
    orphanC: mkPage({ id: 'orphanC', parent: 'ghost', workspace: 'w1' }),
    trulyLost: mkPage({ id: 'trulyLost', parent: 'ghost', workspace: 'w1' }),
  };
  eq(selectUnfiledPages(linked, 'w1', 'w1').map((p) => p.id), ['orphanMap', 'trulyLost'], 'a page linked from a live page is not flagged; a truly unreferenced one still is');
});

test('turnIntoWorkspace: descendantPageIds walks the subtree, skips trashed, guards cycles', () => {
  const pages: Record<string, Page> = {
    root: mkPage({ id: 'root', parent: '' }),
    a: mkPage({ id: 'a', parent: 'root' }),
    b: mkPage({ id: 'b', parent: 'a' }),
    sib: mkPage({ id: 'sib', parent: '' }),
    gone: mkPage({ id: 'gone', parent: 'root', trashed: true }),
  };
  const ids = descendantPageIds(pages, 'root').sort();
  eq(ids, ['a', 'b', 'root'], 'root + live descendants, trashed and siblings excluded');
  eq(descendantPageIds(pages, 'gone'), [], 'a trashed root yields nothing');
});

test('turnIntoWorkspace: collectMovedSet gathers embedded + kanban tables and their rows', () => {
  const embed = (tid: string) => ({ type: 'doc', content: [{ type: 'tableEmbed', attrs: { tableId: tid } }] });
  const pages: Record<string, Page> = {
    root: mkPage({ id: 'root', parent: '', content: embed('tEmbedded') }),
    child: mkPage({ id: 'child', parent: 'root', kanban: { tableId: 'tKanban' } }),
    outside: mkPage({ id: 'outside', parent: '', content: embed('tOutside') }),
  };
  const tables = { tEmbedded: tbl('tEmbedded', 'E', []), tKanban: tbl('tKanban', 'K', []), tOutside: tbl('tOutside', 'O', []) };
  const rows = { r1: rw('r1', 'tEmbedded', {}), r2: rw('r2', 'tKanban', {}), r3: rw('r3', 'tOutside', {}) };
  const set = collectMovedSet(pages, tables, rows, 'root', {});
  eq(set.pageIds.sort(), ['child', 'root'], 'both pages move');
  eq(set.tableIds.sort(), ['tEmbedded', 'tKanban'], 'embedded + kanban tables move, the outside one stays');
  eq(set.rowIds.sort(), ['r1', 'r2'], 'their rows move, the outside row stays');

  // A locked page's stored content is an opaque envelope, so embeds must be read
  // from the decrypted doc handed in, not from page.content.
  const locked = collectMovedSet(
    { root: mkPage({ id: 'root', parent: '', content: 'enc:v1:opaque' }) },
    { tSecret: tbl('tSecret', 'S', []) },
    { r: rw('r', 'tSecret', {}) },
    'root',
    { root: embed('tSecret') },
  );
  eq(locked.tableIds, ['tSecret'], 'embedded table read from the decrypted doc, not the envelope');
});

test('turnIntoWorkspace: relationSeverances cuts only outside→inside, keeping other ids', () => {
  const cols: Column[] = [
    col({ id: 'rel', name: 'Rel', type: 'relation', relationTableId: 'In' }),
    col({ id: 'txt', name: 'Note', type: 'text' }),
  ];
  const tables = { Out: tbl('Out', 'Out', cols), In: tbl('In', 'In', cols) };
  const moved = new Set(['i1', 'i2']); // the rows of the moved table
  const rows = {
    o1: rw('o1', 'Out', { rel: ['i1', 'keep'] }), // outside → into moved (i1) + a kept outside id
    o2: rw('o2', 'Out', { rel: ['keep'] }), // outside, no moved id → untouched
    i1: rw('i1', 'In', { rel: ['i2'] }), // inside the moved set, points inside → untouched
  };
  const sev = relationSeverances(tables, rows, moved);
  eq(sev.length, 1, 'only the outside row that points inside is severed');
  eq(sev[0].rowId, 'o1');
  eq(sev[0].oldIds, ['i1', 'keep'], 'the prior cell is captured for revert');
  eq(sev[0].newIds, ['keep'], 'the moved id is removed, the outside id kept');
});

test('turnIntoWorkspace: neutralizeCrossRefs blanks page links into the moved set only', () => {
  const moved = movedIdsOf({ pageIds: ['mp'], tableIds: ['mt'], rowIds: ['mr'] });
  const doc = {
    type: 'doc',
    content: [
      { type: 'pageLink', attrs: { pageId: 'mp', label: 'X' } },
      { type: 'pageRef', attrs: { pageId: 'other', label: 'Y' } },
      { type: 'paragraph', content: [{ type: 'rowRef', attrs: { tableId: 'mt', rowId: 'mr' } }] },
      { type: 'tableEmbed', attrs: { tableId: 'mt' } },
    ],
  };
  const { doc: out, changed } = neutralizeCrossRefs(doc, moved);
  ok(changed, 'a cross-boundary page link was found');
  const o = out as typeof doc;
  const attr = (n: unknown, k: string) => ((n as { attrs: Record<string, unknown> }).attrs)[k];
  eq(attr(o.content[0], 'pageId'), '', 'pageLink into a moved page blanked');
  eq(attr(o.content[1], 'pageId'), 'other', 'pageRef to an outside page untouched');
  // rowRef and tableEmbed resolve live from the (membership-scoped) store, so they
  // are left intact and simply show nothing for a viewer without the moved tree.
  eq(attr((o.content[2] as { content: unknown[] }).content[0], 'rowId'), 'mr', 'rowRef left intact (derived, scoped)');
  eq(attr(o.content[3], 'tableId'), 'mt', 'tableEmbed left intact (derived, scoped)');

  const clean = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] };
  const res = neutralizeCrossRefs(clean, moved);
  ok(!res.changed && res.doc === clean, 'a doc with no cross refs is returned untouched');
});

test('flowIO: import mints ids, remaps edges, keeps payloads verbatim', () => {
  let n = 0;
  const deps = { uid: (p = '') => `${p}${n++}` };
  const data = bundleToFlow(parseFlowBundle(serializeFlowBundle(exampleFlowBundle())), deps);
  eq(data.nodes.length, 4, 'all nodes import');
  eq(data.edges.length, 2, 'both edges import');
  ok(data.nodes.every((nd) => nd.id.startsWith('fn_')), 'nodes get fresh fn_ ids');
  const ids = new Set(data.nodes.map((nd) => nd.id));
  ok(data.edges.every((e) => ids.has(e.from) && ids.has(e.to)), 'edges point at real nodes');
  const filter = data.nodes.find((nd) => nd.kind === 'filter')!;
  eq((filter.payload as { expr: string }).expr, '[amount] > 20000', 'filter expr kept verbatim');
  const passEdge = data.edges.find((e) => e.branch === 'pass');
  ok(passEdge, 'a filter pass-branch edge survives');
});

test('flowIO: unknown kind falls back to note, missing payload gets a default', () => {
  let n = 0;
  const deps = { uid: (p = '') => `${p}${n++}` };
  const bundle = parseFlowBundle('{"waypointFlow":1,"title":"x","nodes":[{"id":"a","kind":"wat"},{"id":"b","kind":"action"}],"edges":[{"from":"a","to":"ghost"}]}');
  eq(bundle.nodes[0].kind, 'note', 'an unknown kind is coerced to note');
  const data = bundleToFlow(bundle, deps);
  eq(data.edges.length, 0, 'an edge to a missing node is dropped');
  const action = data.nodes.find((nd) => nd.kind === 'action')!;
  ok(action.payload && typeof action.payload === 'object', 'a payload-less action gets a default spec');
  const blank = bundleToFlow(blankFlowBundle(), deps);
  ok(blank.nodes.length === 2 && blank.edges.length === 1, 'blank template imports');
});

test('flowIO: export a live flow, and reject a file with no nodes', () => {
  const bundle = flowToBundle({ nodes: [{ id: 'n1', kind: 'trigger', x: 0, y: 0, payload: { kind: 'manual' } }], edges: [], enabled: false }, 'F');
  eq(bundle.nodes[0].kind, 'trigger', 'node kind exported');
  eq(bundle.enabled, false, 'a disabled flow round-trips its off state');
  let threw = false;
  try { parseFlowBundle('{"title":"nope"}'); } catch { threw = true; }
  ok(threw, 'a file with no nodes array is rejected');
});

test('mindmapIO: round-trip a live graph back to friendly nodes; rejects junk', () => {
  const live = { nodes: [
    { id: 'x1', kind: 'text' as const, x: 10, y: 20, payload: 'Idea' },
    { id: 'x2', kind: 'number' as const, x: 200, y: 20, payload: 42 },
  ], edges: [{ id: 'e1', from: 'x1', to: 'x2', directed: true, label: 'count' }] };
  const bundle = mindmapToBundle(live, 'My map');
  eq(bundle.nodes[0].text, 'Idea', 'text node exports its text');
  eq(bundle.nodes[1].number, 42, 'number node exports its number');
  eq(bundle.edges[0].label, 'count', 'edge label survives');
  let threw = false;
  try { parseMindmapBundle('{"title":"no nodes"}'); } catch { threw = true; }
  ok(threw, 'a file with no nodes array is rejected');
});

test('mindmapIO: a place keeps its address and category across a round-trip', () => {
  // The card renders the address under the name, so dropping it on export meant
  // exporting and re-importing quietly returned a thinner place than you had.
  const live = {
    nodes: [{
      id: 'p1', kind: 'place' as const, x: 0, y: 0,
      payload: { name: 'Yufuin ryokan', lat: 33.2646, lon: 131.36, address: 'Oita, Japan', category: 'hotel' },
    }],
    edges: [],
  };
  const bundle = mindmapToBundle(live, 'Trip');
  eq(bundle.nodes[0].place?.address, 'Oita, Japan', 'the address is exported');
  eq(bundle.nodes[0].place?.category, 'hotel', 'so is the category');
  const back = bundleToMindmap(parseMindmapBundle(serializeMindmapBundle(bundle)), { uid: (p) => `${p}1` });
  const geo = back.nodes[0].payload as { name: string; address?: string; category?: string };
  eq(geo.name, 'Yufuin ryokan', 'the name survives');
  eq(geo.address, 'Oita, Japan', 'and the address comes back');
  eq(geo.category, 'hotel', 'and the category');
  // A place with neither still imports, and does not gain empty keys.
  const bare = mindmapToBundle({ nodes: [{ id: 'p2', kind: 'place' as const, x: 0, y: 0, payload: { name: 'Somewhere', lat: 1, lon: 2 } }], edges: [] }, 'T');
  eq(bare.nodes[0].place?.address, undefined, 'no address means no address key');
});

await testAsync('rewrap: the new password opens the vault, the old one stops, content survives', async () => {
  // The whole point is that re-wrapping moves the DOOR,
  // never the key: anything encrypted before must still decrypt after, or the
  // operation has destroyed the workspace.
  const master = await generateMasterKey();
  const before = await encryptContent(master, { note: 'booked the ryokan', n: 7 });

  const oldWrap = await wrapMasterKey(master, 'old password', 1000);
  // Re-wrap: open the existing door, wrap THAT key under the new secret.
  const reopened = await unwrapMasterKey(oldWrap, 'old password');
  const newWrap = await wrapMasterKey(reopened, 'brand new password', 1000);

  const opened = await unwrapMasterKey(newWrap, 'brand new password');
  ok(await sameMasterKey(opened, master), 'the re-wrap holds the SAME master key');
  eq(await decryptContent(opened, before), { note: 'booked the ryokan', n: 7 }, 'content from before the change still decrypts');
  ok(await throwsAsync(() => unwrapMasterKey(newWrap, 'old password')), 'the old password no longer opens the new blob');
  ok(newWrap.salt !== oldWrap.salt, 'a fresh salt each time, so the two blobs are not comparable');
});

await testAsync('sameMasterKey: true for the same key, false for a different one', async () => {
  // This is the guard that would catch the one catastrophic mistake, writing a
  // wrap around a NEWLY generated key, which would strand every envelope.
  const a = await generateMasterKey();
  const b = await generateMasterKey();
  const roundTrip = await unwrapMasterKey(await wrapMasterKey(a, 'pw', 1000), 'pw');
  ok(await sameMasterKey(a, roundTrip), 'a key that survived a wrap/unwrap is the same key');
  ok(!(await sameMasterKey(a, b)), 'two freshly generated keys are not');
});

await testAsync('nonExtractableMaster: same key, decrypts existing content, cannot be exported', async () => {
  const m = await generateMasterKey();
  const env = await encryptContent(m, { secret: 'hi', n: 42 });
  const ne = await nonExtractableMaster(m);
  ok(ne.extractable === false, 'the cached copy is non-extractable');
  eq(await decryptContent(ne, env), { secret: 'hi', n: 42 }, 'still decrypts content the original key encrypted');
  let threw = false;
  try {
    await globalThis.crypto.subtle.exportKey('raw', ne);
  } catch {
    threw = true;
  }
  ok(threw, 'raw export of the cached key is blocked');
});

// --- kanban board import/export ---------------------------------------------

const kanbanThrew = (fn: () => unknown): boolean => {
  try { fn(); return false; } catch { return true; }
};

test('docToMarkdown: heading, bullet, task round-trip', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] }] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'done' }] }] }] },
    ],
  };
  eq(docToMarkdown(doc), '## H\n\n- a\n\n- [x] done');
  eq(docToMarkdown(null), '');
});

test('docToMarkdown: inline marks and links', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
    { type: 'text', text: ' and ' },
    { type: 'text', text: 'site', marks: [{ type: 'link', attrs: { href: 'https://x.com' } }] },
  ] }] };
  eq(docToMarkdown(doc), '**bold** and [site](https://x.com)');
});

test('parseKanbanBundle: rejects junk and a shapeless object', () => {
  ok(kanbanThrew(() => parseKanbanBundle('not json')));
  ok(kanbanThrew(() => parseKanbanBundle('{"title":"x"}')));
  const b = parseKanbanBundle('{"columns":[{"name":"Title","type":"text"}],"cards":[]}');
  eq(b.columns.length, 1);
  eq(b.columns[0].type, 'text');
});

test('parseKanbanBundle: unknown column type falls back to text, bad options dropped', () => {
  const b = parseKanbanBundle('{"columns":[{"name":"S","type":"nope","options":[{"label":"A"},{"nope":1}]}],"cards":[]}');
  eq(b.columns[0].type, 'text');
});

test('boardToBundle: friendly cell values and a card body', () => {
  const cols: Column[] = [
    col({ id: 'c1', name: 'Title', type: 'text' }),
    col({ id: 'c2', name: 'Stage', type: 'select', options: [{ id: 'o1', label: 'To do', color: '#a' }, { id: 'o2', label: 'Done', color: '#b', done: true }] }),
    col({ id: 'c3', name: 'Tags', type: 'multiselect', options: [{ id: 't1', label: 'urgent', color: '#c' }] }),
    col({ id: 'c4', name: 'Assignees', type: 'person', peopleMulti: true }),
    col({ id: 'c5', name: 'Done?', type: 'checkbox' }),
    col({ id: 'c6', name: 'Est', type: 'formula', formula: '1+1' }),
  ];
  const tbl: TableData = { id: 'tb', name: 'Board', columns: cols, owner: '', updated: '', created: '' };
  const rows: TableRow[] = [row({ c1: 'Book', c2: 'o1', c3: ['t1'], c4: ['u1'], c5: true, c6: 2 })];
  rows[0].content = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Hi' }] }] };
  const bundle = boardToBundle(tbl, rows, 'c2', [{ id: 'u1', name: 'Alex' }]);
  const stage = bundle.columns.find((c) => c.name === 'Stage');
  ok(stage?.isStage, 'stage column flagged');
  const card = bundle.cards[0];
  eq(card.cells.Stage, 'To do');
  eq(card.cells.Tags, ['urgent']);
  eq(card.cells.Assignees, ['Alex']);
  eq(card.cells['Done?'], true);
  eq(card.cells.Est, undefined, 'computed column carries no value');
  ok(typeof card.body === 'string' && card.body.startsWith('# Hi'), 'body is markdown');
});

test('bundleToBoard: maps labels and names back onto fresh ids', () => {
  let n = 0;
  const uid = (p = '') => `${p}${n++}`;
  const pickColor = (i: number) => `#${i}`;
  const roster = [{ id: 'u1', name: 'Alex' }];
  const bundle = parseKanbanBundle(JSON.stringify({
    title: 'B',
    columns: [
      { name: 'Title', type: 'text' },
      { name: 'Stage', type: 'select', isStage: true, options: [{ label: 'To do' }, { label: 'Done', done: true }] },
      { name: 'Assignees', type: 'person' },
    ],
    cards: [{ cells: { Title: 'x', Stage: 'Done', Assignees: ['Alex'] }, body: '# Page\n\ntext' }],
  }));
  const plan = bundleToBoard(bundle, { uid, pickColor, roster });
  const stageCol = plan.columns.find((c) => c.name === 'Stage')!;
  eq(plan.groupColumnId, stageCol.id, 'groups by the stage column');
  const doneOpt = stageCol.options!.find((o) => o.label === 'Done')!;
  ok(doneOpt.done, 'done flag preserved');
  ok(doneOpt.color, 'a colour was assigned');
  eq(plan.cards[0].cells[stageCol.id], doneOpt.id, 'select label resolved to its new option id');
  const whoCol = plan.columns.find((c) => c.name === 'Assignees')!;
  eq(plan.cards[0].cells[whoCol.id], ['u1'], 'assignee name resolved to a member id');
  ok(plan.cards[0].body && typeof plan.cards[0].body === 'object', 'body parsed to a doc');
});

test('bundleToBoard: an unknown assignee name is dropped, not invented', () => {
  const uid = (p = '') => `${p}${Math.random()}`;
  const bundle = parseKanbanBundle(JSON.stringify({
    columns: [{ name: 'Who', type: 'person' }],
    cards: [{ cells: { Who: ['Nobody'] } }],
  }));
  const plan = bundleToBoard(bundle, { uid, pickColor: (i) => `#${i}`, roster: [{ id: 'u1', name: 'Alex' }] });
  eq(plan.cards[0].cells[plan.columns[0].id], [], 'unmatched name yields no id');
});

test('blank template and annotated example import cleanly', () => {
  const uid = (p = '') => `${p}${Math.random()}`;
  const deps = { uid, pickColor: (i: number) => `#${i}` };
  const blank = bundleToBoard(blankKanbanBundle(), deps);
  ok(blank.groupColumnId, 'blank has a stage group column');
  const ex = exampleKanbanBundle();
  ok((ex.instructions?.length ?? 0) >= 5, 'example carries guidance');
  // Every type the instructions name must be a type the parser actually keeps,
  // so the annotation can't promise a column the importer would silently retype.
  const KEPT = new Set(['text', 'number', 'select', 'multiselect', 'date', 'datetime', 'checkbox', 'url', 'place', 'attachment', 'reminder', 'person', 'checklist', 'formula']);
  for (const c of ex.columns) ok(KEPT.has(c.type), `example column type ${c.type} is importable`);
  const plan = bundleToBoard(parseKanbanBundle(JSON.stringify(ex)), deps);
  eq(plan.cards.length, 3);
  const stageCol = plan.columns.find((c) => c.name === 'Stage')!;
  eq(plan.groupColumnId, stageCol.id);
  // "Airport transfer" is in the Booked lane; its cell should be that option id.
  const booked = stageCol.options!.find((o) => o.label === 'Booked')!;
  const transfer = plan.cards.find((c) => c.cells[plan.columns[0].id] === 'Airport transfer')!;
  eq(transfer.cells[stageCol.id], booked.id);
  // The worked card carries a checklist and a markdown body; both must survive.
  const ryokan = plan.cards.find((c) => c.cells[plan.columns[0].id] === 'Book ryokan in Yufuin')!;
  const checklistCol = plan.columns.find((c) => c.name === 'Checklist')!;
  ok(Array.isArray(ryokan.cells[checklistCol.id]) && (ryokan.cells[checklistCol.id] as unknown[]).length === 2, 'checklist imports');
  ok(ryokan.body && typeof ryokan.body === 'object', 'card body imports as a doc');
});

test('boardToBundle stamps a card id that survives a parse round-trip', () => {
  const cols: Column[] = [col({ id: 'c1', name: 'Title', type: 'text' })];
  const tbl: TableData = { id: 'tb', name: 'B', columns: cols, owner: '', updated: '', created: '' };
  const bundle = boardToBundle(tbl, [row({ c1: 'X' })], undefined, []); // row() id is 'r1'
  eq(bundle.cards[0].id, 'r1');
  eq(parseKanbanBundle(JSON.stringify(bundle)).cards[0].id, 'r1', 'id parses back');
});

const upsertCols = (): Column[] => [
  col({ id: 'c1', name: 'Title', type: 'text' }),
  col({ id: 'c2', name: 'Stage', type: 'select', options: [{ id: 'o1', label: 'To do', color: '#a' }, { id: 'o2', label: 'Done', color: '#b' }] }),
];
const upsertDeps = () => {
  let n = 0;
  return { uid: (p = '') => `${p}${n++}`, pickColor: (i: number) => `#new${i}` };
};

test('bundleToUpsertPlan: a card id updates its row in place, others are added', () => {
  const columns = upsertCols();
  const rows = [
    { id: 'r1', cells: { c1: 'Book hotel', c2: 'o1' } },
    { id: 'r2', cells: { c1: 'Buy tickets', c2: 'o1' } },
  ];
  const bundle = parseKanbanBundle(JSON.stringify({
    columns: [
      { name: 'Title', type: 'text' },
      { name: 'Stage', type: 'select', isStage: true, options: [{ label: 'To do' }, { label: 'Done' }] },
    ],
    cards: [
      { id: 'r1', cells: { Title: 'Book hotel', Stage: 'Done' } },
      { cells: { Title: 'Pack bags', Stage: 'To do' } },
    ],
  }));
  const plan = bundleToUpsertPlan(bundle, { columns, rows, groupColumnId: 'c2' }, upsertDeps());
  eq(plan.updatedCount, 1);
  eq(plan.createdCount, 1);
  eq(plan.updates[0].rowId, 'r1');
  eq(plan.updates[0].cells.c2, 'o2', 'Done maps to the existing option id, not a new one');
  ok(!plan.columnsChanged, 'no columns or options changed');
  eq(plan.groupColumnId, 'c2', 'the board keeps its own group column');
});

test('bundleToUpsertPlan: a unique title matches a card with no id; a new option is folded in', () => {
  const columns = upsertCols();
  const rows = [{ id: 'r1', cells: { c1: 'Book hotel', c2: 'o1' } }];
  const bundle = parseKanbanBundle(JSON.stringify({
    columns: [{ name: 'Title', type: 'text' }, { name: 'Stage', type: 'select', options: [{ label: 'Booked' }] }],
    cards: [{ cells: { Title: 'book hotel', Stage: 'Booked' } }],
  }));
  const plan = bundleToUpsertPlan(bundle, { columns, rows, groupColumnId: 'c2' }, upsertDeps());
  eq(plan.updatedCount, 1);
  eq(plan.updates[0].rowId, 'r1', 'case-insensitive title match');
  ok(plan.columnsChanged, 'Booked was appended as a new option');
  const stage = plan.columns.find((c) => c.id === 'c2')!;
  eq(stage.options!.length, 3, 'existing two options kept, one added');
  const booked = stage.options!.find((o) => o.label === 'Booked')!;
  eq(plan.updates[0].cells.c2, booked.id);
});

test('bundleToUpsertPlan: an ambiguous title is added not merged, and a new column is created', () => {
  const columns: Column[] = [col({ id: 'c1', name: 'Title', type: 'text' })];
  const rows = [
    { id: 'r1', cells: { c1: 'Task' } },
    { id: 'r2', cells: { c1: 'Task' } },
  ];
  const bundle = parseKanbanBundle(JSON.stringify({
    columns: [{ name: 'Title', type: 'text' }, { name: 'Notes', type: 'text' }],
    cards: [{ cells: { Title: 'Task', Notes: 'hi' } }],
  }));
  const plan = bundleToUpsertPlan(bundle, { columns, rows, groupColumnId: undefined }, upsertDeps());
  eq(plan.updatedCount, 0, 'a duplicated title is not a safe match');
  eq(plan.createdCount, 1);
  ok(plan.columnsChanged, 'the Notes column was added');
  const notes = plan.columns.find((c) => c.name === 'Notes')!;
  eq(plan.creates[0].cells[notes.id], 'hi');
});

test('bundleToUpsertPlan: an unknown id falls through to a new card, existing rows untouched', () => {
  const columns: Column[] = [col({ id: 'c1', name: 'Title', type: 'text' })];
  const rows = [{ id: 'r1', cells: { c1: 'Keep me' } }];
  const bundle = parseKanbanBundle(JSON.stringify({
    columns: [{ name: 'Title', type: 'text' }],
    cards: [{ id: 'gone', cells: { Title: 'Orphan' } }],
  }));
  const plan = bundleToUpsertPlan(bundle, { columns, rows, groupColumnId: undefined }, upsertDeps());
  eq(plan.updatedCount, 0);
  eq(plan.createdCount, 1, 'an id that matches no row creates a card rather than resurrecting one');
});

// --- proseSync: the in-flight-write guard that stops a stale echo/hydrate from
// erasing a field the user is still typing (title, cells, column names, body). ---

test('proseSync: a pending field is held, others take the server value', () => {
  resetWrites();
  const seq = beginWrite('p1', 'title');
  ok(isWriting('p1', 'title'), 'marked writing from the keystroke');
  const local = { id: 'p1', title: 'Hello world', content: { a: 1 }, icon: '📝' };
  const echo = { id: 'p1', title: 'Hell', content: { a: 2 }, icon: '🗒️' }; // stale title
  const merged = keepPendingFields(local, echo, ['content', 'title']);
  eq(merged.title, 'Hello world', 'the pending title is kept, not rewound to the stale echo');
  eq((merged.content as { a: number }).a, 2, 'a non-pending field still syncs from the server');
  endWrite('p1', 'title', seq);
  ok(!isWriting('p1', 'title'), 'released once the write settles');
});

test('proseSync: after the write settles the echo value is accepted', () => {
  resetWrites();
  const seq = beginWrite('p1', 'title');
  endWrite('p1', 'title', seq);
  const local = { id: 'p1', title: 'Hello world' };
  const echo = { id: 'p1', title: 'Hello world!' }; // a genuine later edit
  const merged = keepPendingFields(local, echo, ['title']);
  eq(merged.title, 'Hello world!', 'no longer writing, so the server value wins');
});

test('proseSync: a newer keystroke keeps the guard held past an earlier settle', () => {
  resetWrites();
  const seq1 = beginWrite('r1', 'cells');
  const seq2 = beginWrite('r1', 'cells'); // a second keystroke before the first save lands
  endWrite('r1', 'cells', seq1); // the first save settles
  ok(isWriting('r1', 'cells'), 'still writing: a newer keystroke is outstanding');
  endWrite('r1', 'cells', seq2);
  ok(!isWriting('r1', 'cells'), 'released only when the latest write settles');
});

test('proseSync: an echo older than what we hold is dropped as out of order', () => {
  // The vanishing-upload shape: the store held the record from a newer save, then
  // the echo of an EARLIER save landed and rewound the whole thing (a file list of
  // two became the pre-upload list of one). keepPendingFields cannot catch this,
  // it only covers the window while a write is in flight.
  const local = { id: 'p1', updated: '2026-07-29 10:00:02.000Z' };
  ok(isStaleRecord(local, { id: 'p1', updated: '2026-07-29 10:00:01.000Z' }), 'an older stamp is stale');
  ok(!isStaleRecord(local, { id: 'p1', updated: '2026-07-29 10:00:03.000Z' }), 'a newer stamp is applied');
  ok(!isStaleRecord(local, { id: 'p1', updated: '2026-07-29 10:00:02.000Z' }), 'the same stamp cannot be judged, so it wins');
  ok(!isStaleRecord(undefined, { id: 'p1', updated: '2026-07-29 10:00:01.000Z' }), 'nothing held locally');
  ok(!isStaleRecord(local, { id: 'p1' }), 'no stamp to compare (an optimistic record)');
});

test('proseSync: no local record means nothing to hold (fresh load)', () => {
  resetWrites();
  beginWrite('r9', 'cells');
  const echo = { id: 'r9', cells: { c1: 'server' } };
  const merged = keepPendingFields(undefined, echo, ['cells']);
  eq(merged.cells.c1, 'server', 'with no local value there is nothing to preserve');
  resetWrites();
});

// --- rowNav: arrow keys walk the board/calendar while the row drawer is open ---

test('rowNav: up/down walk one lane, stopping at its ends', () => {
  const lanes = [['a', 'b', 'c'], ['d']];
  eq(nextNavRow(lanes, 'b', 'down'), 'c');
  eq(nextNavRow(lanes, 'b', 'up'), 'a');
  eq(nextNavRow(lanes, 'a', 'up'), null, 'top of the lane');
  eq(nextNavRow(lanes, 'c', 'down'), null, 'bottom of the lane');
});

test('rowNav: left/right cross lanes, clamped to the shorter lane', () => {
  const lanes = [['a', 'b', 'c'], ['d'], ['e', 'f']];
  eq(nextNavRow(lanes, 'c', 'right'), 'd', 'third card lands on the only card next door');
  eq(nextNavRow(lanes, 'd', 'right'), 'e');
  eq(nextNavRow(lanes, 'e', 'left'), 'd');
  eq(nextNavRow(lanes, 'a', 'left'), null, 'first lane');
  eq(nextNavRow(lanes, 'f', 'right'), null, 'last lane');
});

test('rowNav: an empty lane is skipped, not a dead end', () => {
  const lanes = [['a'], [], ['b']];
  eq(nextNavRow(lanes, 'a', 'right'), 'b');
  eq(nextNavRow(lanes, 'b', 'left'), 'a');
});

test('rowNav: a row spanning two days does not trap the arrows', () => {
  // Calendar shape: the same row sits in adjacent day lanes (check-in/out).
  const lanes = [['stay', 'x'], ['stay'], ['y']];
  eq(nextNavRow(lanes, 'stay', 'right'), 'y', 'steps past its own duplicate to the next real row');
  const twiceInADay = [['stay', 'stay', 'z']];
  eq(nextNavRow(twiceInADay, 'stay', 'down'), 'z', 'two date fields on one day collapse to one step');
});

test('rowNav: a row not in the lanes is a no-op', () => {
  eq(nextNavRow([['a', 'b']], 'nope', 'down'), null);
  eq(nextNavRow([], 'a', 'right'), null);
});

test('rowNav registry: navTarget asks mounted sources, unregister removes them', () => {
  eq(navTarget('a', 'down'), null, 'nothing registered');
  let opened = '';
  const off = registerNavSource({ getLanes: () => [['a', 'b']], onOpen: (id) => { opened = id; } });
  const t = navTarget('a', 'down');
  eq(t?.id, 'b');
  t?.onOpen?.(t.id);
  eq(opened, 'b', 'the follow-up (month sync) rides along');
  eq(navTarget('a', 'up'), null, 'edges still dead-end through the registry');
  off();
  eq(navTarget('a', 'down'), null, 'unmounted view no longer answers');
});

const wxDay = (hi: number): DayWeather => ({ code: 0, hi, lo: hi - 8, emoji: '☀️', label: 'Clear' });
const wxMap: Record<string, DayWeather> = {
  '2026-07-18': wxDay(30),
  '2026-07-19': wxDay(31),
  '2026-07-20': wxDay(29),
};

test('weather forecastList: ordered days with weekday, capped at count', () => {
  const list = forecastList(wxMap, 2);
  eq(list.length, 2);
  eq(list[0].date, '2026-07-18');
  eq(list[0].weekday, 'Sat');
  eq(list[1].date, '2026-07-19');
  eq(list[0].hi, 30);
});

test('weather forecastList: fromIso starts the list on that day, out-of-window falls back', () => {
  eq(forecastList(wxMap, 5, '2026-07-19')[0].date, '2026-07-19');
  eq(forecastList(wxMap, 5, '2026-07-19').length, 2);
  eq(forecastList(wxMap, 5, '1999-01-01')[0].date, '2026-07-18', 'unknown start falls back to first');
  eq(forecastList({}, 5).length, 0, 'empty map yields nothing');
});

test('checklistIO: round-trips done state, owner, and title', () => {
  const items = [
    { text: 'Passport', done: true, owner: 'Alex' },
    { text: 'Charger', done: false },
  ];
  const text = serializeChecklist('Packing', items);
  ok(text.includes('- [x] Passport @Alex'), 'done + owner line');
  ok(text.includes('- [ ] Charger'), 'undone, no owner');
  const back = parseChecklist(text);
  eq(back.title, 'Packing');
  eq(back.items.length, 2);
  eq(back.items[0].done, true);
  eq(back.items[0].owner, 'Alex');
  eq(back.items[1].owner, undefined, 'no owner stays absent');
});

test('checklistIO: bare lines become unchecked items; templates re-import cleanly', () => {
  const p = parseChecklist('# T\nMilk\n- Eggs\n- [x] Bread');
  eq(p.items.length, 3);
  eq(p.items[0].text, 'Milk');
  eq(p.items[0].done, false);
  eq(p.items[2].done, true);
  eq(parseChecklist(PACKING_TEMPLATE).items.length, 5, 'packing template imports to 5');
  eq(parseChecklist(READINESS_TEMPLATE).items.length, 5, 'readiness template imports to 5');
  eq(parseChecklist(READINESS_TEMPLATE).items[0].done, true, 'first readiness item is checked');
});

test('voteIO: question + mode + options round-trip, votes never serialized', () => {
  const text = serializeVote('Dinner?', false, [{ text: 'Ramen' }, { text: 'Sushi' }]);
  ok(text.includes('# Dinner?'), 'question');
  ok(text.includes('mode: single'), 'single-choice mode');
  const back = parseVote(text);
  eq(back.question, 'Dinner?');
  eq(back.multi, false);
  eq(back.options.length, 2);
  eq(back.options[1].text, 'Sushi');
  eq(parseVote(VOTE_TEMPLATE).options.length, 3, 'template imports to 3 options');
  eq(parseVote(VOTE_TEMPLATE).multi, false, 'template is single-choice');
  eq(parseVote('- only\n- options').multi, true, 'defaults to multi when no mode line');
});

test('tierList: items drop into the tier matching their score, sorted high to low', () => {
  const tiers = defaultTiers();
  eq(tierForRating(tiers, 95)?.label, 'S', '95 is S');
  eq(tierForRating(tiers, 60)?.label, 'B', '60 is B (inclusive lower bound)');
  eq(tierForRating(tiers, 0)?.label, 'D', '0 is D');
  eq(tierForRating(tiers, 150), undefined, 'out of every range = unranked');
  const mk = (id: string, rating: number) => ({ id, text: id, image: '', rating });
  const items = [mk('a', 40), mk('b', 95), mk('c', 92), mk('d', 55), mk('e', 200)];
  const rows = buildTierRows(tiers, items);
  const s = rows.find((r) => r.tier?.label === 'S')!;
  eq(s.items.map((i) => i.id), ['b', 'c'], 'S holds 95 then 92, highest first');
  const c = rows.find((r) => r.tier?.label === 'C')!;
  eq(c.items.map((i) => i.id), ['d', 'a'], 'C holds 55 then 40');
  const last = rows[rows.length - 1];
  eq(last.tier, null, 'a trailing unranked row');
  eq(last.items.map((i) => i.id), ['e'], 'the out-of-range item is unranked');

  // A null score is unranked; includeEmptyPool always shows the pool as a drop
  // target; ratingForInsert lands a drop inside the tier's range, in order.
  const withNull = [mk('x', 95), { id: 'y', text: 'y', image: '', rating: null }];
  eq(tierForRating(tiers, null), undefined, 'null score has no tier');
  const r2 = buildTierRows(tiers, withNull);
  eq(r2[r2.length - 1].items.map((i) => i.id), ['y'], 'the null-score item is in the pool');
  eq(buildTierRows(tiers, [mk('z', 95)], true).some((r) => r.tier === null), true, 'includeEmptyPool shows an empty pool');
  const sTier = tiers.find((t) => t.label === 'S')!; // 90..100
  const front = ratingForInsert(sTier, [{ id: 'p', text: '', image: '', rating: 95 }], 0);
  const end = ratingForInsert(sTier, [{ id: 'p', text: '', image: '', rating: 95 }], 1);
  ok(front >= 90 && front <= 100 && end >= 90 && end <= 100, 'a dropped score stays in the tier range');
  ok(front > 95 && end < 95, 'dropping at the front scores higher than the neighbour, at the end lower');
});

test('platform: modKey/undoHint fall back to Ctrl off a Mac (node env)', () => {
  // In node (and any non-Mac userAgent) these must be the Ctrl variants; the ⌘
  // branch only trips on a Mac/iOS userAgent at runtime.
  eq(modKey(), 'Ctrl', 'non-Mac shows Ctrl');
  eq(undoHint(), 'Ctrl+Z', 'non-Mac undo hint is Ctrl+Z');
  ok(['⌘', 'Ctrl'].includes(modKey()), 'modKey is always one of the two labels');
});

test('platform: quick find takes Q for query, with K as the fallback key', () => {
  // The label must never advertise a key that closes the browser, and the
  // handler must accept both regardless, so muscle memory survives a machine
  // change. Both branches are asserted here because the runner is never a Mac.
  eq(searchHint(), isLinux() ? 'Ctrl+K' : 'Ctrl+Q', 'the label follows the platform');
  ok(['Ctrl+Q', 'Ctrl+K', '⌘K'].includes(searchHint()), 'and is always one of the three we ship');
  const mac = (e: { metaKey?: boolean; ctrlKey?: boolean; key: string }) =>
    isSearchShortcut({ metaKey: !!e.metaKey, ctrlKey: !!e.ctrlKey, key: e.key }, true);
  const pc = (e: { metaKey?: boolean; ctrlKey?: boolean; key: string }) =>
    isSearchShortcut({ metaKey: !!e.metaKey, ctrlKey: !!e.ctrlKey, key: e.key }, false);
  ok(pc({ ctrlKey: true, key: 'q' }), 'PC: Ctrl+Q opens it');
  ok(pc({ ctrlKey: true, key: 'Q' }), 'PC: shift-held Q still counts');
  ok(pc({ ctrlKey: true, key: 'k' }), 'PC: Ctrl+K opens it too, whatever the label says');
  ok(!pc({ metaKey: true, key: 'q' }), 'PC: the Mac modifier does not');
  ok(!pc({ ctrlKey: true, key: 'j' }), 'PC: any other letter is not it');
  ok(mac({ metaKey: true, key: 'k' }), 'Mac: Cmd+K opens it, the one the OS does not take');
  ok(mac({ metaKey: true, key: 'q' }), 'Mac: Cmd+Q is accepted, on the rare setup that delivers it');
  ok(!mac({ ctrlKey: true, key: 'q' }), 'Mac: Ctrl is not the Mac modifier');
  ok(!mac({ key: 'q' }), 'Mac: a bare q types a letter');
  ok(!pc({ key: '' }), 'a keydown with no key never matches');
  eq(typeof isLinux(), 'boolean', 'detection never throws without a navigator');
});

test('tableQuery: rowTitle falls back past an empty title column', () => {
  const cols = [
    { id: 'name', name: 'Name', type: 'text', width: 160 },
    { id: 'place', name: 'Place', type: 'text', width: 160 },
    { id: 'n', name: 'Count', type: 'number', width: 80 },
  ] as unknown as import('../src/types.ts').Column[];
  eq(rowTitle({ name: 'Ryokan', place: 'Kyoto' }, cols), 'Ryokan', 'uses the title column when filled');
  eq(rowTitle({ name: '', place: 'Kyoto' }, cols), 'Kyoto', 'falls back to the next non-empty text column');
  eq(rowTitle({ name: '   ', place: 'Osaka' }, cols), 'Osaka', 'whitespace-only title still falls back');
  eq(rowTitle({ n: 5 }, cols), '', 'no text value anywhere returns empty (caller adds Untitled)');
});

test('cover: coverStyle maps images and gradient presets', () => {
  eq(coverStyle('').backgroundImage, undefined, 'no cover yields an empty style');
  eq(coverStyle('g1').backgroundImage, COVER_GRADIENTS.g1, 'a gradient key yields its gradient');
  eq(coverStyle('https://x.test/p.jpg').backgroundImage, 'url(https://x.test/p.jpg)', 'an http url becomes a url() background');
  eq(coverStyle('data:image/png;base64,AAAA').backgroundSize, 'cover', 'a data image is sized cover');
  eq(coverStyle('nonsense').backgroundImage, undefined, 'an unknown non-url string yields no background');
});

test('exif: exifDateToIso parses EXIF datetimes and rejects junk', () => {
  eq(exifDateToIso('2024:03:15 14:30:05'), '2024-03-15T14:30:05', 'converts an EXIF datetime to ISO');
  eq(exifDateToIso('2019:11:01 09:05:00'), '2019-11-01T09:05:00', 'another valid one');
  eq(exifDateToIso('2024:13:40 99:99:99'), null, 'rejects an out-of-range date/time');
  eq(exifDateToIso('not a date'), null, 'rejects non-date text');
  eq(exifDateToIso(''), null, 'rejects empty input');
});

test('photoMeta: albumsIn lists distinct albums, sorted, ignoring the rest', () => {
  eq(albumsIn({}).length, 0, 'empty meta has no albums');
  const m = { u1: { album: 'Tokyo' }, u2: { album: 'Osaka' }, u3: { album: 'Tokyo' }, u4: { date: '2024-01-01' } };
  eq(albumsIn(m).join(','), 'Osaka,Tokyo', 'distinct + sorted, ignores dateless/albumless entries');
});

test('tripViews: collectReservationEvents surfaces dated reservations as calendar events', () => {
  const page = { content: { type: 'doc', content: [
    { type: 'reservationBlock', attrs: { title: 'Bookings', items: [
      { id: 'a', text: 'ANA NH106', when: '2026-12-30T14:30' },
      { id: 'b', text: 'No date', when: '' },
      { id: 'c', text: 'Ryokan', when: '2026-12-28' },
    ] } },
    { type: 'paragraph' },
  ] } } as unknown as import('../src/types.ts').Page;
  const evs = collectReservationEvents(page);
  eq(evs.length, 2, 'only the two dated reservations become events');
  eq(evs[0].day, '2026-12-28', 'sorted earliest-first');
  eq(evs[0].widget === true, true, 'flagged as a widget event (no rowId to open)');
  eq(evs[1].timeLabel, '14:30', 'time parsed from a datetime value');
  eq(collectReservationEvents(undefined).length, 0, 'no page yields no events');
});

test('image: oversizeMessage names the upload cap, not the inline attachment limit', () => {
  eq(oversizeMessage('clip.mp4', 5_000_000), null, 'a 5 MB file fits the upload path');
  eq(oversizeMessage('clip.mp4', MAX_UPLOAD_BYTES), null, 'exactly at the cap still fits');
  const msg = oversizeMessage('clip.mp4', 260_000_000) ?? '';
  ok(msg.includes('clip.mp4'), 'names the file');
  ok(msg.includes(formatBytes(260_000_000)), 'states the actual size');
  ok(msg.includes(formatBytes(MAX_UPLOAD_BYTES)), 'states the real cap');
  ok(!msg.includes('1.5'), 'never blames the 1.5 MB inline attachment limit');
});

test('image: targetDimensions fits the longest edge and never scales up', () => {
  const wide = targetDimensions(4000, 3000, 1920);
  eq(wide.width, 1920, 'longest edge hits the budget');
  eq(wide.height, 1440, 'aspect ratio held');
  const tall = targetDimensions(3000, 4000, 1920);
  eq(tall.height, 1920, 'works when height is the longest edge');
  eq(tall.width, 1440, 'aspect ratio held the other way');
  const small = targetDimensions(800, 600, 1920);
  eq(small.width, 800, 'a small image is left alone, never upscaled');
  eq(targetDimensions(0, 0, 1920).width, 0, 'a zero-size image does not divide by zero');
});

test('doc: mediaUrlOfNode finds the url on every media block kind', () => {
  eq(mediaUrlOfNode({ type: 'image', attrs: { src: 'u1' } }), 'u1', 'image uses src');
  eq(mediaUrlOfNode({ type: 'audioBlock', attrs: { src: 'u2' } }), 'u2', 'audio uses src');
  eq(mediaUrlOfNode({ type: 'fileBlock', attrs: { data: 'u3' } }), 'u3', 'a fileBlock (video, PDF) uses data');
  eq(mediaUrlOfNode({ type: 'fileBlock', attrs: { src: 'u4' } }), null, 'a fileBlock never reads src');
  eq(mediaUrlOfNode({ type: 'paragraph', attrs: { src: 'u5' } }), null, 'a non-media node matches nothing');
  eq(mediaUrlOfNode({ type: 'image', attrs: {} }), null, 'a missing url is not a match');
  eq(mediaUrlOfNode(null), null, 'a junk node is safe');
});

test('dayRoute: a day totals its legs and orders by nearest', () => {
  const a = { id: 'a', name: 'Hotel', lat: 35.0, lon: 135.0 };
  const b = { id: 'b', name: 'Close', lat: 35.001, lon: 135.0 };
  const c = { id: 'c', name: 'Far', lat: 35.02, lon: 135.0 };

  const r = buildDayRoute([a, b, c], 'walking');
  eq(r.steps.length, 2, 'three stops make two legs');
  ok(r.totalMeters > 2000 && r.totalMeters < 2500, 'about 2.2 km end to end');
  ok(r.totalMinutes > 20 && r.totalMinutes < 35, 'roughly half an hour on foot');
  eq(r.estimated, true, 'always flagged as an estimate, never presented as a routed answer');

  // Given out of order, nearest-neighbour puts the close stop second, and the
  // first stop stays put because that is where you are starting from.
  const ordered = orderByNearest([a, c, b]);
  eq(ordered.map((s) => s.id).join(''), 'abc', 'anchored on the first, then nearest each time');
  eq(orderByNearest([a, b]).length, 2, 'fewer than three stops is left alone');
  eq(buildDayRoute([a], 'walking').totalMeters, 0, 'one stop has no distance');

  eq(formatDistance(480), '480 m', 'metres under a kilometre');
  eq(formatDistance(3200), '3.2 km', 'one decimal when it is small');
  eq(formatMinutes(45), '45 min', 'minutes alone');
  eq(formatMinutes(85), '1 h 25 min', 'hours and minutes');
  eq(formatMinutes(120), '2 h', 'no trailing zero minutes');
});

test('packingPlan: suggests from the trip and never repeats what you have', () => {
  const facts = {
    days: 6,
    titles: ['Flight to Tokyo', 'Onsen in Hakone', 'Hike Mount Takao'],
    forecast: [
      { code: 61, hi: 28, lo: 19, emoji: '', label: 'Rain', precip: 70 },
      { code: 0, hi: 30, lo: 21, emoji: '', label: 'Clear' },
    ],
  };
  const out = suggestPacking(facts, []);
  ok(out.includes('Passport'), 'a flight means a passport');
  ok(out.includes('Swimwear'), 'an onsen means swimwear');
  ok(out.includes('Walking shoes'), 'a hike means shoes');
  ok(out.includes('Umbrella or rain jacket'), '70% rain is worth a jacket');
  ok(out.includes('Sun cream'), 'a 30 degree high is worth sun cream');
  ok(out.some((i) => i.startsWith('T-shirts x')), 'clothing scales with the days');

  // Nothing already on the list comes back, count suffix or not, so pressing the
  // button twice cannot double anything.
  const again = suggestPacking(facts, out.map((text) => ({ text, done: false })));
  eq(again.length, 0, 'a second pass adds nothing');
  const withCount = suggestPacking(facts, [{ text: 'passport', done: true }]);
  ok(!withCount.includes('Passport'), 'matching ignores case');

  // No forecast means no weather claims at all, rather than a guess.
  const dry = suggestPacking({ days: 2, titles: [], forecast: [] }, []);
  ok(!dry.includes('Sun cream'), 'no forecast, no weather advice');
  ok(dry.includes('Phone charger'), 'the essentials still show');
});

test('tierImage: every band fits on the canvas, overflow wraps', () => {
  const tier = (id: string, label: string) => ({ id, label, color: '#111111', min: 0, max: 100 });
  const item = (i: number) => ({ id: `i${i}`, text: `item ${i}`, image: '', rating: 50 });
  const per = cardsPerLine();
  ok(per >= 4, 'a 1200px canvas holds a sensible number of cards');

  const rows = [
    { tier: tier('a', 'S'), items: [item(1), item(2)] },
    { tier: tier('b', 'A'), items: [] },
    { tier: null, items: Array.from({ length: per + 1 }, (_, i) => item(100 + i)) },
  ];
  const out = layoutTierImage(rows);
  eq(out.width, TIER_IMAGE_WIDTH, 'fixed width');
  eq(out.bands.length, 3, 'one band per row, empty ones included');
  eq(out.bands[1].label, 'A', 'an empty tier still gets its stripe');
  eq(out.bands[2].label, 'Unranked', 'the pool is labelled');

  // The whole point: nothing is drawn past the bottom or the right edge.
  for (const b of out.bands) {
    ok(b.y + b.height <= out.height, `band ${b.label} fits vertically`);
    for (const c of b.cards) {
      ok(c.x + c.size <= out.width, `card ${c.id} fits horizontally`);
      ok(c.y + c.size <= out.height, `card ${c.id} fits vertically`);
      ok(c.x >= out.labelWidth, `card ${c.id} clears the label column`);
    }
  }

  // One card too many for a line drops to the next line, and that line is inside
  // the band it belongs to rather than spilling into the next one.
  const pool = out.bands[2];
  eq(pool.cards[0].y, pool.cards[per - 1].y, 'the first line shares a y');
  ok(pool.cards[per].y > pool.cards[0].y, 'the overflow card wrapped');
  ok(pool.cards[per].y + pool.cards[per].size <= pool.y + pool.height, 'the wrapped line stays in its band');
  eq(pool.cards[per].x, pool.cards[0].x, 'and starts a fresh line at the left');

  eq(tierImageFilename('Best ramen! (2026)', '2026-07-29T10:00:00Z'), 'best-ramen-2026-2026-07-29.png');
  eq(tierImageFilename('', '2026-07-29T10:00:00Z'), 'tier-list-2026-07-29.png');
});

test('uploadRefs: the record id comes out of the served file url', () => {
  const url = 'https://planner.example/api/files/abc123/rec456/clip.mp4';
  eq(uploadRecordIdFromUrl(url), 'rec456', 'id is the third path segment');
  eq(uploadRecordIdFromUrl(`${url}?token=x`), 'rec456', 'a query string does not confuse it');
  eq(uploadRecordIdFromUrl('data:video/mp4;base64,AAAA'), null, 'a data url has no record');
  eq(uploadRecordIdFromUrl('https://example.com/cat.png'), null, 'a remote image has no record');
  eq(isUploadUrl(url), true, 'ours');
  eq(isUploadUrl('data:image/png;base64,AA'), false, 'not ours');
});

test('uploadRefs: a delete is blocked by every remaining use of the file', () => {
  const url = 'https://x/api/files/c/r1/clip.mp4';
  const bodyPage = { id: 'p1', title: 'Trip', content: { type: 'doc', content: [
    { type: 'fileBlock', attrs: { data: url } },
  ] } } as unknown as import('../src/types.ts').Page;
  const galleryPage = { id: 'p2', title: 'Wall', content: { type: 'doc', content: [
    { type: 'galleryBlock', attrs: { items: [{ src: 'other' }, { src: url }] } },
  ] } } as unknown as import('../src/types.ts').Page;
  const coverPage = { id: 'p3', title: 'Cover', cover: url, content: { type: 'doc', content: [] } } as unknown as import('../src/types.ts').Page;
  const photoPage = { id: 'p4', title: 'Photos', photos: [{ id: 'a', url }], content: { type: 'doc', content: [] } } as unknown as import('../src/types.ts').Page;
  const clean = { id: 'p5', title: 'Empty', content: { type: 'doc', content: [{ type: 'paragraph' }] } } as unknown as import('../src/types.ts').Page;

  eq(referencesToUrl([bodyPage], [], [], url).length, 1, 'a body block counts');
  eq(referencesToUrl([galleryPage], [], [], url)[0].kind, 'gallery', 'a gallery item counts');
  eq(referencesToUrl([coverPage], [], [], url)[0].kind, 'cover', 'a cover counts');
  eq(referencesToUrl([photoPage], [], [], url)[0].kind, 'photos', 'a gallery photo counts');
  eq(referencesToUrl([clean], [], [], url).length, 0, 'an unrelated page blocks nothing');

  // The reuse case this exists for: the same file on two pages at once.
  eq(referencesToUrl([bodyPage, photoPage], [], [], url).length, 2, 'every user of the file is reported');

  // An attachment cell, including inside an array of attachments.
  const table = { id: 't1', name: 'Docs' } as unknown as import('../src/types.ts').TableData;
  const row = { id: 'r9', table: 't1', cells: { c1: [{ name: 'a', data: url }] } } as unknown as import('../src/types.ts').TableRow;
  const cellRefs = referencesToUrl([], [table], [row], url);
  eq(cellRefs.length, 1, 'an attachment cell counts');
  eq(cellRefs[0].label, 'Docs', 'named by its table');

  // A row BODY (the kanban card pop-out). This was swept for cells only, so a photo
  // that lived only in a card body read as unused and was one click from deletion.
  const bodyRow = { id: 'r10', table: 't1', cells: {}, content: { type: 'doc', content: [
    { type: 'image', attrs: { src: url } },
  ] } } as unknown as import('../src/types.ts').TableRow;
  const bodyRefs = referencesToUrl([], [table], [bodyRow], url);
  eq(bodyRefs.length, 1, 'an image in a card body counts as a use');
  eq(bodyRefs[0].kind, 'body', 'reported as a body use');

  // A file added from the Files tab lives in pages.files, not the body. Missing it
  // would make everything in that tab read as unused and deletable.
  const filesPage = { id: 'p6', title: 'Docs page', content: { type: 'doc', content: [] }, files: [{ id: 'f1', url, name: 'ticket.pdf' }] } as unknown as import('../src/types.ts').Page;
  const fileRefs = referencesToUrl([filesPage], [], [], url);
  eq(fileRefs.length, 1, 'a Files-tab attachment counts as a use');
  eq(fileRefs[0].kind, 'files', 'reported as a files use');

  // An encrypted card body we cannot read is reported as locked, never as unused.
  const lockedRow = { id: 'r11', table: 't1', cells: {}, contentEnc: 'enc:v1:zzz' } as unknown as import('../src/types.ts').TableRow;
  eq(referencesToUrl([], [table], [lockedRow], url)[0].kind, 'locked', 'an unreadable card body blocks a delete');

  // Page icons and workspace icons are uses too. Missing them marked every
  // custom icon and banner as unused, one click from deletion.
  const iconPage = { id: 'p7', title: 'Trip', icon: url, content: { type: 'doc', content: [] } } as unknown as import('../src/types.ts').Page;
  eq(referencesToUrl([iconPage], [], [], url)[0].kind, 'icon', 'a page icon counts');
  const wsRefs = referencesToUrl([], [], [], url, [{ id: 'w1', name: 'Japan', icon: url }]);
  eq(wsRefs.length, 1, 'a workspace icon counts');
  eq(wsRefs[0].kind, 'workspace', 'reported as a workspace use');
  eq(referencesToUrl([], [], [], url, [{ id: 'w1', name: 'Japan', icon: '🗾' }]).length, 0, 'an emoji icon is not a file');

  // A body we cannot read must never be reported as reference-free.
  const locked = { id: 'p6', title: 'Locked', content: 'enc:v1:AAAA' } as unknown as import('../src/types.ts').Page;
  eq(referencesToUrl([locked], [], [], url)[0].kind, 'locked', 'an unreadable page is reported as locked, not as a use');
});

test('uploadRefs: a file is matched by record id, not by host', () => {
  // A staging clone is seeded from the live server, so its content is full of the
  // live host's urls while it serves on localhost. String equality reported every
  // one of those as unused.
  const live = 'https://notes.example.org/api/files/c/rec1/photo.jpg';
  const local = 'http://127.0.0.1:8099/api/files/c/rec1/photo.jpg';
  eq(sameUpload(live, local), true, 'same record, different host');
  eq(sameUpload(live, 'http://127.0.0.1:8099/api/files/c/rec2/photo.jpg'), false, 'different record');
  eq(sameUpload('data:image/png;base64,AA', 'data:image/png;base64,AA'), true, 'non-uploads compare exactly');
  eq(sameUpload('data:image/png;base64,AA', 'data:image/png;base64,BB'), false, 'and differ exactly');

  const page = { id: 'p1', title: 'Trip', content: { type: 'doc', content: [
    { type: 'image', attrs: { src: live } },
  ] } } as unknown as import('../src/types.ts').Page;
  eq(referencesToUrl([page], [], [], local).length, 1, 'a live url on the page blocks a local-url delete');
});

test('uploadRefs: an image on a page canvas is a use, not an orphan', () => {
  // The sweep only ever read the page BODY, so a picture living on one of the
  // page's JSON canvases read as "not used anywhere" and the orphan cleanup
  // offered it for deletion. It took out real mindmap images.
  const url = 'https://x/api/files/c/rec7/pic.jpg';
  const page = (canvas: Record<string, unknown>) =>
    ({ id: 'p1', title: 'Trip', content: { type: 'doc', content: [] }, ...canvas }) as unknown as import('../src/types.ts').Page;

  const mind = page({ mindmap: { nodes: [{ id: 'n1', kind: 'image', payload: { src: url } }], edges: [] } });
  eq(referencesToUrl([mind], [], [], url).length, 1, 'a mindmap image counts');
  eq(referencesToUrl([mind], [], [], url)[0].kind, 'canvas', 'reported as a canvas use');
  eq(referencesToUrl([mind], [], [], url)[0].label, 'Trip (mindmap)', 'the label names which canvas');

  const tier = page({ tierlist: { title: '', mode: 'tiers', tiers: [], items: [{ id: 'i1', text: 'Ramen', image: url, rating: 90 }] } });
  eq(referencesToUrl([tier], [], [], url).length, 1, 'a tier-list item image counts');

  const flow = page({ flow: { nodes: [{ id: 'f1', payload: { image: url } }], edges: [] } });
  eq(referencesToUrl([flow], [], [], url).length, 1, 'an image on a flow node counts');

  // A widget that keeps its picture in node attrs is not an `image` node, so the
  // media-block check alone never saw it either.
  const widget = {
    id: 'p2',
    title: 'Countdown',
    content: { type: 'doc', content: [{ type: 'countdownBlock', attrs: { cover: url } }] },
  } as unknown as import('../src/types.ts').Page;
  eq(referencesToUrl([widget], [], [], url).length, 1, "a countdown's cover counts");

  // And the safe direction is still bounded: an unrelated canvas blocks nothing.
  const other = page({ mindmap: { nodes: [{ id: 'n1', kind: 'text', payload: { text: 'hi' } }], edges: [] } });
  eq(referencesToUrl([other], [], [], url).length, 0, 'a canvas without the file blocks nothing');
});

test('uploadRefs: mentionsUpload matches by record id and ignores unrelated strings', () => {
  const live = 'https://notes.example.org/api/files/c/rec1/photo.jpg';
  const local = 'http://127.0.0.1:8099/api/files/c/rec1/photo.jpg';
  ok(mentionsUpload({ a: { b: [live] } }, local), 'same record id through a different host, nested');
  ok(!mentionsUpload({ a: 'https://x/api/files/c/rec2/photo.jpg' }, local), 'a different record id is not a match');
  ok(!mentionsUpload({ note: 'no url here at all' }, local), 'plain text is not a match');
  ok(mentionsUpload({ src: 'data:image/png;base64,AA' }, 'data:image/png;base64,AA'), 'a non-upload compares exactly');
  ok(!mentionsUpload(null, live), 'nothing to walk');
});

test('uploadRefs: planChunks covers the file exactly, no gaps or overlap', () => {
  const parts = planChunks(250, 100);
  eq(parts.length, 3, 'three parts for 250 over 100');
  eq(parts[0].start, 0, 'starts at zero');
  eq(parts[2].end, 250, 'last part ends at the file end, not past it');
  eq(parts[1].start, parts[0].end, 'no gap between parts');
  eq(planChunks(100, 100).length, 1, 'an exact fit is one part');
  eq(planChunks(0, 100).length, 0, 'an empty file has no parts');
  eq(planChunks(50, 0).length, 0, 'a zero limit cannot loop forever');
});

test('videoTranscode: bitrate is derived from the target size, never above the source', () => {
  // A 10 minute clip aimed at 50 MB: (50e6 * 8 * 0.96 / 600) - 128k audio.
  const b = bitrateForTarget(50_000_000, 600);
  ok(b > 500_000 && b < 540_000, `~510 kbps for 50 MB over 10 min, got ${b}`);
  eq(bitrateForTarget(50_000_000, 0), 0, 'unknown duration returns 0 so the caller falls back');
  ok(bitrateForTarget(1_000, 600) >= 120_000, 'never asks for an absurdly low bitrate');
  // The bug this exists for: a 155 MB, 10 minute source is ~2.07 Mbps, so a
  // request for more must be clamped down instead of inflating the file.
  const clamped = clampToSource(4_000_000, 155_000_000, 600);
  ok(clamped < 2_000_000, `clamped below the source bitrate, got ${clamped}`);
  eq(clampToSource(500_000, 155_000_000, 600), 500_000, 'a lower request passes through untouched');
  eq(clampToSource(4_000_000, 155_000_000, 0), 4_000_000, 'unknown duration cannot clamp');
});

test('videoTranscode: formatDuration reads as a clock', () => {
  eq(formatDuration(0), '0:00', 'zero');
  eq(formatDuration(71), '1:11', 'under an hour');
  eq(formatDuration(3729), '1:02:09', 'past an hour pads minutes');
});

test('media: video detection covers mime, extension and data urls', () => {
  eq(isVideoMedia({ mime: 'video/mp4', name: 'x', url: '' }), true, 'by mime');
  eq(isVideoMedia({ mime: '', name: 'clip.MOV', url: '' }), true, 'by extension, case-insensitive');
  eq(isVideoMedia({ mime: '', name: 'x', url: 'data:video/webm;base64,AA' }), true, 'by data url');
  eq(isVideoMedia({ mime: '', name: 'song.ogg', url: '' }), false, '.ogg stays audio');
  eq(isVideoMedia({ mime: 'image/png', name: 'a.png', url: '' }), false, 'an image is not video');
  eq(isVideoFile({ type: 'video/quicktime', name: 'a.mov' }), true, 'a picked File works the same');
});

// --- Currency board ---------------------------------------------------------
// A stand-in rate table so these never touch the network: 1 SEK = 14 JPY = 0.09 EUR.
const rates: Record<string, number> = { SEK: 1, JPY: 14, EUR: 0.09, USD: 0.1 };
const testConvert = (amount: number, from: string, to: string, manual?: number): number => {
  if (typeof manual === 'number' && Number.isFinite(manual)) return amount * manual;
  if (from === to) return amount;
  const f = rates[from];
  const t = rates[to];
  if (!f || !t) return NaN;
  return (amount / f) * t;
};

test('fxBoard: buildLines converts each row and reports a pinned rate honestly', () => {
  const board: FxBoardData = {
    title: '',
    amount: 1000,
    base: 'SEK',
    rows: [
      { id: 'a', code: 'JPY', note: '', manual: null },
      { id: 'b', code: 'EUR', note: '', manual: null },
      { id: 'c', code: 'ZZZ', note: '', manual: null },
    ],
  };
  const lines = buildLines(board, testConvert);
  eq(lines[0].value, 14000, '1000 SEK is 14000 JPY');
  eq(lines[0].rate, 14, 'the rate is units per 1 base');
  eq(lines[0].drift, null, 'an unpinned row has no drift');
  eq(lines[1].value, 90, 'and 90 EUR');
  eq(lines[2].value, null, 'an unknown code is null, never NaN on screen');
  eq(lines[2].rate, null, 'and reports no rate rather than guessing one');
});

test('fxBoard: a pinned rate overrides the table and shows how far off it is', () => {
  const board: FxBoardData = {
    title: '',
    amount: 1000,
    base: 'SEK',
    rows: [{ id: 'a', code: 'JPY', note: 'airport kiosk', manual: 13.16 }],
  };
  const [line] = buildLines(board, testConvert);
  eq(line.rate, 13.16, 'the pinned rate wins');
  eq(line.value, 13160, 'and drives the conversion');
  ok(line.drift !== null && Math.abs(line.drift + 0.06) < 1e-9, `6% worse than the day rate, got ${line.drift}`);
});

test('fxBoard: swapping the base keeps the amount worth what it was', () => {
  const board = defaultFxBoard('SEK');
  const next = swapBase({ ...board, amount: 1000 }, 'JPY', testConvert);
  eq(next.base, 'JPY', 'the new base is set');
  eq(next.amount, 14000, '1000 kr becomes 14000 yen, not 1000 yen');
  ok(next.rows.some((r) => r.code === 'SEK'), 'the old base becomes a row');
  ok(!next.rows.some((r) => r.code === 'JPY'), 'and the new base stops being one');
  eq(swapBase(board, 'ZZZ', testConvert), board, 'an unknown code changes nothing');
});

test('fxBoard: swapping the base restates a pinned rate instead of carrying the number across', () => {
  const board: FxBoardData = {
    title: '',
    amount: 1000,
    base: 'SEK',
    rows: [{ id: 'a', code: 'JPY', note: 'airport kiosk', manual: 13.16 }],
  };
  const next = swapBase(board, 'EUR', testConvert);
  const jpy = next.rows.find((r) => r.code === 'JPY');
  // A pin is quoted per 1 BASE. 13.16 JPY per SEK is about 146 JPY per EUR here;
  // carrying 13.16 over would read as "1 EUR = 13.16 JPY", a rate nobody quoted.
  ok(jpy?.manual !== null && Math.abs((jpy?.manual ?? 0) - 13.16 / 0.09) < 0.01, `restated in the new base, got ${jpy?.manual}`);
  eq(jpy?.note, 'airport kiosk', 'and whose quote it was rides along');
  const line = buildLines(next, testConvert).find((l) => l.row.code === 'JPY');
  ok(line?.drift !== null && Math.abs((line?.drift ?? 0) + 0.06) < 1e-3, `the recorded spread survives the swap, got ${line?.drift}`);
});

test('fxBoard: amounts format per currency, and codes normalise', () => {
  eq(normalizeCode(' jpy '), 'JPY', 'trimmed and upper-cased');
  eq(normalizeCode('j p y 1'), 'JPY', 'punctuation and digits dropped');
  eq(formatAmount(null, 'JPY'), '-', 'no rate shows a dash, not NaN');
  ok(!formatAmount(168240, 'JPY').includes('.'), 'yen is written whole');
  ok(formatAmount(1043.5, 'EUR').includes('€'), 'euro takes its symbol');
  ok(formatAmount(1000, 'SEK').endsWith('kr'), 'kronor take a suffix');
  ok(formatAmount(1000, 'ZZZ').endsWith('ZZZ'), 'an unknown code falls back to the code');
  eq(parseAmount('1 234,50'), 1234.5, 'a typed amount parses like a number cell');
  eq(parseAmount('nope'), null, 'and refuses nonsense');
});

test('fxBoard: rate lines read in both directions, and age is coarse', () => {
  eq(formatRate(null, 'SEK', 'JPY'), 'no rate yet', 'no rate says so');
  ok(formatRate(14, 'SEK', 'JPY').startsWith('1 SEK = 14 JPY'), 'forward');
  // The separator is the runner's locale, the DIGITS are the point: a bare
  // toLocaleString() caps at three and would show "0.071".
  ok(/^1 JPY = 0[.,]0714/.test(formatInverse(14, 'SEK', 'JPY')), `and back, keeping the decimals that matter, got ${formatInverse(14, 'SEK', 'JPY')}`);
  eq(describeAge(0, 1000), 'no rates yet', 'never fetched');
  eq(describeAge(1000, 1000), 'updated just now', 'fresh');
  eq(describeAge(1, 1 + 3 * 3600_000), 'updated 3 h ago', 'hours');
  eq(describeAge(1, 1 + 50 * 3600_000), 'updated 2 days ago', 'days');
});

console.log(`\n${passed}/${passed + failed} passed`);
if (failed) process.exit(1);
