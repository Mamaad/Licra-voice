import type { YouTubeActivity } from './types';
export function parseYouTubeID(value: string): string | null;
export function canonicalPosition(activity: YouTubeActivity | null, serverNow: number): number;
export function clockSample(serverTime: number, sent: number, received: number): {rtt:number;offset:number};
export function driftNeedsSeek(drift: number): boolean;
