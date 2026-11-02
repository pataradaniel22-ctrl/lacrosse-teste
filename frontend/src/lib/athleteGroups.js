// Athlete groups (Competition, Training Camp, Development...) and the staff-wide
// group filter. The selected group is remembered on this device and, while the
// user is on a /staff page, added as ?group=<id> to API reads so every chart,
// KPI and list on the server only considers athletes of that group.
import { useEffect, useState, useSyncExternalStore } from 'react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const STORAGE_KEY = 'ams.groupFilter';

export const GROUP_COLORS = {
  yellow: { chip: 'bg-yellow-400/15 text-yellow-300 border-yellow-400/40', solid: 'bg-yellow-400 text-black border-yellow-400', dot: 'bg-yellow-400' },
  green: { chip: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/40', solid: 'bg-emerald-500 text-white border-emerald-500', dot: 'bg-emerald-400' },
  blue: { chip: 'bg-sky-400/15 text-sky-300 border-sky-400/40', solid: 'bg-sky-500 text-white border-sky-500', dot: 'bg-sky-400' },
  purple: { chip: 'bg-violet-400/15 text-violet-300 border-violet-400/40', solid: 'bg-violet-500 text-white border-violet-500', dot: 'bg-violet-400' },
  pink: { chip: 'bg-pink-400/15 text-pink-300 border-pink-400/40', solid: 'bg-pink-500 text-white border-pink-500', dot: 'bg-pink-400' },
  orange: { chip: 'bg-orange-400/15 text-orange-300 border-orange-400/40', solid: 'bg-orange-500 text-white border-orange-500', dot: 'bg-orange-400' },
  red: { chip: 'bg-red-400/15 text-red-300 border-red-400/40', solid: 'bg-red-500 text-white border-red-500', dot: 'bg-red-400' },
  cyan: { chip: 'bg-cyan-400/15 text-cyan-300 border-cyan-400/40', solid: 'bg-cyan-500 text-black border-cyan-500', dot: 'bg-cyan-400' },
  gray: { chip: 'bg-zinc-400/15 text-zinc-300 border-zinc-400/40', solid: 'bg-zinc-500 text-white border-zinc-500', dot: 'bg-zinc-400' },
};
export const colorOf = (c) => GROUP_COLORS[c] || GROUP_COLORS.gray;

// ---------------------------------------------------------------- filter store
const read = () => { try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; } };
let current = read();
const listeners = new Set();

export function getGroupFilter() { return current; }
export function setGroupFilter(g) {
  current = g || '';
  try { if (current) localStorage.setItem(STORAGE_KEY, current); else localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
export function useGroupFilter() {
  const g = useSyncExternalStore(subscribe, getGroupFilter, getGroupFilter);
  return [g, setGroupFilter];
}

// Add ?group= to staff API reads (not admin/auth/group-management calls)
let installed = false;
export function installGroupFilterInterceptor() {
  if (installed) return;
  installed = true;
  axios.interceptors.request.use((config) => {
    const g = current;
    if (!g || config.skipGroupFilter) return config;
    if ((config.method || 'get').toLowerCase() !== 'get') return config;
    if (!window.location.pathname.startsWith('/staff')) return config;
    const url = config.url || '';
    if (!url.startsWith(API)) return config;
    const path = url.slice(API.length);
    if (/^\/(admin|auth|athlete-groups|sandbox)\b/.test(path) || /[?&]group=/.test(url)) return config;
    if (config.params && 'group' in config.params) return config;
    config.params = { ...(config.params || {}), group: g };
    return config;
  });
}

// ---------------------------------------------------------------- definitions
let groupsCache = null;
let groupsPromise = null;
const groupListeners = new Set();

export async function fetchGroups(force = false) {
  if (groupsCache && !force) return groupsCache;
  if (!groupsPromise || force) {
    const token = (() => { try { return localStorage.getItem('token'); } catch { return null; } })();
    groupsPromise = axios.get(`${API}/athlete-groups`, { headers: { Authorization: `Bearer ${token}` }, skipGroupFilter: true })
      .then((r) => { groupsCache = r.data.groups || []; groupListeners.forEach((l) => l(groupsCache)); return groupsCache; })
      .catch(() => { groupsPromise = null; return groupsCache || []; });
  }
  return groupsPromise;
}
export function setGroupsCache(groups) {
  groupsCache = groups;
  groupsPromise = Promise.resolve(groups);
  groupListeners.forEach((l) => l(groups));
  if (current && !groups.some((g) => g.id === current)) setGroupFilter('');
}
export function useAthleteGroups() {
  const [groups, setGroups] = useState(groupsCache || []);
  useEffect(() => {
    groupListeners.add(setGroups);
    fetchGroups().then(setGroups);
    return () => groupListeners.delete(setGroups);
  }, []);
  return groups;
}

// ---------------------------------------------------------------- athlete -> groups
// For lists that only carry an athlete id/name (reports, rankings...), look the
// athlete's groups up from one shared, unfiltered roster request.
let mapCache = null;
let mapPromise = null;
const mapListeners = new Set();
export function refreshAthleteGroupMap() {
  const token = (() => { try { return localStorage.getItem('token'); } catch { return null; } })();
  mapPromise = axios.get(`${API}/staff/athletes`, { headers: { Authorization: `Bearer ${token}` }, skipGroupFilter: true })
    .then((r) => {
      const list = Array.isArray(r.data) ? r.data : (r.data?.athletes || []);
      const byId = {}; const byName = {};
      list.forEach((a) => { byId[a.id] = a.groups || []; if (a.name) byName[a.name.trim()] = a.groups || []; });
      mapCache = { byId, byName };
      mapListeners.forEach((l) => l(mapCache));
      return mapCache;
    })
    .catch(() => { mapPromise = null; return mapCache; });
  return mapPromise;
}
export function patchAthleteGroupMap(athleteId, groups) {
  if (!mapCache) return;
  mapCache = { ...mapCache, byId: { ...mapCache.byId, [athleteId]: groups } };
  mapListeners.forEach((l) => l(mapCache));
}
export function useAthleteGroupMap() {
  const [m, setM] = useState(mapCache);
  useEffect(() => {
    mapListeners.add(setM);
    if (!mapCache && !mapPromise) refreshAthleteGroupMap();
    else if (mapPromise) mapPromise.then((x) => x && setM(x));
    return () => mapListeners.delete(setM);
  }, []);
  return m;
}
