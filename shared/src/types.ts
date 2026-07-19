// Contrat de données partagé entre le frontend et le backend.
// Source de vérité unique — ne jamais redéclarer ces types ailleurs.

/** Anime tel que renvoyé par AniList (mappé), utilisé pour la recherche et l'affichage. */
export type Media = {
  id: number;
  title: { romaji: string | null; english: string | null; native: string | null };
  episodes: number | null;
  status: string;
  seasonYear: number | null;
  coverImage: { medium: string | null; color: string | null };
  nextAiringEpisode: { episode: number; airingAt: number } | null; // airingAt = unix UTC
};

export type UserStatus = 'watching' | 'completed' | 'paused' | 'dropped' | 'planned';

/** Une entrée de la liste de l'utilisateur : Media + progression + statut utilisateur. */
export type ListEntry = Media & {
  progress: number;
  userStatus: UserStatus;
};

/** Ligne de la table `anime_cache` (colonnes SQL en camelCase), cf. README §4. */
export type AnimeCacheRow = {
  anilistId: number;
  titleRomaji: string | null;
  titleEnglish: string | null;
  titleNative: string | null;
  coverImage: string | null;
  coverColor: string | null;
  episodes: number | null;
  status: string;
  nextEpNum: number | null;
  nextEpAiringAt: number | null;
  lastSynced: number;
};

/** Ligne de la table `user_list` (colonnes SQL en camelCase), cf. README §4. */
export type UserListRow = {
  anilistId: number;
  status: UserStatus;
  progress: number;
  addedAt: number;
  updatedAt: number;
};

/** Dump de sauvegarde/restauration JSON, versionné (§8). */
export type BackupDump = {
  version: 1;
  exportedAt: string;
  animeCache: AnimeCacheRow[];
  userList: UserListRow[];
};

// --- Payloads API (§6) ---

export type LoginRequest = { password: string };

export type AuthStatusResponse = { authenticated: boolean };

export type AddListItemRequest = { anilistId: number };

export type UpdateProgressRequest = { progress: number };

export type RestoreSummary = { restored: { animeCache: number; userList: number } };
