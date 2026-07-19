import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  Media,
  UserStatus,
  ListEntry,
  AnimeCacheRow,
  UserListRow,
  BackupDump,
  LoginRequest,
  AuthStatusResponse,
  AddListItemRequest,
  UpdateProgressRequest,
  RestoreSummary,
} from './types.ts';

const USER_STATUSES: UserStatus[] = ['watching', 'completed', 'paused', 'dropped', 'planned'];

test('Media — forme complète, y compris les champs nullable', () => {
  const withNextEp: Media = {
    id: 1,
    title: { romaji: 'Sousou no Frieren', english: "Frieren: Beyond Journey's End", native: '葬送のフリーレン' },
    episodes: 28,
    status: 'RELEASING',
    seasonYear: 2025,
    coverImage: { medium: 'https://example.test/cover.jpg', color: '#5b8def' },
    nextAiringEpisode: { episode: 12, airingAt: 1_800_000_000 },
  };
  assert.deepEqual(Object.keys(withNextEp).sort(), [
    'coverImage', 'episodes', 'id', 'nextAiringEpisode', 'seasonYear', 'status', 'title',
  ]);
  assert.equal(typeof withNextEp.nextAiringEpisode?.airingAt, 'number');

  const finished: Media = {
    id: 2,
    title: { romaji: null, english: null, native: 'ぼっち・ざ・ろっく!' },
    episodes: null,
    status: 'FINISHED',
    seasonYear: null,
    coverImage: { medium: null, color: null },
    nextAiringEpisode: null,
  };
  assert.equal(finished.nextAiringEpisode, null);
  assert.equal(finished.title.romaji, null);
});

test('UserStatus — les 5 valeurs attendues, rien de plus', () => {
  assert.deepEqual(USER_STATUSES, ['watching', 'completed', 'paused', 'dropped', 'planned']);
});

test('ListEntry — étend Media avec progress + userStatus', () => {
  const entry: ListEntry = {
    id: 1,
    title: { romaji: 'Dungeon Meshi', english: 'Delicious in Dungeon', native: 'ダンジョン飯' },
    episodes: 24,
    status: 'RELEASING',
    seasonYear: 2025,
    coverImage: { medium: null, color: '#f5a524' },
    nextAiringEpisode: null,
    progress: 7,
    userStatus: 'watching',
  };
  assert.deepEqual(Object.keys(entry).sort(), [
    'coverImage', 'episodes', 'id', 'nextAiringEpisode', 'progress', 'seasonYear', 'status', 'title', 'userStatus',
  ]);
});

test('AnimeCacheRow — reflète les colonnes SQL de anime_cache en camelCase', () => {
  const row: AnimeCacheRow = {
    anilistId: 1,
    titleRomaji: 'Kaijuu 8-gou',
    titleEnglish: 'Kaiju No. 8',
    titleNative: '怪獣8号',
    coverImage: 'https://example.test/kaiju.jpg',
    coverColor: '#3ecf8e',
    episodes: 12,
    status: 'RELEASING',
    nextEpNum: 5,
    nextEpAiringAt: 1_800_000_000,
    lastSynced: 1_700_000_000,
  };
  assert.deepEqual(Object.keys(row).sort(), [
    'anilistId', 'coverColor', 'coverImage', 'episodes', 'lastSynced',
    'nextEpAiringAt', 'nextEpNum', 'status', 'titleEnglish', 'titleNative', 'titleRomaji',
  ]);
});

test('UserListRow — reflète les colonnes SQL de user_list en camelCase', () => {
  const row: UserListRow = {
    anilistId: 1,
    status: 'watching',
    progress: 11,
    addedAt: 1_700_000_000,
    updatedAt: 1_700_100_000,
  };
  assert.deepEqual(Object.keys(row).sort(), ['addedAt', 'anilistId', 'progress', 'status', 'updatedAt']);
});

test('BackupDump — versionné, contient les deux tables', () => {
  const dump: BackupDump = {
    version: 1,
    exportedAt: '2026-07-19T12:00:00Z',
    animeCache: [],
    userList: [],
  };
  assert.equal(dump.version, 1);
  assert.deepEqual(Object.keys(dump).sort(), ['animeCache', 'exportedAt', 'userList', 'version']);
});

test('payloads API — formes minimales attendues par les routes (§6)', () => {
  const login: LoginRequest = { password: 'hunter2' };
  const status: AuthStatusResponse = { authenticated: true };
  const addItem: AddListItemRequest = { anilistId: 42 };
  const updateProgress: UpdateProgressRequest = { progress: 3 };
  const restoreSummary: RestoreSummary = { restored: { animeCache: 10, userList: 10 } };

  assert.deepEqual(Object.keys(login), ['password']);
  assert.deepEqual(Object.keys(status), ['authenticated']);
  assert.deepEqual(Object.keys(addItem), ['anilistId']);
  assert.deepEqual(Object.keys(updateProgress), ['progress']);
  assert.deepEqual(Object.keys(restoreSummary.restored).sort(), ['animeCache', 'userList']);
});
