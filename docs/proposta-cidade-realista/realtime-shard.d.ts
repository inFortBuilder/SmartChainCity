// Tipos do realtime-shard.js, para o teste do realtime conferir que o mapa divide igual ao servidor.
export const REALTIME_URLS: string[];
export function fnv1a(text: string): number;
export function districtKey(city: string, district: number): string;
export function interiorKey(city: string, lot: number): string;
export function shardIndex(key: string, count: number): number;
export function realtimeFor(key: string, urls?: string[]): string;
